import type { BrowserSession, LaunchOptions } from "@solarisdk/browser";
import type { Sandbox } from "@solarisdk/sdk";

import {
  MAX_DISCOVERY_CAPTURES,
  assessCaptureIdentity,
  buildDiscoveryQueries,
  buildDiscoverySeed,
  deduplicateCandidates,
  rankSearchCandidates,
  type DiscoveryQuery,
  type DiscoverySeed,
  type SearchAnchor,
  type SearchCandidate,
} from "@/lib/evidence-discovery";
import { parseEvidenceRequest } from "@/lib/evidence-intake";
import {
  extractJobCandidates,
  parseStructuredJobScripts,
  structuredJobsToSealedText,
  type LiveCaptureData,
} from "@/lib/job-extractor";
import {
  sha256Hex,
  type DiscoveryQueryTrace,
  type DiscoveryTrace,
  type EvidenceOrigin,
  type RoleTruthReport,
} from "@/lib/roletruth-engine";
import { ocrScreenshots, type ScreenshotOcrResult } from "@/lib/screenshot-ocr";
import { buildSolariLaunchOptions } from "@/lib/solari-launch-options";
import { SOLARI_RECONCILE_SCRIPT } from "@/lib/solari-reconcile-script";
import { assessSource } from "@/lib/source-quality";
import { validatePublicUrl } from "@/lib/url-security";

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

type CaptureProvenance = {
  origin: EvidenceOrigin;
  discoveredVia?: string;
  searchRank?: number;
};

