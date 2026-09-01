import { Solari } from "@solarisdk/browser";
import { SolariClient } from "@solarisdk/sdk";

import { sha256Hex, type RoleTruthReport } from "../../lib/roletruth-engine.ts";
import { buildSolariLaunchOptions } from "../../lib/solari-launch-options.ts";
import { SOLARI_RECONCILE_SCRIPT } from "../../lib/solari-reconcile-script.ts";
import { validatePublicUrl } from "../../lib/url-security.ts";

const apiKey = process.env.SOLARI_API_KEY;
const requestedUrl = validatePublicUrl(process.argv[2]);

if (!apiKey) {
  throw new Error(
    "SOLARI_API_KEY is required. The frontend's golden fixture remains keyless.",
  );
}

const browserClient = new Solari({ apiKey, timeoutMs: 60_000 });
const solari = new SolariClient({ apiKey, callTimeoutMs: 60_000 });
let browser: Awaited<ReturnType<Solari["launch"]>> | null = null;
let sandbox: Awaited<
  ReturnType<SolariClient["sandboxes"]["create"]>
> | null = null;

try {
  browser = await browserClient.launch(buildSolariLaunchOptions());
  const page = await browser.newPage();
  await page.goto(requestedUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  const text = (await page.locator("body").innerText()).slice(0, 200_000);
  const screenshot = new Uint8Array(
    await page.screenshot({ fullPage: true }),
  );
  const capture = {
    requestedUrl,
    finalUrl: page.url(),
    title: await page.title(),
    text,
    capturedAt: new Date().toISOString(),
    browserSessionId: browser.id,
    textSha256: await sha256Hex(text),
    screenshotSha256: await sha256Hex(
      screenshot.buffer.slice(
        screenshot.byteOffset,
        screenshot.byteOffset + screenshot.byteLength,
      ),
    ),
  };

  await page.close();
  await browser.close();
  browser = null;
  await browserClient.close();

  sandbox = await solari.sandboxes.create({
    template: "base",
    timeoutMs: 5 * 60_000,
    metadata: { example: "roletruth" },
  });
  await sandbox.connect();
  await sandbox.files.write("/tmp/input.json", JSON.stringify([capture]));
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

  console.log(
    JSON.stringify(
      {
        browserSessionId: capture.browserSessionId,
        sandboxId: sandbox.id,
        source: {
          requestedUrl: capture.requestedUrl,
          finalUrl: capture.finalUrl,
          textSha256: capture.textSha256,
          screenshotSha256: capture.screenshotSha256,
        },
        findings: report.findings.map(
          ({ field, status, conclusion, evidenceIds }) => ({
            field,
            status,
            conclusion,
            evidenceIds,
          }),
        ),
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
