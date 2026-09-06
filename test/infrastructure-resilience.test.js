import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
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
