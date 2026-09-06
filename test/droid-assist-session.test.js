import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Interface, keccak256 } from "ethers";
import { ASSIST_ABI } from "../lib/droid-os/assist-canary.mjs";
import { ASSIST_DEPLOYMENT as m, boundedAssistRpc, readAssistState, prepareAssistStep, validateAssistSubmission, reconcileAssistReceipt } from "../lib/droid-os/assist-session.mjs";

const owner = `0x${"a".repeat(40)}`, other = `0x${"b".repeat(40)}`, zero = `0x${"0".repeat(40)}`;
const hash = `0x${"a".repeat(64)}`, otherHash = `0x${"b".repeat(64)}`;
const codes = JSON.parse(readFileSync(new URL("./fixtures/droid-assist-deployed-code.json", import.meta.url)));
const season2 = JSON.parse(readFileSync(new URL("./fixtures/droid-assist-season2-runtime.json", import.meta.url))).code;
const events = new Interface([
  "function optIn() returns(address)",
  "event AssistCanaryOptedIn(address indexed account,address indexed owner,address indexed badge)",
  "event AssistMintExecuted(uint256 indexed nonce,address indexed owner,bytes32 indexed evidenceHash,address target,uint256 mintedTokenId,uint64 deadline)",
]);
function fixture(o = {}) {
  const calls = [];
  const now = Math.floor(Date.now() / 1000);
  const rpc = async (method, params) => {
    calls.push(method);
    if (method === "eth_chainId") return o.chain ?? "0x8f";
    if (method === "eth_getBlockByNumber") return { number: "0x64", hash: o.reorg ? otherHash : hash, timestamp: `0x${now.toString(16)}` };
    if (method === "eth_getCode") {
      if (o.badCode) return "0x";
      if (params[0].toLowerCase() === m.collection.toLowerCase()) return season2;
      const key = ["registry", "account", "badge"].find(key => m[key].toLowerCase() === params[0].toLowerCase());
      return key === "account" && !o.active ? "0x" : codes[key];
    }
    if (method === "eth_gasPrice") return "0x17bfac7c00";
    if (method === "eth_estimateGas") return o.gas ?? (o.active ? "0x249f0" : "0x111700");
    if (method === "eth_getTransactionReceipt") return o.receipt ?? null;
    if (method === "eth_getTransactionByHash") return o.tx;
    if (method === "eth_blockNumber") return o.height ?? "0x66";
    assert.equal(method, "eth_call");
    if (params[0].data === events.encodeFunctionData("optIn")) return events.encodeFunctionResult("optIn", [m.account]);
    const parsed = ASSIST_ABI.parseTransaction({ data: params[0].data });
    const answers = { CHAIN_ID: 143n, TOKEN_ID: 11n, COLLECTION: m.collection, predictAccount: m.account,
      account: o.active ? m.account : zero, badge: m.badge, tokenChainId: 143n, tokenId: 11n,
      collection: m.collection, ownerOf: o.owner ?? owner, currentOwner: o.owner ?? owner,
      hasMinted: o.minted ?? false, actionNonce: o.nonce ?? 0n, mintCanary: 1n };
    return ASSIST_ABI.encodeFunctionResult(parsed.name, [answers[parsed.name]]);
  };
  return { rpc, calls };
}
const prepare = (kind = "ACTIVATE") => prepareAssistStep(fixture({ active: kind === "MINT" }).rpc, owner, kind);

test("ASSIST route uses the build-context-filtered preview constant, not runtime environment enumeration", () => {
  const page = readFileSync(new URL("../app/droid-os/assist/page.tsx", import.meta.url), "utf8");
  const config = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
  assert.match(page, /process\.env\.DROID_OS_UI_PREVIEW !== "true"/);
  assert.doesNotMatch(page, /droidOsPreviewEnabled\(process\.env\)/);
  assert.match(config, /DROID_OS_UI_PREVIEW: droidOsPreviewEnabled\(process\.env\)/);
});

