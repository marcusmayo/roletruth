import type { BrowserSession, LaunchOptions } from "@solarisdk/browser";
import type { Sandbox } from "@solarisdk/sdk";

import { parseEvidenceRequest } from "@/lib/evidence-intake";
import {
  extractJobCandidates,
  parseStructuredJobScripts,
  structuredJobsToSealedText,
  type LiveCaptureData,
} from "@/lib/job-extractor";
import { sha256Hex, type RoleTruthReport } from "@/lib/roletruth-engine";
import { ocrScreenshots, type ScreenshotOcrResult } from "@/lib/screenshot-ocr";
import { buildSolariLaunchOptions } from "@/lib/solari-launch-options";
import { SOLARI_RECONCILE_SCRIPT } from "@/lib/solari-reconcile-script";
import { assessSource } from "@/lib/source-quality";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT_LENGTH = 200_000;
const THIRD_PARTY_JOB_HOSTS = [
  "glassdoor.",
  "linkedin.",
  "indeed.",
  "ziprecruiter.",
  "monster.",
];

type CaptureWithImage = LiveCaptureData & {
  imageBytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
};

function hostFor(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return "Captured page";
  }
}

function authorityFor(host: string) {
  return THIRD_PARTY_JOB_HOSTS.some((marker) => host.includes(marker))
    ? ("third-party" as const)
    : ("unclassified" as const);
}

async function hashBytes(bytes: Uint8Array) {
  return sha256Hex(Uint8Array.from(bytes).buffer);
}

