import { Interface, keccak256, toUtf8Bytes } from "ethers";
import m from "./assist-deployment.json" with { type: "json" };

// This is the verified first canary badge, not an arbitrary NFT selector.
export const ASSIST_TEST_BADGE_ID = "1";
export const BADGE_WITHDRAW_ABI = new Interface([
  "function ownerOf(uint256) view returns(address)",
  "function withdrawERC721(address asset,address recipient,uint256 id)",
  "event Withdrawn(uint256 indexed nonce,address indexed owner,address indexed asset,address recipient,uint256 amountOrTokenId,uint8 assetKind)",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
]);
const equal = (a, b) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
const gasCap = 250_000n;

function eligibility(state, owner) {
  if (!state.active || !state.minted || !equal(state.owner, owner) || !equal(state.testBadgeOwner, m.account)) {
    throw Error("Only the current Droid #11 owner can withdraw test badge #1 while the Droid account holds it.");
  }
}

/** Called only after session code verifies canonical identity, runtime hashes and current owner. */
export async function prepareTestBadgeWithdrawal(rpc, state, owner) {
  eligibility(state, owner);
  const timestamp = BigInt(state.block.timestamp);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (timestamp < now - 30n || timestamp > now + 30n) throw Error("Fresh block required for withdrawal preparation.");
  const tx = { from: owner, to: m.account, value: "0x0",
    data: BADGE_WITHDRAW_ABI.encodeFunctionData("withdrawERC721", [m.badge, owner, ASSIST_TEST_BADGE_ID]) };
  const result = await rpc("eth_call", [tx, state.block.number]);
  if (result !== "0x") throw Error("Unexpected withdrawal simulation result.");
  const estimate = BigInt(await rpc("eth_estimateGas", [tx, state.block.number]));
  const gas = (estimate * 120n + 99n) / 100n;
  const gasPrice = BigInt(await rpc("eth_gasPrice", []));
  if (estimate <= 0n || gas > gasCap || gasPrice <= 0n || gasPrice > 300_000_000_000n) throw Error("Withdrawal gas exceeds the test cap.");
  const canonical = await rpc("eth_getBlockByNumber", [state.block.number, false]);
  if (!equal(canonical?.hash, state.block.hash)) throw Error("Withdrawal simulation block is no longer canonical.");
  const evidence = { version: 1, chainId: 143, kind: "WITHDRAW_TEST_BADGE", account: m.account,
    owner, asset: m.badge, recipient: owner, tokenId: ASSIST_TEST_BADGE_ID, nonce: state.nonce,
    blockHash: state.block.hash, blockNumber: BigInt(state.block.number).toString() };
  return { kind: "WITHDRAW_BADGE", version: 1, status: "PREPARED_NOT_SUBMITTED", mode: "ASSIST",
    transaction: { ...tx, chainId: "0x8f", gas: `0x${gas.toString(16)}`, gasPrice: `0x${gasPrice.toString(16)}` },
    maximumQuotedGasCostWei: (gas * gasPrice).toString(), transactionDataHash: keccak256(tx.data),
    expiresAt: (timestamp + 120n).toString(), evidence,
    evidenceHash: keccak256(toUtf8Bytes(JSON.stringify(evidence))),
    withdrawal: { asset: m.badge, tokenId: ASSIST_TEST_BADGE_ID, recipient: owner },
    simulation: { success: true, coverage: "EXACT_OWNER_WITHDRAWAL_CALL_AND_FIXED_CONTRACT_POSTCONDITION",
      genericStateDiffAvailable: false, blockHash: state.block.hash, blockNumber: evidence.blockNumber },
  };
}

export function validateTestBadgeWithdrawal(state, owner, plan) {
  eligibility(state, owner);
  const tx = plan.transaction;
  // Re-encode the entire allowed call; no arbitrary recipient, asset, token ID or suffix.
  const expected = BADGE_WITHDRAW_ABI.encodeFunctionData("withdrawERC721", [m.badge, owner, ASSIST_TEST_BADGE_ID]);
  if (!equal(tx.to, m.account) || tx.data !== expected || BigInt(tx.gas) > gasCap ||
      BigInt(plan.expiresAt) <= BigInt(state.block.timestamp) || plan.evidence?.nonce !== state.nonce ||
      !equal(plan.withdrawal?.asset, m.badge) || !equal(plan.withdrawal?.recipient, owner) ||
      plan.withdrawal?.tokenId !== ASSIST_TEST_BADGE_ID) throw Error("Re-prepare the fixed badge withdrawal; its contents or account state changed.");
}

/** Match both the account audit event and the badge Transfer event, not a generic success receipt. */
export function verifyTestBadgeWithdrawalReceipt(receipt, plan) {
  const expected = BADGE_WITHDRAW_ABI.encodeFunctionData("withdrawERC721", [m.badge, plan.transaction.from, ASSIST_TEST_BADGE_ID]);
  if (!equal(plan.transaction.to, m.account) || plan.transaction.data !== expected) throw Error("Unexpected withdrawal envelope.");
  const parsed = receipt.logs.map(log => {
    try { return { address: log.address, event: BADGE_WITHDRAW_ABI.parseLog(log) }; } catch { return null; }
  });
  const event = parsed.find(log => equal(log?.address, m.account) && log?.event?.name === "Withdrawn")?.event;
  if (!event || !equal(event.args.owner, plan.transaction.from) || !equal(event.args.asset, m.badge) ||
      !equal(event.args.recipient, plan.transaction.from) || event.args.amountOrTokenId !== 1n ||
      event.args.assetKind !== 2n || event.args.nonce.toString() !== plan.evidence?.nonce) throw Error("Withdrawal audit event mismatch.");
  const transfer = parsed.find(log => equal(log?.address, m.badge) && log?.event?.name === "Transfer" &&
    equal(log.event.args.from, m.account) && equal(log.event.args.to, plan.transaction.from) && log.event.args.tokenId === 1n);
  if (!transfer) throw Error("Expected test badge transfer is missing.");
}