test("pinned public runtime fixtures match deployed canary manifest", () => {
  for (const key of ["registry", "account", "badge"]) assert.equal(keccak256(codes[key]), m[`${key}RuntimeHash`]);
});
test("read-only provider boundary rejects signing and arbitrary RPC", async () => {
  let called = false;
  const rpc = boundedAssistRpc({ request: async () => { called = true; } });
  await assert.rejects(rpc("eth_sendTransaction", []), /denied/);
  await assert.rejects(rpc("personal_sign", []), /denied/);
  assert.equal(called, false);
});
test("canonical deployed and unactivated states are distinct", async () => {
  assert.equal((await readAssistState(fixture().rpc)).active, false);
  assert.equal((await readAssistState(fixture({ active: true }).rpc)).active, true);
  await assert.rejects(readAssistState(fixture({ badCode: true }).rpc), /code/);
  await assert.rejects(readAssistState(fixture({ chain: "0x1" }).rpc), /143/);
});
test("activation and mint plans use only fixed targets and zero value", async () => {
  for (const kind of ["ACTIVATE", "MINT"]) {
    const plan = await prepare(kind);
    assert.equal(plan.transaction.value, "0x0");
    assert.equal(plan.transaction.to.toLowerCase(), (kind === "ACTIVATE" ? m.registry : m.account).toLowerCase());
    assert.deepEqual(await validateAssistSubmission(fixture({ active: kind === "MINT" }).rpc, owner, plan), plan.transaction);
  }
});
test("activation refuses non-owner and excessive gas", async () => {
  await assert.rejects(prepareAssistStep(fixture().rpc, other, "ACTIVATE"), /current owner/);
  await assert.rejects(prepareAssistStep(fixture({ gas: "0xffffff" }).rpc, owner, "ACTIVATE"), /cap/);
});
for (const kind of ["ACTIVATE", "MINT"]) {
  test(`${kind}: submission rejects changed owner, unknown transaction fields and wrong target`, async () => {
    const plan = await prepare(kind), active = kind === "MINT";
    await assert.rejects(validateAssistSubmission(fixture({ active, owner: other }).rpc, owner, plan), /owner/);
    for (const modification of [{ authorizationList: [] }, { input: "0x" }, { to: other }, { value: "0x1" }, { chainId: "0x1" }]) {
      await assert.rejects(validateAssistSubmission(fixture({ active }).rpc, owner, { ...plan, transaction: { ...plan.transaction, ...modification } }));
    }
  });
  test(`${kind}: calldata suffix cannot escape the approved builder`, async () => {
    const plan = await prepare(kind);
    plan.transaction.data += "00";
    plan.transactionDataHash = keccak256(plan.transaction.data);
    await assert.rejects(validateAssistSubmission(fixture({ active: kind === "MINT" }).rpc, owner, plan));
  });
}
test("mint refuses stale nonce and completed badge state", async () => {
  const plan = await prepare("MINT");
  await assert.rejects(validateAssistSubmission(fixture({ active: true, nonce: 1n }).rpc, owner, plan), /Re-prepare/);
  await assert.rejects(validateAssistSubmission(fixture({ active: true, minted: true }).rpc, owner, plan), /Re-prepare/);
});
test("activation refuses expired review", async () => {
  const plan = await prepare(); plan.expiresAt = "1";
  await assert.rejects(validateAssistSubmission(fixture().rpc, owner, plan), /Re-prepare/);
});

async function receiptFixture(kind = "ACTIVATE") {
  const plan = await prepare(kind);
  const args = kind === "MINT" ? ASSIST_ABI.decodeFunctionData("mintCanary", plan.transaction.data) : null;
  const event = events.encodeEventLog(events.getEvent(kind === "ACTIVATE" ? "AssistCanaryOptedIn" : "AssistMintExecuted"),
    kind === "ACTIVATE" ? [m.account, owner, m.badge] : [args.expectedNonce, owner, plan.evidenceHash, m.badge, 1n, args.deadline]);
  return { pending: { plan, hash }, tx: { from: owner, to: plan.transaction.to, value: "0x0", input: plan.transaction.data },
    receipt: { transactionHash: hash, blockHash: hash, blockNumber: "0x64", status: "0x1", logs: [{ address: plan.transaction.to, ...event }] } };
}
for (const kind of ["ACTIVATE", "MINT"]) test(`${kind}: receipt must match exact transaction and emitted audit evidence`, async () => {
  const data = await receiptFixture(kind);
  assert.equal((await reconcileAssistReceipt(fixture(data).rpc, data.pending)).status, "CONFIRMED");
  for (const modification of [{ from: other }, { to: other }, { input: "0xdeadbeef" }, { value: "0x1" }]) {
    await assert.rejects(reconcileAssistReceipt(fixture({ ...data, tx: { ...data.tx, ...modification } }).rpc, data.pending), /prepared action/);
  }
  await assert.rejects(reconcileAssistReceipt(fixture({ ...data, receipt: { ...data.receipt, logs: [{ ...data.receipt.logs[0], address: other }] } }).rpc, data.pending), /event/);
});
test("unconfirmed, missing and reorged receipts stay pending; reverted receipts never succeed", async () => {
  const data = await receiptFixture();
  for (const modification of [{ receipt: null }, { height: "0x65" }, { reorg: true }]) {
    assert.equal((await reconcileAssistReceipt(fixture({ ...data, ...modification }).rpc, data.pending)).status, "PENDING");
  }
  assert.equal((await reconcileAssistReceipt(fixture({ ...data, receipt: { ...data.receipt, status: "0x0" } }).rpc, data.pending)).status, "REVERTED");
  await assert.rejects(reconcileAssistReceipt(fixture({ ...data, receipt: { ...data.receipt, status: "0x2" } }).rpc, data.pending), /Unknown/);
});
test("unknown action kinds cannot be reconciled as a mint", async () => {
  const data = await receiptFixture("MINT"); data.pending.plan.kind = "SWAP";
  await assert.rejects(reconcileAssistReceipt(fixture(data).rpc, data.pending), /Unsupported/);
});
