import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
});

after(async () => {
  await vite.close();
});

async function modules() {
  const engine = await vite.ssrLoadModule("/lib/roletruth-engine.ts");
  const demo = await vite.ssrLoadModule("/lib/demo-data.ts");
  return { engine, demo };
}

test("golden fixture confirms explicit claims and abstains on missing terms", async () => {
  const { engine, demo } = await modules();
  const report = engine.buildReport(demo.demoFixture, false);
  const byField = new Map(report.findings.map((finding) => [finding.field, finding]));

  assert.equal(byField.get("work_mode").status, "confirmed");
  assert.equal(byField.get("work_mode").conclusion, "Remote");
  assert.equal(byField.get("compensation_basis").conclusion, "$300,000 annualized");
  assert.equal(byField.get("actual_paid_total").status, "unknown");
  assert.equal(byField.get("duration").status, "unknown");
  assert.equal(byField.get("employment_type").status, "unknown");
});

test("synthetic onsite evidence changes only work mode to conflicted", async () => {
  const { engine, demo } = await modules();
  const base = engine.buildReport(demo.demoFixture, false);
  const attacked = engine.buildReport(demo.demoFixture, true);
  const baseByField = new Map(base.findings.map((finding) => [finding.field, finding]));
  const attackedByField = new Map(
    attacked.findings.map((finding) => [finding.field, finding]),
  );

  assert.equal(baseByField.get("work_mode").status, "confirmed");
  assert.equal(attackedByField.get("work_mode").status, "conflicted");
  assert.match(attackedByField.get("work_mode").conclusion, /Remote/);
  assert.match(attackedByField.get("work_mode").conclusion, /Hybrid/);

  for (const [field, finding] of baseByField) {
    if (field !== "work_mode") {
      assert.equal(attackedByField.get(field).status, finding.status);
      assert.equal(attackedByField.get(field).conclusion, finding.conclusion);
    }
  }
});

test("no confirmed finding is allowed without linked evidence", async () => {
  const { engine, demo } = await modules();
  const report = engine.buildReport(demo.demoFixture, false);
  const invalid = report.findings.filter(
    (finding) => finding.status === "confirmed" && finding.evidenceIds.length === 0,
  );
  assert.deepEqual(invalid, []);
});

test("calculation is labeled as a scenario rather than quoted compensation", async () => {
  const { engine, demo } = await modules();
  const report = engine.buildReport(demo.demoFixture, false);
  const scenario = report.findings.find(
    (finding) => finding.field === "three_month_full_time_scenario",
  );
  assert.equal(scenario.status, "calculated");
  assert.equal(scenario.conclusion, "$75,000");
  assert.match(scenario.explanation, /not a quoted or promised payout/i);
  assert.equal(report.calculations[0].formula, "$300,000 / year × 3 / 12 × 1.0 FTE");
});

test("canonical report serialization is stable", async () => {
  const { engine, demo } = await modules();
  const first = engine.canonicalReport(engine.buildReport(demo.demoFixture, false));
  const second = engine.canonicalReport(engine.buildReport(demo.demoFixture, false));
  assert.equal(first, second);
});

test("SHA-256 helper matches the standard vector", async () => {
  const { engine } = await modules();
  assert.equal(
    await engine.sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("URL guard permits an ordinary public HTTPS source", async () => {
  const { validatePublicUrl } = await vite.ssrLoadModule("/lib/url-security.ts");
  assert.equal(
    validatePublicUrl("https://example.com/jobs?id=42"),
    "https://example.com/jobs?id=42",
  );
});

test("URL guard rejects local, private, metadata, credential and unsafe targets", async () => {
  const { validatePublicUrl } = await vite.ssrLoadModule("/lib/url-security.ts");
  const blocked = [
    "http://127.0.0.1",
    "http://2130706433",
    "http://10.0.0.2",
    "http://172.16.0.1",
    "http://192.168.1.2",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]",
    "http://[fd00::1]",
    "http://user:password@example.com",
    "file:///etc/passwd",
    "javascript:alert(1)",
  ];
  for (const value of blocked) {
    assert.throws(() => validatePublicUrl(value), undefined, value);
  }
});
