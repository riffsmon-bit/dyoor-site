import { Interface, keccak256 } from "ethers";
import deployment from "./assist-deployment.json" with { type: "json" };
import { ASSIST_ABI, prepareAssistCanary } from "./assist-canary.mjs";
import { requireAssistMonad } from "./assist-network.mjs";
import { ASSIST_TEST_BADGE_ID, BADGE_WITHDRAW_ABI, prepareTestBadgeWithdrawal,
  validateTestBadgeWithdrawal, verifyTestBadgeWithdrawalReceipt } from "./assist-withdraw.mjs";

export const ASSIST_DEPLOYMENT = Object.freeze(deployment);
const REGISTRY = new Interface([
  "function optIn() returns(address)",
  "event AssistCanaryOptedIn(address indexed account,address indexed owner,address indexed badge)",
  "event AssistMintExecuted(uint256 indexed nonce,address indexed owner,bytes32 indexed evidenceHash,address target,uint256 mintedTokenId,uint64 deadline)",
]);
const equal = (a, b) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
export const ASSIST_SESSION_KEY = "dyoor.assist.canary143.pending.v1";
const m = ASSIST_DEPLOYMENT;

/** Every request is read-only, bounded, and sent through the selected wallet's provider. */
export function boundedAssistRpc(provider) {
  const allowed = new Set(["eth_chainId", "eth_getCode", "eth_call", "eth_estimateGas", "eth_gasPrice",
    "eth_getBlockByNumber", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_blockNumber"]);
  return async (method, params) => {
    if (!allowed.has(method)) throw Error("Non-read method denied");
    let timer;
    try {
      return await Promise.race([provider.request({ method, params }), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error("Wallet RPC timed out. Nothing has been submitted by this check.")), 12000);
      })]);
    } finally { clearTimeout(timer); }
  };
}

export async function readAssistState(rpc) {
  await requireAssistMonad(rpc);
  const block = await rpc("eth_getBlockByNumber", ["latest", false]);
  if (!block?.number || !block?.hash || !block?.timestamp) throw Error("Canonical block unavailable.");
  const read = async (to, name, args = []) => ASSIST_ABI.decodeFunctionResult(name,
    await rpc("eth_call", [{ to, data: ASSIST_ABI.encodeFunctionData(name, args) }, block.number]))[0];
  for (const [target, hash] of [[m.collection, "0x2baa62e8fad053a2b59e10eb8dbfc9bbb8ef98c93a55a1114ff7776226ae15fd"],
    [m.registry, m.registryRuntimeHash], [m.badge, m.badgeRuntimeHash]]) {
    if (keccak256(await rpc("eth_getCode", [target, block.number])) !== hash) throw Error("Unrecognized contract code. Testing disabled.");
  }
  if (!equal(await read(m.registry, "predictAccount"), m.account) || !equal(await read(m.registry, "badge"), m.badge)) throw Error("Registry binding mismatch.");
  const owner = await read(m.collection, "ownerOf", [11]);
  const deployed = await read(m.registry, "account");
  const active = !equal(deployed, `0x${"0".repeat(40)}`);
  const code = await rpc("eth_getCode", [m.account, block.number]);
  if (active) {
    if (!equal(deployed, m.account) || keccak256(code) !== m.accountRuntimeHash ||
      !equal(await read(m.account, "currentOwner"), owner) ||
      !equal(await read(m.account, "collection"), m.collection) ||
      !equal(await read(m.account, "badge"), m.badge) ||
      await read(m.account, "tokenId") !== 11n || await read(m.account, "tokenChainId") !== 143n) throw Error("Account identity mismatch.");
  } else if (code !== "0x") throw Error("Unexpected code at undeployed account address.");
  const minted = active ? await read(m.badge, "hasMinted", [m.account]) : false;
  const testBadgeOwner = minted ? await read(m.badge, "ownerOf", [ASSIST_TEST_BADGE_ID]) : null;
  return { owner, active, minted, testBadgeOwner,
    nonce: active ? (await read(m.account, "actionNonce")).toString() : "0", block };
}

