import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { withReadTimeout } from "../lib/read-timeout.ts";
import { fetchIpfsImageBuffer } from "../lib/ipfs-image-fetch.ts";
import {
  configuredIpfsGateways,
  ipfsGatewayUrls,
} from "../lib/ipfs-gateway.ts";

test("the DYOOR gateway is preferred without changing the canonical IPFS URI", () => {
  const previous = process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL;
  process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL = "https://ipfs.dyoor.fun/";
  try {
    assert.equal(configuredIpfsGateways()[0], "https://ipfs.dyoor.fun");
    assert.deepEqual(
      ipfsGatewayUrls("ipfs://bafytest/1.png").slice(0, 1),
      ["https://ipfs.dyoor.fun/ipfs/bafytest/1.png"],
    );
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL;
    else process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL = previous;
  }
});

test("IPFS URLs normalize gateway suffixes and preserve reroll render URLs", () => {
  const previous = process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL;
  process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL = "https://ipfs.dyoor.fun/ipfs/";
  try {
    const urls = ipfsGatewayUrls("ipfs://bafytest/3.png");
    assert.equal(urls[0], "https://ipfs.dyoor.fun/ipfs/bafytest/3.png");
    assert.ok(urls.includes("https://jade-efficient-beaver-697.mypinata.cloud/ipfs/bafytest/3.png"));
    assert.deepEqual(ipfsGatewayUrls(urls[0]), urls);
    assert.deepEqual(ipfsGatewayUrls("/api/s2/trait-lab/render/new-version"), ["/api/s2/trait-lab/render/new-version"]);
    assert.deepEqual(ipfsGatewayUrls("data:image/png;base64,abc"), ["data:image/png;base64,abc"]);
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL;
    else process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL = previous;
  }
});

test("Monad reads have multiple keyless providers and keep Alchemy last", () => {
  const source = fs.readFileSync("lib/monad-rpc.ts", "utf8");
  for (const endpoint of ["rpc.monad.xyz", "rpc1.monad.xyz", "rpc2.monad.xyz", "rpc3.monad.xyz", "rpc-mainnet.monadinfra.com"]) {
    assert.match(source, new RegExp(endpoint.replaceAll(".", "\\.")));
  }
  assert.ok(source.indexOf("...MONAD_PUBLIC_RPC_URLS") < source.indexOf("...keyed"));
  assert.match(source, /freeUrls = allUrls\.filter\(\(url\) => !\/alchemy\/i\.test\(url\)\)/);
  assert.match(source, /quorum: 1/);
});

test("Energy display reads use the keyless fallback pool and preserve authoritative accounting", () => {
  const route = fs.readFileSync("app/api/energy/[wallet]/route.ts", "utf8");
  assert.match(route, /const provider = createMonadReadProvider\(\)/);
  assert.match(route, /readPendingEnergyRaw\(wallet, provider\)/);
  assert.match(route, /withReadTimeout\(readEnergyBankBalance\(wallet, provider\), 8_000\)/);
  assert.doesNotMatch(route, /energyRpcProvider/);
  assert.match(route, /if \(!bankBalance\)\s*\{\s*return json\(503/);
  assert.match(route, /serverSettledDebitRaw: traitLabDebits.debitRaw/);
  assert.match(route, /spentRaw = effective.spentRaw/);
});

test("Energy remote-read deadlines reject hangs and preserve valid zero values", async () => {
  assert.equal(await withReadTimeout(Promise.resolve(0n), 100), 0n);
  await assert.rejects(withReadTimeout(Promise.reject(new Error("RPC failed")), 100), /RPC failed/);
  await assert.rejects(withReadTimeout(new Promise(() => {}), 10), /temporarily unavailable/);
});

test("Energy display surfaces failures with retry and rejects stale wallet responses", () => {
  const source = fs.readFileSync("components/s2/TraitLabClient.tsx", "utf8");
  assert.match(source, /Retry Energy balance/);
  assert.match(source, /energy\?\.ok === false \? "Unavailable"/);
  assert.match(source, /energy\?\.spendableEnergy \?\? "-"/);
  assert.match(source, /energy\?\.spentEnergy \?\? "-"/);
  assert.match(source, /signal: AbortSignal.timeout\(15_000\)/);
  assert.match(source, /requestId === energyRequestRef.current/);
  assert.match(source, /typeof data.spendableEnergy !== "string"/);
});

test("World holder reads are bounded and IPFS admin is not publicly mapped", () => {
  const world = fs.readFileSync("lib/dyoor-world-server.ts", "utf8");
  const compose = fs.readFileSync("infra/ipfs/compose.yaml", "utf8");
  const init = fs.readFileSync("infra/ipfs/init/001-dyoor-gateway.sh", "utf8");
  assert.match(world, /withWorldReadTimeout/);
  assert.doesNotMatch(compose, /5001:5001/);
  assert.match(init, /Gateway\.NoFetch true/);
});

test("S2 ownership discovery skips the unsupported enumerable probe by default", () => {
  const source = fs.readFileSync("lib/s2-trait-lab-public.ts", "utf8");
  assert.match(source, /enumerableOwnershipEnabled\(\)/);
  assert.match(source, /balance > 0 && enumerableOwnershipEnabled\(\)/);
});

test("reroll documentation keeps the contract on dynamic dyoor.fun metadata", () => {
  const docs = fs.readFileSync("docs/self-hosted-ipfs.md", "utf8");
  assert.match(docs, /contract base URI must be `https:\/\/dyoor\.fun\/api\/metadata\/`/);
  assert.match(docs, /does not require an on-chain update/);
});

test("server-side reroll layers retry failed gateways and bound each request", async () => {
  const originalFetch = globalThis.fetch;
  const originalGateway = process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL;
  const calls = [];
  process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL = "https://ipfs.dyoor.fun";
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    assert.ok(options.signal instanceof AbortSignal);
    if (calls.length === 1) throw new Error("Gateway unavailable");
    return new Response(new Uint8Array([1, 2, 3]));
  };
  try {
    assert.deepEqual(await fetchIpfsImageBuffer("ipfs://bafytest/layer.png"), Buffer.from([1, 2, 3]));
    assert.equal(calls[0], "https://ipfs.dyoor.fun/ipfs/bafytest/layer.png");
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalGateway === undefined) delete process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL;
    else process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL = originalGateway;
  }
});

