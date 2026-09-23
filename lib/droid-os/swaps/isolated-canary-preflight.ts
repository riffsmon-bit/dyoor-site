import { Interface, keccak256, formatEther, type JsonRpcProvider } from "ethers";
import { inspectKuruVenue } from "./kuru-route.ts";

// Source-controlled, immutable artifact identities. Rebuilding different Solidity
// never silently blesses new deployment bytecode. There is no signing/broadcast API.
export const ISOLATED_CANARY = Object.freeze({
  collection: "0x349d8eb480c92cf75371fba5c6344a4d11b9103a", tokenId: "11", chainId: 143,
  collectionHash: "0x2baa62e8fad053a2b59e10eb8dbfc9bbb8ef98c93a55a1114ff7776226ae15fd",
  creationHash: "0x8e8ec8f1666069eccffd381d7e92bcb98393be737a034f2becc985a5f3170291",
  runtimeHash: "0xe5308ebb7ebed94e968c33333844f68d550e0a322b48b48807310546df2b3ec2",
  maxNativeTradeWei: "1000000000000000", reserveWei: "100000000000000", maxFundingWei: "1100000000000000",
  maxUSDCUnits: "1000", maxBuys: 1, maxSells: 1, lifetimeSeconds: 86400,
});
const parent = new Interface(["function ownerOf(uint256) view returns(address)"]);
const hex = (n: bigint) => `0x${n.toString(16)}`;
export function classifyCanaryOwnerCode(code: string) {
  if (code === "0x") return { kind: "EOA", delegate: null };
  // EIP-7702 transaction-origination exception. Recognition is not an audit of
  // delegated wallet logic, nor permission to alter the owner's delegation.
  if (/^0xef0100[0-9a-f]{40}$/i.test(code))
    return { kind: "EIP7702_EOA", delegate: `0x${code.slice(8).toLowerCase()}` };
  throw Error("Contract owner requires a separate deployment flow");
}
export function canaryRpcUint(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) throw Error("Malformed RPC quantity");
  const n = BigInt(value);
  if (n >= 2n ** 256n) throw Error("RPC quantity overflow");
  return n;
}
export function validateIsolatedCanaryArtifact(creation: string, runtime: string): void {
  if (!/^0x(?:[a-f0-9]{2})+$/i.test(creation) || !/^0x(?:[a-f0-9]{2})+$/i.test(runtime)
    || (creation.length - 2) / 2 > 49152 || (runtime.length - 2) / 2 > 24576
    || keccak256(creation) !== ISOLATED_CANARY.creationHash || keccak256(runtime) !== ISOLATED_CANARY.runtimeHash)
    throw Error("Unreviewed canary artifact; no deployment prepared");
}
export function boundedCanaryGas(estimate: bigint, price: bigint) {
  const limit = (estimate * 120n + 99n) / 100n;
  if (estimate <= 0n || limit > 3_000_000n || price <= 0n || price > 300_000_000_000n)
    throw Error("Canary gas estimate outside preflight bounds");
  return { limit, price, feeWei: limit * price };
}

/** Only a non-broadcast deployment estimate. Known venue risk is preserved, not
 * reclassified as safe by the user's wish to test. A budget/owner approval is absent. */
export async function prepareIsolatedCanaryDeployment(rpc: JsonRpcProvider, creation: string, runtime: string) {
  validateIsolatedCanaryArtifact(creation, runtime);
  const venue = await inspectKuruVenue(rpc);
  const tag = venue.block;
  const code = await rpc.getCode(ISOLATED_CANARY.collection, tag);
  if (code === "0x" || keccak256(code) !== ISOLATED_CANARY.collectionHash) throw Error("Collection identity changed");
  const [rawOwner] = parent.decodeFunctionResult("ownerOf", await rpc.call({
    to: ISOLATED_CANARY.collection, data: parent.encodeFunctionData("ownerOf", [11]), blockTag: tag,
  }));
  const owner = String(rawOwner).toLowerCase();
  if (owner === "0x" + "0".repeat(40)) throw Error("Unknown current owner");
  const ownerCode = await rpc.getCode(owner, tag);
  const ownerAccount = classifyCanaryOwnerCode(ownerCode);
  const blockTag = hex(BigInt(tag));
  const [nonceRaw, pendingRaw, balance, gasPriceRaw] = await Promise.all([
    rpc.send("eth_getTransactionCount", [owner, blockTag]), rpc.send("eth_getTransactionCount", [owner, "pending"]),
    rpc.getBalance(owner, tag), rpc.send("eth_gasPrice", []),
  ]);
  const nonce = canaryRpcUint(nonceRaw);
  if (nonce !== canaryRpcUint(pendingRaw)) throw Error("Owner has pending transactions; refresh after confirmation");
  const tx = { from: owner, data: creation, value: "0x0" };
  const simulatedCode = await rpc.call({ ...tx, blockTag: tag });
  if (keccak256(simulatedCode) !== ISOLATED_CANARY.runtimeHash) throw Error("Unexpected simulated deployment runtime");
  const gas = boundedCanaryGas(canaryRpcUint(await rpc.send("eth_estimateGas", [tx, blockTag])), canaryRpcUint(gasPriceRaw));
  if ((await rpc.getBlock(tag))?.hash !== venue.blockHash || Date.now() / 1000 - venue.timestamp > 30)
    throw Error("Deployment snapshot expired or reorganized");
  return {
    version: 1, status: "AWAITING_OWNER_BUDGET_AND_SIGNATURE", chainId: 143, tokenId: "11",
    deployed: false, deploymentAuthorized: false, broadcastEnabled: false, autonomousTradingEnabled: false,
    owner, ownerAccount, ownerCodeHash: keccak256(ownerCode), ownerDelegationReviewed: false,
    block: tag, blockHash: venue.blockHash, creationHash: ISOLATED_CANARY.creationHash,
    runtimeHash: ISOLATED_CANARY.runtimeHash, gasLimit: gas.limit.toString(), gasPriceWei: gas.price.toString(),
    quotedDeploymentFeeWei: gas.feeWei.toString(), quotedDeploymentFeeMON: formatEther(gas.feeWei),
    proposedTestCapitalMON: "0.0011", capitalIncludedInDeployment: false,
    ownerBalanceSufficientAtSnapshot: balance >= gas.feeWei + BigInt(ISOLATED_CANARY.maxFundingWei),
    unsignedTransaction: { ...tx, chainId: "0x8f", nonce: hex(nonce), gas: hex(gas.limit), gasPrice: hex(gas.price) },
    venueExecutionAllowed: venue.executionAllowed, unresolvedVenueRisks: venue.blockers,
    warnings: ["NOT deployed. This estimate is not spending authorization.",
      "Deployment quote excludes funding, buy, sell and recovery transaction gas.",
      "Unverified Kuru implementations and execution-time upgrade risk remain.",
      "Separate disposable test address, not the canonical Droid wallet or an upgrade to ASSIST.",
      "No S2 NFT wrapping, no V1 assets, no autonomous or AI signing authority.",
      "Current owner must explicitly approve each transaction. Never deposit valuable assets."],
  };
}