async function captureUrl(
  browser: BrowserSession,
  requestedUrl: string,
  index: number,
): Promise<CaptureWithImage> {
  const page = await browser.newPage();
  const capturedAt = new Date().toISOString();
  let httpStatus: number | null = null;

  try {
    const response = await page.goto(requestedUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    httpStatus = response?.status() ?? null;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const textLength = await page
        .locator("body")
        .innerText()
        .then((value) => value.trim().length)
        .catch(() => 0);
      if (textLength >= 240) break;
      await page.waitForTimeout(750);
    }

    const [rawText, title, heading, jsonLdScripts, screenshot] =
      await Promise.all([
        page
          .locator("body")
          .innerText()
          .then((value) => value.slice(0, MAX_TEXT_LENGTH)),
        page.title(),
        page
          .locator("h1")
          .first()
          .innerText()
          .catch(() => ""),
        page
          .locator('script[type="application/ld+json"]')
          .allTextContents()
          .catch(() => []),
        page.screenshot({ fullPage: true }),
      ]);
    const finalUrl = page.url();
    const structuredJobs = parseStructuredJobScripts(jsonLdScripts);
    const metadataText = [
      "[Page metadata]",
      title ? `Page title: ${title}` : "",
      heading ? `Heading: ${heading}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    const structuredText = structuredJobsToSealedText(structuredJobs);
    const sealedText = [rawText, metadataText, structuredText]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 300_000);
    const assessment = assessSource({
      requestedUrl,
      finalUrl,
      title,
      heading,
      text: rawText,
      httpStatus,
      structuredJobCount: structuredJobs.length,
      kind: "url",
    });
    const imageBytes = new Uint8Array(screenshot);
    const host = hostFor(finalUrl);
    const capture: CaptureWithImage = {
      sourceId: `src-live-${index}`,
      kind: "url",
      label: title || heading || host,
      publisher: host,
      author: "Rendered page",
      authority: authorityFor(host),
      requestedUrl,
      finalUrl,
      capturedAt,
      sealedText,
      textSha256: await sha256Hex(sealedText),
      screenshotSha256: await hashBytes(imageBytes),
      browserSessionId: browser.id,
      httpStatus,
      structuredJobs,
      ...assessment,
      imageBytes,
      mimeType: "image/png",
    };
    capture.candidateAssertions = extractJobCandidates(capture);
    return capture;
  } catch (error) {
    const finalUrl = page.url() || requestedUrl;
    const host = hostFor(finalUrl);
    const [title, text, screenshot] = await Promise.all([
      page.title().catch(() => ""),
      page
        .locator("body")
        .innerText()
        .then((value) => value.slice(0, MAX_TEXT_LENGTH))
        .catch(() => ""),
      page
        .screenshot({ fullPage: true })
        .then((value) => new Uint8Array(value))
        .catch(() => new Uint8Array()),
    ]);
    const sealedText = text || `Acquisition error: ${
      error instanceof Error ? error.message : "Unknown browser error"
    }`;
    return {
      sourceId: `src-live-${index}`,
      kind: "url",
      label: title || host,
      publisher: host,
      author: "Rendered page",
      authority: authorityFor(host),
      requestedUrl,
      finalUrl,
      capturedAt,
      sealedText,
      textSha256: await sha256Hex(sealedText),
      screenshotSha256: await hashBytes(screenshot),
      browserSessionId: browser.id,
      httpStatus,
      acquisitionStatus: "error",
      documentType: "unknown",
      eligibleForRoleTerms: false,
      diagnostics: [
        error instanceof Error
          ? `Browser acquisition failed: ${error.message}`
          : "Browser acquisition failed.",
      ],
      candidateAssertions: [],
      imageBytes: screenshot,
      mimeType: "image/png",
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function captureScreenshots(
  results: ScreenshotOcrResult[],
  startIndex: number,
): Promise<CaptureWithImage[]> {
  return Promise.all(
    results.map(async (result, offset) => {
      const { screenshot } = result;
      const sourceId = `src-live-${startIndex + offset}`;
      const capturedAt = new Date().toISOString();
      const sealedText = result.text.slice(0, MAX_TEXT_LENGTH);
      const assessment = result.error
        ? {
            acquisitionStatus: "error" as const,
            documentType: "unknown" as const,
            eligibleForRoleTerms: false,
            diagnostics: [`Screenshot OCR failed: ${result.error}`],
          }
        : assessSource({
            title: screenshot.name,
            text: sealedText,
            kind: "screenshot",
          });
      if (!result.error && result.confidence < 45) {
        assessment.diagnostics.push(
          `OCR confidence was low (${result.confidence.toFixed(0)}%). Verify quoted text before relying on it.`,
        );
      }
      const capture: CaptureWithImage = {
        sourceId,
        kind: "screenshot",
        label: screenshot.name,
        publisher: "Uploaded screenshot",
        author: "User-provided evidence",
        authority: "unclassified",
        capturedAt,
        sealedText,
        textSha256: await sha256Hex(sealedText),
        screenshotSha256: screenshot.sha256,
        ocrConfidence: result.confidence,
        ...assessment,
        imageBytes: screenshot.bytes,
        mimeType: screenshot.mimeType,
      };
      capture.candidateAssertions = extractJobCandidates(capture);
      return capture;
    }),
  );
}

function extensionFor(mimeType: CaptureWithImage["mimeType"]) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

export async function POST(request: Request) {
  const apiKey = process.env.SOLARI_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error:
          "Live mode is not configured. Add SOLARI_API_KEY server-side; the reproducible demo remains available.",
      },
      { status: 503 },
    );
  }

  let input;
  try {
    input = await parseEvidenceRequest(request);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid evidence." },
      { status: 400 },
    );
  }

  let browserClient: {
    launch: (options?: LaunchOptions) => Promise<BrowserSession>;
    close: () => Promise<void>;
  } | null = null;
  let browser: BrowserSession | null = null;
  let sandbox: Sandbox | null = null;

  try {
    const ocrPromise = ocrScreenshots(input.screenshots).catch((error) =>
      input.screenshots.map((screenshot) => ({
        screenshot,
        text: "",
        confidence: 0,
        error:
          error instanceof Error ? error.message : "OCR initialization failed.",
      })),
    );

    const urlCaptures: CaptureWithImage[] = [];
    if (input.urls.length > 0) {
      const { Solari } = await import("@solarisdk/browser");
      browserClient = new Solari({
        apiKey,
        timeoutMs: 60_000,
        maxAttempts: 2,
      });
      browser = await browserClient.launch(buildSolariLaunchOptions());
      for (const [index, requestedUrl] of input.urls.entries()) {
        urlCaptures.push(await captureUrl(browser, requestedUrl, index + 1));
      }
      await browser.close();
      browser = null;
      await browserClient.close();
    }

    const screenshotCaptures = await captureScreenshots(
      await ocrPromise,
      urlCaptures.length + 1,
    );
    const captures = [...urlCaptures, ...screenshotCaptures];

    const { SolariClient } = await import("@solarisdk/sdk");
    const solari = new SolariClient({
      apiKey,
      callTimeoutMs: 60_000,
    });
    sandbox = await solari.sandboxes.create({
      template: "base",
      timeoutMs: 5 * 60_000,
      metadata: { product: "roletruth", purpose: "evidence-verification" },
    });
    await sandbox.connect();

    const manifest = [];
    for (const [index, capture] of captures.entries()) {
      const imagePath = `/tmp/roletruth-source-${index + 1}.${extensionFor(
        capture.mimeType,
      )}`;
      await sandbox.files.upload(imagePath, capture.imageBytes);
      const { imageBytes: _imageBytes, mimeType: _mimeType, ...serializable } =
        capture;
      void _imageBytes;
      void _mimeType;
      manifest.push({ ...serializable, imagePath });
    }

    await sandbox.files.write(
      "/tmp/roletruth-input.json",
      JSON.stringify(manifest),
    );
    await sandbox.files.write(
      "/tmp/roletruth-reconcile.py",
      SOLARI_RECONCILE_SCRIPT,
    );

    const result = await sandbox.commands.run("python3", {
      args: [
        "/tmp/roletruth-reconcile.py",
        "/tmp/roletruth-input.json",
        "/tmp/roletruth-result.json",
      ],
      timeoutMs: 60_000,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr ||
          `Solari Sandbox reconciliation failed (exit ${result.exitCode}).`,
      );
    }

    const report = JSON.parse(
      await sandbox.files.readText("/tmp/roletruth-result.json"),
    ) as RoleTruthReport;
    report.runtime.sandboxId = sandbox.id;
    report.runtime.sandboxExitCode = result.exitCode;

    return Response.json(
      { report },
      {
        headers: {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The live Solari run did not complete.",
      },
      { status: 502 },
    );
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
    await browserClient?.close().catch(() => undefined);
    if (sandbox) {
      await sandbox.kill().catch(() => undefined);
    }
  }
}