export async function prepareAssistStep(rpc, owner, kind) {
  const state = await readAssistState(rpc);
  if (!equal(owner, state.owner)) throw Error("Only the current owner of Droid #11 can run this canary.");
  if (kind === "WITHDRAW_BADGE") return prepareTestBadgeWithdrawal(rpc, state, owner);
  if (kind === "MINT") {
    if (!state.active) throw Error("Activate the canary account first.");
    return { kind, ...await prepareAssistCanary({ manifest: m, owner, rpc }) };
  }
  if (kind !== "ACTIVATE" || state.active) throw Error("Activation is not available.");
  const tx = { from: owner, to: m.registry, value: "0x0", data: REGISTRY.encodeFunctionData("optIn") };
  const [predicted] = REGISTRY.decodeFunctionResult("optIn", await rpc("eth_call", [tx, state.block.number]));
  if (!equal(predicted, m.account)) throw Error("Activation simulation returned the wrong account.");
  const estimate = BigInt(await rpc("eth_estimateGas", [tx, state.block.number]));
  const gas = (estimate * 120n + 99n) / 100n;
  const gasPrice = BigInt(await rpc("eth_gasPrice", []));
  if (estimate <= 0n || gas > 1_600_000n || gasPrice <= 0n || gasPrice > 300_000_000_000n) throw Error("Activation gas exceeds the test cap.");
  return { kind, version: 1, status: "PREPARED_NOT_SUBMITTED", mode: "ASSIST",
    transaction: { ...tx, chainId: "0x8f", gas: `0x${gas.toString(16)}`, gasPrice: `0x${gasPrice.toString(16)}` },
    maximumQuotedGasCostWei: (gas * gasPrice).toString(), transactionDataHash: keccak256(tx.data),
    expiresAt: (BigInt(state.block.timestamp) + 120n).toString(),
    simulation: { success: true, coverage: "EXACT_ACTIVATION_CALL", blockHash: state.block.hash,
      blockNumber: BigInt(state.block.number).toString() } };
}

/** Revalidate the exact displayed transaction. This function never signs or submits. */
export async function validateAssistSubmission(rpc, owner, plan) {
  const state = await readAssistState(rpc);
  const tx = plan?.transaction;
  const keys = ["from", "to", "value", "data", "chainId", "gas", "gasPrice"];
  if (!tx || Object.keys(tx).length !== keys.length || Object.keys(tx).some(key => !keys.includes(key))) {
    throw Error("Unexpected transaction fields.");
  }
  if (!tx || !equal(state.owner, owner) || !equal(tx.from, owner) || tx.chainId !== "0x8f" || tx.value !== "0x0" ||
    plan.transactionDataHash !== keccak256(tx.data)) throw Error("Prepared action no longer matches its owner or contents.");
  const gas = BigInt(tx.gas), fee = BigInt(tx.gasPrice);
  if (gas <= 0n || fee <= 0n || fee > 300_000_000_000n) throw Error("Invalid gas limits.");
  if (plan.kind === "ACTIVATE") {
    if (state.active || !equal(tx.to, m.registry) || tx.data !== REGISTRY.encodeFunctionData("optIn") ||
      gas > 1_600_000n || BigInt(plan.expiresAt) <= BigInt(state.block.timestamp)) throw Error("Re-prepare activation.");
  } else if (plan.kind === "MINT") {
    const args = ASSIST_ABI.decodeFunctionData("mintCanary", tx.data);
    if (ASSIST_ABI.encodeFunctionData("mintCanary", [args.expectedNonce, args.deadline, args.evidenceHash]) !== tx.data) throw Error("Unexpected calldata suffix.");
    if (!state.active || state.minted || !equal(tx.to, m.account) || gas > 400_000n ||
      args.expectedNonce.toString() !== state.nonce || args.deadline <= BigInt(state.block.timestamp) ||
      args.evidenceHash !== plan.evidenceHash) throw Error("Re-prepare the mint; account state or deadline changed.");
  } else if (plan.kind === "WITHDRAW_BADGE") validateTestBadgeWithdrawal(state, owner, plan);
  else throw Error("Unsupported canary action.");
  const result = await rpc("eth_call", [tx, "latest"]);
  if (plan.kind === "WITHDRAW_BADGE" && result !== "0x") throw Error("Unexpected withdrawal simulation result.");
  if (BigInt(await rpc("eth_estimateGas", [tx, "latest"])) > gas) throw Error("Gas estimate changed. Re-prepare before confirming.");
  return tx;
}