test("saved reroll image URLs are never replaced by version-one IPFS artwork", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(url); return new Response(null, { status: 404 }); };
  try {
    const saved = "https://dyoor.fun/api/s2/trait-lab/render/16-v6-existing";
    assert.equal(await fetchIpfsImageBuffer(saved), null);
    assert.deepEqual(calls, [saved]);
  } finally { globalThis.fetch = originalFetch; }
});

test("hosted IPFS administration is private and backing-store credentials are not in config", () => {
  const start = fs.readFileSync("infra/ipfs/railway/start.sh", "utf8");
  const caddy = fs.readFileSync("infra/ipfs/railway/Caddyfile", "utf8");
  assert.match(start, /Addresses.API \/ip4\/127\.0\.0\.1\/tcp\/5001/);
  assert.match(start, /Gateway.NoFetch true/);
  assert.match(start, /accessKey:"",secretKey:""/);
  assert.doesNotMatch(caddy, /reverse_proxy.*5001/);
  assert.match(caddy, /DYOOR assets only/);
  assert.match(start, /Datastore.HashOnRead true/);
  assert.match(start, /Addresses.Announce/);
  assert.match(start, /Swarm.AddrFilters/);
  assert.match(start, /100\.64\.0\.0\/ipcidr\/10/);
  assert.match(start, /until curl.*127\.0\.0\.1:5001\/api\/v0\/id/);
  assert.match(start, /\/proc\/\$1\/stat/);
  assert.match(start, /Internal.ShutdownTimeout 10s/);
  assert.match(start, /unhealthy=\$\(\(unhealthy \+ 1\)\)/);
  assert.doesNotMatch(caddy, /respond "DYOOR IPFS gateway online" 200/);
  for (const cid of fs.readFileSync("infra/ipfs/dyoor-cids.txt", "utf8").split(/\r?\n/).map(line => line.replace(/#.*/, "").trim()).filter(Boolean)) {
    assert.ok(caddy.includes(`/ipfs/${cid}/*`), `Missing gateway allowlist for ${cid}`);
  }
});

test("hosted block storage bounds connection reuse and request duration", () => {
  const transport = fs.readFileSync("infra/ipfs/railway/transport.go", "utf8");
  const docker = fs.readFileSync("infra/ipfs/railway/Dockerfile", "utf8");
  assert.match(transport, /MaxConnsPerHost = 64/);
  assert.match(transport, /MaxIdleConnsPerHost = 32/);
  assert.match(transport, /Timeout: 60 \* time.Second/);
  assert.match(docker, /WithHTTPClient\(dyoorS3HTTPClient\(\)\)/);
});
