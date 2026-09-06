import { Interface, keccak256, toUtf8Bytes } from "ethers";
import { z } from "zod";

export const ASSIST_COLLECTION = "0x349d8eb480c92cf75371fba5c6344a4d11b9103a";
const COLLECTION_HASH = "0x2baa62e8fad053a2b59e10eb8dbfc9bbb8ef98c93a55a1114ff7776226ae15fd";
const address = z.string().regex(/^0x[\da-fA-F]{40}$/).transform(value => value.toLowerCase())
  .refine(value => value !== `0x${"0".repeat(40)}`, "Zero address");
const hash = z.string().regex(/^0x[\da-fA-F]{64}$/).transform(value => value.toLowerCase())
  .refine(value => value !== `0x${"0".repeat(64)}`, "Zero hash");
const manifestSchema = z.object({
  version: z.literal(1), chainId: z.literal(143), tokenId: z.literal("11"),
  collection: z.literal(ASSIST_COLLECTION), registry: address, account: address, badge: address,
  registryRuntimeHash: hash, accountRuntimeHash: hash, badgeRuntimeHash: hash,
}).strict().refine(value => new Set([value.registry, value.account, value.badge, value.collection]).size === 4,
  "Distinct contract addresses required");

export const ASSIST_ABI = new Interface([
  "function ownerOf(uint256) view returns(address)",
  "function CHAIN_ID() view returns(uint256)", "function TOKEN_ID() view returns(uint256)",
  "function COLLECTION() view returns(address)", "function predictAccount() view returns(address)",
  "function account() view returns(address)", "function badge() view returns(address)",
  "function currentOwner() view returns(address)", "function tokenChainId() view returns(uint256)",
  "function collection() view returns(address)", "function tokenId() view returns(uint256)",
  "function actionNonce() view returns(uint256)", "function hasMinted(address) view returns(bool)",
  "function mintCanary(uint256 expectedNonce,uint64 deadline,bytes32 evidenceHash) returns(uint256)",
]);
const readMethods = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call", "eth_estimateGas", "eth_gasPrice"]);
const quantity = value => {
  if (typeof value !== "string" || !/^0x[\da-fA-F]+$/.test(value)) throw Error("Malformed RPC quantity");
  const parsed = BigInt(value);
  if (parsed >= 2n ** 256n) throw Error("RPC quantity overflow");
  return parsed;
};
const hex = value => `0x${value.toString(16)}`;

/** Read-only builder. manifest MUST be reviewed deployment configuration, never AI/user-supplied authority.
 * There is intentionally no signer, broadcast method, provider fetch or active deployment configuration here.
 * Simulation coverage is specific to this fixed zero-value badge and its contract postconditions, not generic trading.
 */
