import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { keccak256 } from "ethers";
import { prepareAssistCanary, ASSIST_ABI, ASSIST_COLLECTION } from "../lib/droid-os/assist-canary.mjs";

const owner = `0x${"a".repeat(40)}`;
const other = `0x${"b".repeat(40)}`;
const blockHash = `0x${"a".repeat(64)}`;
const now = 1_800_000_000;
const registry = `0x${"1".repeat(40)}`;
const account = `0x${"2".repeat(40)}`;
const badge = `0x${"3".repeat(40)}`;
const codes = { [registry]: "0x6001", [account]: "0x6002", [badge]: "0x6003" };
const manifest = { version: 1, chainId: 143, tokenId: "11", collection: ASSIST_COLLECTION,
  registry, account, badge, registryRuntimeHash: keccak256(codes[registry]),
  accountRuntimeHash: keccak256(codes[account]), badgeRuntimeHash: keccak256(codes[badge]) };

function fixture(overrides = {}) {
  const calls = [];
  const liveCode = JSON.parse(readFileSync(new URL("./fixtures/droid-assist-season2-runtime.json", import.meta.url))).code;
  async function rpc(method, params) {
    calls.push({ method, params });
    if (overrides.rpcFailure) throw Error("RPC unavailable");
    if (method === "eth_chainId") return overrides.chain ?? "0x8f";
    if (method === "eth_getBlockByNumber") return { number: "0x64", hash: params[0] !== "latest" && overrides.reorg ? `0x${"b".repeat(64)}` : blockHash,
      timestamp: `0x${(overrides.timestamp ?? now).toString(16)}` };
    if (method === "eth_getCode") return overrides.changedCode ? "0x" : params[0] === ASSIST_COLLECTION ? liveCode : codes[params[0]];
    if (method === "eth_estimateGas") return overrides.gas ?? "0x249f0";
    if (method === "eth_gasPrice") return overrides.gasPrice ?? "0x17bfac7c00";
    assert.equal(method, "eth_call", "Only read RPC methods may be requested");
    const parsed = ASSIST_ABI.parseTransaction({ data: params[0].data });
    const answers = { CHAIN_ID: 143n, TOKEN_ID: 11n, COLLECTION: ASSIST_COLLECTION, predictAccount: account,
      account, badge, tokenChainId: 143n, tokenId: 11n, collection: ASSIST_COLLECTION,
      ownerOf: owner, currentOwner: owner, hasMinted: false, actionNonce: 0n, mintCanary: 1n,
      ...overrides.answers };
    if (parsed.name === "mintCanary" && overrides.simulationFailure) throw Error("Simulation reverted");
    if (parsed.name === "mintCanary" && overrides.malformedSimulation) return "0x";
    return ASSIST_ABI.encodeFunctionResult(parsed.name, [answers[parsed.name]]);
  }
  return { rpc, calls };
}
const prepare = overrides => prepareAssistCanary({ manifest, owner, now, rpc: fixture(overrides).rpc });

test("prepares exact zero-value owner call with bounded gas and explicit simulation coverage", async () => {
  const { rpc, calls } = fixture();
  const result = await prepareAssistCanary({ manifest, owner, now, rpc });
  assert.equal(result.status, "PREPARED_NOT_SUBMITTED");
  assert.equal(result.transaction.to, account);
  assert.equal(result.transaction.from, owner);
  assert.equal(result.transaction.value, "0x0");
  assert.equal(result.simulation.genericStateDiffAvailable, false);
  assert.equal(result.maximumQuotedGasCostWei, "18360000000000000");
  assert.equal(result.expectedOutcome.recipient, account);
  const mintCalls = calls.filter(({ method, params }) => method === "eth_call" && ASSIST_ABI.parseTransaction({ data: params[0].data }).name === "mintCanary");
  assert.equal(mintCalls.length, 1);
  assert.equal(mintCalls[0].params[0].data, result.transaction.data);
  assert.equal(mintCalls[0].params[1], "0x64");
  assert(!calls.some(call => /send|sign|personal|wallet_/.test(call.method)));
});

test("manifest rejects arbitrary target/calldata and unknown durable schema fields", async () => {
  await assert.rejects(prepareAssistCanary({ manifest: { ...manifest, calldata: "0xdeadbeef" }, owner, now, rpc: fixture().rpc }));
  await assert.rejects(prepareAssistCanary({ manifest: { ...manifest, tokenId: "16" }, owner, now, rpc: fixture().rpc }));
  await assert.rejects(prepareAssistCanary({ manifest: { ...manifest, badge: account }, owner, now, rpc: fixture().rpc }));
});

for (const [name, overrides, pattern] of [
  ["wrong chain", { chain: "0x1" }, /Wrong chain/],
  ["stale block", { timestamp: now - 31 }, /Stale/],
  ["future block", { timestamp: now + 31 }, /future/],
  ["missing code", { changedCode: true }, /bytecode/],
  ["wrong registry binding", { answers: { predictAccount: other } }, /identity/],
  ["wrong canonical owner", { answers: { ownerOf: other } }, /canonical current owner/],
  ["wrong account owner", { answers: { currentOwner: other } }, /canonical current owner/],
  ["already minted", { answers: { hasMinted: true } }, /already minted/],
  ["simulation revert", { simulationFailure: true }, /Simulation reverted/],
  ["malformed simulation", { malformedSimulation: true }, /decode/],
  ["unexpected result", { answers: { mintCanary: 0n } }, /Unexpected/],
  ["gas above cap", { gas: "0xffffff" }, /cap/],
  ["fee above cap", { gasPrice: "0xffffffffff" }, /cap/],
  ["zero gas", { gas: "0x0" }, /cap/],
  ["RPC outage", { rpcFailure: true }, /unavailable/],
  ["reorganized block", { reorg: true }, /canonical/],
]) test(`fail closed: ${name}`, async () => { await assert.rejects(prepare(overrides), pattern); });

test("evidence binds current nonce and the exact account-specific action", async () => {
  const first = await prepare({});
  const next = await prepare({ answers: { actionNonce: 1n } });
  assert.notEqual(first.evidenceHash, next.evidenceHash);
  assert.notEqual(first.transaction.data, next.transaction.data);
  assert.equal(next.evidence.nonce, "1");
});