type SearchRun = {
  provider: string | null;
  anchors: SearchAnchor[];
  diagnostic?: string;
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

async function installPublicNetworkGuard(
  page: Awaited<ReturnType<BrowserSession["newPage"]>>,
) {
  await page.route("**/*", async (route) => {
    const requestUrl = route.request().url();
    if (!/^https?:/i.test(requestUrl)) {
      await route.continue();
      return;
    }
    try {
      validatePublicUrl(requestUrl);
      await route.continue();
    } catch {
      await route.abort("blockedbyclient");
    }
  });
}

async function captureUrl(
  browser: BrowserSession,
  requestedUrl: string,
  index: number,
  provenance: CaptureProvenance,
): Promise<CaptureWithImage> {
  const page = await browser.newPage();
  const capturedAt = new Date().toISOString();
  let httpStatus: number | null = null;

  try {
    await installPublicNetworkGuard(page);
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
    const finalUrl = validatePublicUrl(page.url());
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
      ...provenance,
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
      ...provenance,
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

async function searchWithSolari(
  browser: BrowserSession,
  query: DiscoveryQuery,
): Promise<SearchRun> {
  const providers = [
    {
      name: "DuckDuckGo HTML",
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.query)}`,
    },
    {
      name: "Bing",
      url: `https://www.bing.com/search?q=${encodeURIComponent(query.query)}`,
    },
  ];
  const diagnostics: string[] = [];

  for (const provider of providers) {
    const page = await browser.newPage();
    try {
      await installPublicNetworkGuard(page);
      const response = await page.goto(provider.url, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      if (response && response.status() >= 400) {
        diagnostics.push(`${provider.name} returned HTTP ${response.status()}.`);
        continue;
      }
      const anchors = await page.locator("a[href]").evaluateAll((nodes) =>
        nodes.slice(0, 200).map((node) => {
          const anchor = node as HTMLAnchorElement;
          const container = anchor.closest(
            ".result, .web-result, li.b_algo, [data-testid='result'], article",
          ) as HTMLElement | null;
          return {
            href: anchor.href,
            title: (anchor.innerText || anchor.textContent || "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 240),
            snippet: (container?.innerText || "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 600),
          };
        }),
      );
      const usable = anchors.filter(
        (anchor) => anchor.href && anchor.title && /^https?:/i.test(anchor.href),
      );
      if (usable.length > 0) {
        return { provider: provider.name, anchors: usable };
      }
      diagnostics.push(`${provider.name} returned no readable result links.`);
    } catch (error) {
      diagnostics.push(
        `${provider.name} search failed: ${
          error instanceof Error ? error.message : "unknown browser error"
        }`,
      );
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  return {
    provider: null,
    anchors: [],
    diagnostic: diagnostics.join(" ").slice(0, 600),
  };
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
        origin: "uploaded",
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
    let discovery: DiscoveryTrace | undefined;
    if (input.urls.length > 0) {
      const { Solari } = await import("@solarisdk/browser");
      browserClient = new Solari({
        apiKey,
        timeoutMs: 60_000,
        maxAttempts: 2,
      });
      browser = await browserClient.launch(buildSolariLaunchOptions());
      for (const [index, requestedUrl] of input.urls.entries()) {
        urlCaptures.push(
          await captureUrl(browser, requestedUrl, index + 1, {
            origin: "submitted",
          }),
        );
      }
    }

    const screenshotCaptures = await captureScreenshots(
      await ocrPromise,
      urlCaptures.length + 1,
    );
    const captures = [...urlCaptures, ...screenshotCaptures];

    if (browser && urlCaptures.length > 0) {
      const seed: DiscoverySeed = buildDiscoverySeed(captures);
      const queries = buildDiscoveryQueries(seed);
      const queryTraces: DiscoveryQueryTrace[] = [];
      const candidatePool: SearchCandidate[] = [];
      let candidatesScreened = 0;

      for (const query of queries) {
        const result = await searchWithSolari(browser, query);
        candidatesScreened += result.anchors.length;
        const ranked = rankSearchCandidates(
          result.anchors,
          query.id,
          seed,
          captures
            .map((capture) => capture.finalUrl ?? capture.requestedUrl)
            .filter((value): value is string => Boolean(value)),
        );
        candidatePool.push(...ranked);
        queryTraces.push({
          id: query.id,
          query: query.query,
          reason: query.reason,
          provider: result.provider,
          resultsScreened: result.anchors.length,
          candidatesAccepted: ranked.length,
          diagnostic: result.diagnostic,
        });
      }

      const uniqueCandidates = deduplicateCandidates(
        candidatePool.sort((a, b) => b.score - a.score || a.rank - b.rank),
      );
      const selectedCandidates = uniqueCandidates.slice(
        0,
        Math.min(MAX_DISCOVERY_CAPTURES, 8 - captures.length),
      );
      let duplicateCount = 0;

      for (const candidate of selectedCandidates) {
        const capture = await captureUrl(
          browser,
          candidate.url,
          captures.length + 1,
          {
            origin: "discovered",
            discoveredVia: candidate.queryId,
            searchRank: candidate.rank,
          },
        );
        const identity = assessCaptureIdentity(capture, seed);
        capture.identityMatch = identity.match;
        capture.diagnostics.push(identity.diagnostic);
        if (!identity.eligible && capture.acquisitionStatus === "usable") {
          capture.acquisitionStatus = "irrelevant";
          capture.eligibleForRoleTerms = false;
          capture.candidateAssertions = [];
        }
        const duplicate = captures.find(
          (existing) =>
            existing.textSha256 === capture.textSha256 &&
            existing.acquisitionStatus === "usable",
        );
        if (duplicate) {
          capture.acquisitionStatus = "duplicate";
          capture.eligibleForRoleTerms = false;
          capture.candidateAssertions = [];
          capture.diagnostics.push(
            `Duplicate content of ${duplicate.label}; it cannot add another vote.`,
          );
          duplicateCount += 1;
        }
        captures.push(capture);
      }

      discovery = {
        attempted: true,
        method: "solari-browser-search",
        startingUrls: input.urls,
        identity: {
          roleTitle: seed.roleTitle,
          companyName: seed.companyName,
          jobId: seed.jobId,
        },
        queries: queryTraces,
        candidatesScreened,
        candidatesCaptured: selectedCandidates.length,
        duplicatesExcluded: duplicateCount,
        rejectedBeforeCapture: Math.max(
          0,
          candidatesScreened - uniqueCandidates.length,
        ),
      };
      await browser.close();
      browser = null;
      await browserClient?.close();
    }

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
    report.discovery = discovery;
    report.runtime.sandboxId = sandbox.id;
    report.runtime.sandboxExitCode = result.exitCode;
    if (discovery) {
      const discoveredUsable = report.sources.filter(
        (source) =>
          source.origin === "discovered" &&
          source.acquisitionStatus === "usable",
      ).length;
      const submittedBlocked = report.sources.some(
        (source) =>
          source.origin === "submitted" &&
          ["blocked", "auth_required", "error"].includes(
            source.acquisitionStatus ?? "",
          ),
      );
      const seedPageType = buildDiscoverySeed(captures).pageType;
      const searchSummary = `${discovery.queries.length} search quer${discovery.queries.length === 1 ? "y" : "ies"}, ${discovery.candidatesScreened} result${discovery.candidatesScreened === 1 ? "" : "s"} screened, and ${discovery.candidatesCaptured} candidate page${discovery.candidatesCaptured === 1 ? "" : "s"} captured`;
      if (seedPageType === "search-results") {
        report.diagnostics = [
          "This URL is a job search-results page, not one opening. Open a specific job and paste that listing URL.",
          ...(report.diagnostics ?? []),
        ];
      } else if (seedPageType === "company-page") {
        report.diagnostics = [
          "This URL is a company profile, not one opening. Paste the URL for a specific job listing.",
          ...(report.diagnostics ?? []),
        ];
      } else if (submittedBlocked && discoveredUsable > 0) {
        report.diagnostics = [
          `Starting URL was unavailable; discovery continued and captured ${discoveredUsable} usable alternate source${discoveredUsable === 1 ? "" : "s"}.`,
          ...(report.diagnostics ?? []),
        ];
      } else if (submittedBlocked && discoveredUsable === 0) {
        report.diagnostics = [
          `The starting job page was unavailable. RoleTruth completed ${searchSummary}, but no captured page passed the same-opening identity gate. Open Evidence ledger for the discovery trace.`,
          ...(report.diagnostics ?? []),
        ];
      } else if (
        !discovery.identity.roleTitle &&
        !discovery.identity.jobId &&
        discoveredUsable === 0
      ) {
        report.diagnostics = [
          "The submitted URL did not identify a specific opening. RoleTruth searched for evidence but did not merge unrelated jobs.",
          ...(report.diagnostics ?? []),
        ];
      }
    }

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
