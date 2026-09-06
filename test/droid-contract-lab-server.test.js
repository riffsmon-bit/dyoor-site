import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { createLabServer } from "../scripts/droid-contract-lab/server.mjs";

async function withServer(run, check) {
  const server = createLabServer(run);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}" };
  try { await check(origin, post); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test("console is readable but GET cannot start transactions", async () => {
  await withServer(() => { assert.fail("Must not execute"); }, async (origin) => {
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.match(await page.text(), /LOCAL CHAIN 31337/);
    assert.equal((await fetch(`${origin}/run`)).status, 405);
  });
});
test("host, origin, content type and fetch-site prevent cross-site execution", async () => {
  await withServer(() => { assert.fail("Must not execute"); }, async (origin, post) => {
    for (const override of [{ Origin: "https://evil.example" }, { Origin: "null" }, { "Content-Type": "text/plain" }, { "Sec-Fetch-Site": "cross-site" }]) {
      assert.equal((await fetch(`${origin}/run`, { ...post, headers: { ...post.headers, ...override } })).status, 403, JSON.stringify(override));
    }
    // fetch normalizes Host; use an actual raw HTTP Host header for DNS-rebinding coverage.
    const status = await new Promise((resolve, reject) => {
      const request = http.request(`${origin}/run`, { method: "POST", headers: { ...post.headers, Host: "evil.example" } }, response => { response.resume(); resolve(response.statusCode); });
      request.on("error", reject); request.end("{}");
    });
    assert.equal(status, 403);
  });
});
test("RPC/key/transaction injection, query parameters and oversized bodies are rejected", async () => {
  await withServer(() => { assert.fail("Must not execute"); }, async (origin, post) => {
    for (const body of ['{"rpc":"https://rpc.monad.xyz"}', '{"key":"injected"}', '{"transaction":{}}', "[]", ""]) assert.equal((await fetch(`${origin}/run`, { ...post, body })).status, 400);
    assert.equal((await fetch(`${origin}/run?chain=143`, post)).status, 404);
    assert.equal((await fetch(`${origin}/run`, { ...post, body: "x".repeat(129) })).status, 413);
  });
});
test("successful local run returns evidence and clears running status", async () => {
  const report = { status: "PASS", chainId: 31337, publicDeployment: false };
  await withServer(async () => report, async (origin, post) => {
    const response = await fetch(`${origin}/run`, post);
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), report);
    assert.deepEqual(await (await fetch(`${origin}/status`)).json(), { running: false, latest: report });
  });
});
test("failed runner never returns prior success or diagnostic secrets", async () => {
  await withServer(async () => { throw Error("internal diagnostic should not be exposed"); }, async (origin, post) => {
    const response = await fetch(`${origin}/run`, post);
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /internal diagnostic/);
    assert.deepEqual(await (await fetch(`${origin}/status`)).json(), { running: false, latest: null });
  });
});
test("concurrent runs cannot spawn multiple local chains", async () => {
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const done = new Promise(resolve => { release = resolve; });
  await withServer(async () => { entered(); await done; return { status: "PASS" }; }, async (origin, post) => {
    const first = fetch(`${origin}/run`, post);
    await started;
    assert.equal((await fetch(`${origin}/run`, post)).status, 409);
    release(); assert.equal((await first).status, 200);
  });
});
