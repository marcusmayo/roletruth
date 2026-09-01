import type { BrowserSession, LaunchOptions } from "@solarisdk/browser";
import type { Sandbox } from "@solarisdk/sdk";

import { sha256Hex, type RoleTruthReport } from "@/lib/roletruth-engine";
import { SOLARI_RECONCILE_SCRIPT } from "@/lib/solari-reconcile-script";
import { validatePublicUrl } from "@/lib/url-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_URLS = 3;
const MAX_TEXT_LENGTH = 200_000;

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

  let urls: string[];
  try {
    const body = (await request.json()) as { urls?: unknown };
    if (!Array.isArray(body.urls) || body.urls.length < 1) {
      throw new Error("Provide at least one public source URL.");
    }
    if (body.urls.length > MAX_URLS) {
      throw new Error(`RoleTruth accepts at most ${MAX_URLS} live URLs per run.`);
    }
    urls = body.urls.map(validatePublicUrl);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid request." },
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
    const [{ Solari }, { SolariClient }] = await Promise.all([
      import("@solarisdk/browser"),
      import("@solarisdk/sdk"),
    ]);
    browserClient = new Solari({
      apiKey,
      timeoutMs: 60_000,
      maxAttempts: 2,
    });
    browser = await browserClient.launch({
      recording: true,
      stealth: true,
      webBotAuth: true,
      retries: 1,
      probe: true,
    });

    const captures = [];
    for (const requestedUrl of urls) {
      const page = await browser.newPage();
      await page.goto(requestedUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      const text = (await page.locator("body").innerText()).slice(
        0,
        MAX_TEXT_LENGTH,
      );
      const screenshot = await page.screenshot({ fullPage: true });
      const screenshotBytes = new Uint8Array(screenshot);
      captures.push({
        requestedUrl,
        finalUrl: page.url(),
        title: await page.title(),
        text,
        capturedAt: new Date().toISOString(),
        browserSessionId: browser.id,
        textSha256: await sha256Hex(text),
        screenshotSha256: await sha256Hex(
          screenshotBytes.buffer.slice(
            screenshotBytes.byteOffset,
            screenshotBytes.byteOffset + screenshotBytes.byteLength,
          ),
        ),
      });
      await page.close();
    }

    await browser.close();
    browser = null;
    await browserClient.close();

    const solari = new SolariClient({
      apiKey,
      callTimeoutMs: 60_000,
    });
    sandbox = await solari.sandboxes.create({
      template: "base",
      timeoutMs: 5 * 60_000,
      metadata: { product: "roletruth", purpose: "deterministic-reconcile" },
    });
    await sandbox.connect();
    await sandbox.files.write(
      "/tmp/roletruth-input.json",
      JSON.stringify(captures),
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