export async function prepareAssistCanary({ manifest, owner, rpc, now = Math.floor(Date.now() / 1000) }) {
  const m = manifestSchema.parse(manifest);
  const canonicalOwner = address.parse(owner);
  if (!Number.isSafeInteger(now) || now < 0) throw Error("Invalid clock");
  async function request(method, params) {
    if (!readMethods.has(method)) throw Error("Non-read RPC denied");
    return rpc(method, params);
  }
  if (quantity(await request("eth_chainId", [])) !== 143n) throw Error("Wrong chain");
  const block = await request("eth_getBlockByNumber", ["latest", false]);
  const blockNumber = quantity(block?.number);
  const blockHash = hash.parse(block?.hash);
  const timestamp = quantity(block?.timestamp);
  if (timestamp > BigInt(now + 30) || timestamp + 30n < BigInt(now)) throw Error("Stale or future RPC block");
  const blockTag = hex(blockNumber);
  async function read(to, name, args = []) {
    const result = await request("eth_call", [{ to, data: ASSIST_ABI.encodeFunctionData(name, args) }, blockTag]);
    return ASSIST_ABI.decodeFunctionResult(name, result)[0];
  }
  for (const [target, expected] of [[m.collection, COLLECTION_HASH], [m.registry, m.registryRuntimeHash],
    [m.account, m.accountRuntimeHash], [m.badge, m.badgeRuntimeHash]]) {
    const code = await request("eth_getCode", [target, blockTag]);
    if (typeof code !== "string" || !/^0x(?:[\da-fA-F]{2})+$/.test(code) || keccak256(code) !== expected) {
      throw Error("Unknown or changed contract bytecode");
    }
  }
  const equalsAddress = (a, b) => address.parse(a) === b;
  if (await read(m.registry, "CHAIN_ID") !== 143n || await read(m.registry, "TOKEN_ID") !== 11n ||
    !equalsAddress(await read(m.registry, "COLLECTION"), m.collection) ||
    !equalsAddress(await read(m.registry, "account"), m.account) ||
    !equalsAddress(await read(m.registry, "predictAccount"), m.account) ||
    !equalsAddress(await read(m.registry, "badge"), m.badge) ||
    await read(m.account, "tokenChainId") !== 143n || await read(m.account, "tokenId") !== 11n ||
    !equalsAddress(await read(m.account, "collection"), m.collection) ||
    !equalsAddress(await read(m.account, "badge"), m.badge)) throw Error("Account identity or registry mismatch");
  if (!equalsAddress(await read(m.collection, "ownerOf", [11]), canonicalOwner) ||
    !equalsAddress(await read(m.account, "currentOwner"), canonicalOwner)) throw Error("Not canonical current owner");
  if (await read(m.badge, "hasMinted", [m.account])) throw Error("Droid already minted its test badge");
  const nonce = await read(m.account, "actionNonce");
  const deadline = timestamp + 120n;
  const evidence = { version: 1, chainId: 143, collection: m.collection, tokenId: "11", account: m.account,
    registry: m.registry, owner: canonicalOwner, badge: m.badge, nonce: nonce.toString(), deadline: deadline.toString(),
    blockNumber: blockNumber.toString(), blockHash, accountRuntimeHash: m.accountRuntimeHash,
    badgeRuntimeHash: m.badgeRuntimeHash, capability: "NFT_MINT_PREPARE", mintValueWei: "0" };
  // Commits preflight input, not the simulation result: no circular result/calldata hash.
  const evidenceHash = keccak256(toUtf8Bytes(JSON.stringify(evidence)));
  const tx = { from: canonicalOwner, to: m.account, value: "0x0",
    data: ASSIST_ABI.encodeFunctionData("mintCanary", [nonce, deadline, evidenceHash]) };
  const simulated = await request("eth_call", [tx, blockTag]);
  const mintedTokenId = ASSIST_ABI.decodeFunctionResult("mintCanary", simulated)[0];
  if (mintedTokenId < 1n) throw Error("Unexpected simulated badge ID");
  const estimate = quantity(await request("eth_estimateGas", [tx, blockTag]));
  const gasLimit = (estimate * 120n + 99n) / 100n;
  const gasPrice = quantity(await request("eth_gasPrice", []));
  if (estimate === 0n || gasLimit > 400_000n || gasPrice === 0n || gasPrice > 300_000_000_000n) {
    throw Error("Gas exceeds canary preparation cap");
  }
  // Reorg detection for this snapshot; still requires fresh preparation before user submission.
  const canonicalBlock = await request("eth_getBlockByNumber", [blockTag, false]);
  if (canonicalBlock?.hash?.toLowerCase() !== blockHash) throw Error("Simulation block no longer canonical");
  return {
    version: 1, status: "PREPARED_NOT_SUBMITTED", mode: "ASSIST", evidence, evidenceHash,
    transaction: { ...tx, chainId: "0x8f", gas: hex(gasLimit), gasPrice: hex(gasPrice) },
    transactionDataHash: keccak256(tx.data), maximumQuotedGasCostWei: (gasLimit * gasPrice).toString(),
    simulation: { success: true, coverage: "EXACT_CALL_AND_FIXED_CONTRACT_POSTCONDITIONS",
      blockNumber: blockNumber.toString(), blockHash, returnedTokenId: mintedTokenId.toString(),
      genericStateDiffAvailable: false },
    expectedOutcome: { recipient: m.account, badge: m.badge, quantity: 1, nativeSpendWei: "0", approvalsCreated: 0 },
    warnings: ["Owner approval required; no transaction submitted.", "Free mint still costs owner transaction gas.",
      "Simulation is evidence, not a guarantee. Re-prepare immediately before owner confirmation.",
      "Test collectible only. No promised value or Energy reward."],
  };
}