/** A receipt is accepted only for the exact prepared envelope and its expected contract event. */
export async function reconcileAssistReceipt(rpc, pending) {
  if (!["ACTIVATE", "MINT", "WITHDRAW_BADGE"].includes(pending?.plan?.kind)) throw Error("Unsupported canary action.");
  if (!/^0x[\da-fA-F]{64}$/.test(pending?.hash ?? "")) throw Error("A transaction hash is required for reconciliation.");
  if (BigInt(await rpc("eth_chainId", [])) !== 143n) throw Error("Wrong receipt chain.");
  const receipt = await rpc("eth_getTransactionReceipt", [pending.hash]);
  if (!receipt) return { status: "PENDING" };
  const tx = await rpc("eth_getTransactionByHash", [pending.hash]);
  const wanted = pending.plan.transaction;
  if (!tx || !equal(tx.to, wanted.to) || !equal(tx.from, wanted.from) || BigInt(tx.value) !== 0n || tx.input !== wanted.data ||
    !equal(receipt.transactionHash, pending.hash)) throw Error("Receipt does not belong to this prepared action.");
  const block = await rpc("eth_getBlockByNumber", [receipt.blockNumber, false]);
  if (!equal(block?.hash, receipt.blockHash)) return { status: "PENDING" };
  const latest = BigInt(await rpc("eth_blockNumber", []));
  if (latest < BigInt(receipt.blockNumber) + 2n) return { status: "PENDING" };
  if (BigInt(receipt.status) === 0n) return { status: "REVERTED", hash: pending.hash };
  if (BigInt(receipt.status) !== 1n) throw Error("Unknown receipt status.");
  if (pending.plan.kind === "WITHDRAW_BADGE") {
    verifyTestBadgeWithdrawalReceipt(receipt, pending.plan);
    const [recipient] = BADGE_WITHDRAW_ABI.decodeFunctionResult("ownerOf", await rpc("eth_call", [{
      to: m.badge, data: BADGE_WITHDRAW_ABI.encodeFunctionData("ownerOf", [ASSIST_TEST_BADGE_ID]),
    }, receipt.blockNumber]));
    if (!equal(recipient, wanted.from)) throw Error("Test badge owner at receipt block differs from the approved destination.");
    return { status: "CONFIRMED", hash: pending.hash, blockNumber: BigInt(receipt.blockNumber).toString(),
      mintedTokenId: null, withdrawnTokenId: ASSIST_TEST_BADGE_ID };
  }
  const expectedName = pending.plan.kind === "ACTIVATE" ? "AssistCanaryOptedIn" : "AssistMintExecuted";
  const expectedAddress = pending.plan.kind === "ACTIVATE" ? m.registry : m.account;
  const event = receipt.logs.filter(log => equal(log.address, expectedAddress)).map(log => {
    try { return REGISTRY.parseLog(log); } catch { return null; }
  }).find(log => log?.name === expectedName);
  if (!event || !equal(event.args.owner, wanted.from)) throw Error("Expected canary audit event is missing.");
  if (pending.plan.kind === "ACTIVATE") {
    if (!equal(event.args.account, m.account) || !equal(event.args.badge, m.badge)) throw Error("Activation event mismatch.");
  } else if (!equal(event.args.target, m.badge) || event.args.evidenceHash !== pending.plan.evidenceHash ||
      event.args.nonce.toString() !== pending.plan.evidence.nonce) throw Error("Mint evidence mismatch.");
  return { status: "CONFIRMED", hash: pending.hash, blockNumber: BigInt(receipt.blockNumber).toString(),
    mintedTokenId: event.args.mintedTokenId?.toString() ?? null };
}
