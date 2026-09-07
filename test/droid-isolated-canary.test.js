import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ISOLATED_CANARY, validateIsolatedCanaryArtifact, boundedCanaryGas, prepareIsolatedCanaryDeployment, canaryRpcUint, classifyCanaryOwnerCode } from "../lib/droid-os/swaps/isolated-canary-preflight.ts";
test("direct-owner classification recognizes exact 7702 designators, not arbitrary contract code", () => {
  assert.deepEqual(classifyCanaryOwnerCode("0x"), {kind:"EOA",delegate:null});
  assert.deepEqual(classifyCanaryOwnerCode("0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b"),
    {kind:"EIP7702_EOA",delegate:"0x63c0c19a282a1b52b07dd5a65b58948a07dae32b"});
  for (const code of ["0x6000","0xef0100","0xef0100"+"ff".repeat(21),"0xef0101"+"ff".repeat(20)])
    assert.throws(() => classifyCanaryOwnerCode(code));
});
test("RPC nonces and prices reject decimal, negative, padded and overflowing values", () => {
  assert.equal(canaryRpcUint("0x0"),0n); assert.equal(canaryRpcUint("0x11fa"),4602n);
  for (const value of [1,"1","-1","0x00","0x01","0x-1","0x","0x"+"1"+"0".repeat(64),null])
    assert.throws(() => canaryRpcUint(value));
});
test("gas bounds never silently accept an unlimited owner bill", () => {
  assert.equal(boundedCanaryGas(1000000n, 100000000000n).feeWei, 120000000000000000n);
  for (const [estimate, price] of [[0n,1n],[2500001n,1n],[1n,0n],[1n,300000000001n]])
    assert.throws(() => boundedCanaryGas(estimate,price));
});
test("unknown artifacts cannot reach an RPC or prepare a deployment", async () => {
  let called = false; const rpc = { send() { called=true; throw Error("must not call"); } };
  for (const code of ["0x", "0x6000", "0xzz", "0x0", "0x"+"ff".repeat(49153)]) {
    assert.throws(() => validateIsolatedCanaryArtifact(code,"0x6000"));
    await assert.rejects(prepareIsolatedCanaryDeployment(rpc,code,"0x6000"));
  }
  assert.equal(called,false);
});
test("canary constants do not describe delegated or collection-wide trading", () => {
  assert.equal(ISOLATED_CANARY.tokenId,"11"); assert.equal(ISOLATED_CANARY.maxBuys,1);
  assert.equal(ISOLATED_CANARY.maxSells,1); assert.equal(ISOLATED_CANARY.maxNativeTradeWei,"1000000000000000");
  assert.equal(ISOLATED_CANARY.maxFundingWei,"1100000000000000");
  const script=readFileSync(new URL("../scripts/preflight-droid-swap-canary.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(script,/eth_sendTransaction|eth_sendRawTransaction|privateKey|process\.env|(?:from\s*|import\s*)["']dotenv|Wallet\(/);
  const source=readFileSync(new URL("../lib/droid-os/swaps/isolated-canary-preflight.ts",import.meta.url),"utf8");
  assert.match(source,/deploymentAuthorized: false/); assert.match(source,/broadcastEnabled: false/);
  assert.match(source,/autonomousTradingEnabled: false/);
});
