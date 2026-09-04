import assert from "node:assert/strict";
import test from "node:test";

test("production worker renders the RoleTruth working surface", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /RoleTruth/);
  assert.match(html, /What does the role actually say\?/);
  assert.match(html, /Claim matrix/);
  assert.match(html, /evidence spans admitted/);
  assert.doesNotMatch(html, /Starter Project/);
});
