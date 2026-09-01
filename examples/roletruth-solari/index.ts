import { Solari } from "@solarisdk/browser";
import { SolariClient } from "@solarisdk/sdk";

import {
  extractJobCandidates,
  parseStructuredJobScripts,
  structuredJobsToSealedText,
  type LiveCaptureData,
} from "../../lib/job-extractor.ts";
import { sha256Hex, type RoleTruthReport } from "../../lib/roletruth-engine.ts";
import { buildSolariLaunchOptions } from "../../lib/solari-launch-options.ts";
import { SOLARI_RECONCILE_SCRIPT } from "../../lib/solari-reconcile-script.ts";
import { assessSource } from "../../lib/source-quality.ts";
import { validatePublicUrl } from "../../lib/url-security.ts";

const MAX_TEXT_LENGTH = 200_000;
const THIRD_PARTY_JOB_HOSTS = [
  "glassdoor.",
  "linkedin.",
  "indeed.",
  "ziprecruiter.",
  "monster.",
];

type CaptureWithImage = LiveCaptureData & { imageBytes: Uint8Array };

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
  const isolated = Uint8Array.from(bytes);
  return sha256Hex(isolated.buffer);
}

async function captureUrl(
  browser: Awaited<ReturnType<Solari["launch"]>>,
  requestedUrl: string,
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

    // Give client-rendered job boards a bounded opportunity to populate the DOM.
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
      sourceId: "src-live-1",
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
      sourceId: "src-live-1",
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
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

const apiKey = process.env.SOLARI_API_KEY;
const requestedUrl = validatePublicUrl(process.argv[2]);

if (!apiKey) {
  throw new Error(
    "SOLARI_API_KEY is required. The frontend's golden fixture remains keyless.",
  );
}

const browserClient = new Solari({
  apiKey,
  timeoutMs: 60_000,
  maxAttempts: 2,
});
const solari = new SolariClient({ apiKey, callTimeoutMs: 60_000 });
let browser: Awaited<ReturnType<Solari["launch"]>> | null = null;
let sandbox: Awaited<
  ReturnType<SolariClient["sandboxes"]["create"]>
> | null = null;

try {
  // These defaults are a recorded, non-stealth session compatible with Free.
  browser = await browserClient.launch(buildSolariLaunchOptions());
  const capture = await captureUrl(browser, requestedUrl);

  await browser.close();
  browser = null;
  await browserClient.close();

  sandbox = await solari.sandboxes.create({
    template: "base",
    timeoutMs: 5 * 60_000,
    metadata: { example: "roletruth", purpose: "evidence-verification" },
  });
  await sandbox.connect();

  const imagePath = "/tmp/roletruth-source-1.png";
  await sandbox.files.upload(imagePath, capture.imageBytes);
  const { imageBytes: _imageBytes, ...serializableCapture } = capture;
  void _imageBytes;
  const manifest = [{ ...serializableCapture, imagePath }];

  await sandbox.files.write("/tmp/input.json", JSON.stringify(manifest));
  await sandbox.files.write("/tmp/reconcile.py", SOLARI_RECONCILE_SCRIPT);
  const result = await sandbox.commands.run("python3", {
    args: [
      "/tmp/reconcile.py",
      "/tmp/input.json",
      "/tmp/result.json",
    ],
    timeoutMs: 60_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `Sandbox exited ${result.exitCode}`);
  }

  const report = JSON.parse(
    await sandbox.files.readText("/tmp/result.json"),
  ) as RoleTruthReport;
  report.runtime.sandboxId = sandbox.id;
  report.runtime.sandboxExitCode = result.exitCode;

  const source = report.sources[0];
  console.log(
    JSON.stringify(
      {
        analysisStatus: report.analysisStatus,
        subject: report.subject,
        diagnostics: report.diagnostics,
        source: source
          ? {
              requestedUrl: source.requestedUrl,
              finalUrl: source.finalUrl,
              httpStatus: source.httpStatus,
              acquisitionStatus: source.acquisitionStatus,
              documentType: source.documentType,
              eligibleForRoleTerms: source.eligibleForRoleTerms,
              diagnostics: source.diagnostics,
              textLength: source.textLength,
              textSha256: source.textSha256,
              screenshotSha256: source.screenshotSha256,
            }
          : null,
        findings: report.findings.map(
          ({ field, status, conclusion, evidenceIds }) => ({
            field,
            status,
            conclusion,
            evidenceIds,
          }),
        ),
        runtime: {
          browserSessionId: report.runtime.browserSessionId,
          sandboxId: report.runtime.sandboxId,
          sandboxExitCode: report.runtime.sandboxExitCode,
        },
      },
      null,
      2,
    ),
  );
} finally {
  if (browser) await browser.close().catch(() => undefined);
  await browserClient.close().catch(() => undefined);
  if (sandbox) await sandbox.kill().catch(() => undefined);
}
