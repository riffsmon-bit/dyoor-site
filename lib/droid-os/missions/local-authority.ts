import { Interface, keccak256, getAddress, type JsonRpcProvider } from "ethers";

// LOCAL LAB ONLY. No public deployment is approved. Never accept this manifest
// from a chat message, browser request or discovered NFT metadata.
export type LocalControlManifest = {
  version: 1; chainId: 31337; tokenId: string;
  parent: string; parentHash: string; wrapper: string; wrapperHash: string;
  factory: string; factoryHash: string; account: string; accountHash: string;
  minter: string; minterHash: string;
};
export type LocalControlEvidence = {
  version: 1; chainId: 31337; collection: string; tokenId: string;
  wrapper: string; account: string; owner: string; epoch: string; nonce: string;
  block: number; hash: string; timestamp: number; nativeBalanceWei: string;
};
const receipt = new Interface([
  "function parent() view returns(address)", "function parentCodeHash() view returns(bytes32)",
  "function minter() view returns(address)", "function accountFactory() view returns(address)",
  "function accounts(uint256) view returns(address)", "function ownerOf(uint256) view returns(address)",
  "function ownershipEpoch(uint256) view returns(uint256)", "function isWrapped(uint256) view returns(bool)",
  "function controlOf(uint256) view returns(address,uint256,bool)",
]);
const child = new Interface([
  "function wrapper() view returns(address)", "function wrapperCodeHash() view returns(bytes32)",
  "function minter() view returns(address)", "function tokenId() view returns(uint256)",
  "function actionNonce() view returns(uint256)",
]);
const factory = new Interface(["function wrapper() view returns(address)"]);
const nft = new Interface(["function ownerOf(uint256) view returns(address)"]);
const same = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase();
function demand(ok: boolean) { if (!ok) throw Error("Local receipt authority unavailable or changed. Nothing authorized."); }

export function createLocalControlReader(rpc: JsonRpcProvider, approved: LocalControlManifest) {
  // Copy operator/test-owned manifest to prevent mutation between checks.
  const m = Object.freeze({ ...approved });
  demand(m.version === 1 && m.chainId === 31337 && /^(0|[1-9][0-9]*)$/.test(m.tokenId));
  demand(BigInt(m.tokenId) < 2n ** 256n);
  for (const key of ["parent", "wrapper", "factory", "account", "minter"] as const) {
    demand(getAddress(m[key]) !== "0x0000000000000000000000000000000000000000");
    demand(/^0x[0-9a-f]{64}$/i.test(m[`${key}Hash`]));
  }
  demand(new Set([m.parent, m.wrapper, m.factory, m.account, m.minter].map(s => s.toLowerCase())).size === 5);
  async function current(): Promise<LocalControlEvidence> {
    demand(BigInt(await rpc.send("eth_chainId", [])) === 31337n);
    const block = await rpc.getBlock("latest");
    const now = Date.now() / 1000;
    demand(!!block?.hash && block.timestamp <= now + 10 && now - block.timestamp <= 30);
    if (!block?.hash) throw Error("Missing block");
    const tag = block.number;
    const read = async (to: string, abi: Interface, method: string, args: unknown[] = []) =>
      abi.decodeFunctionResult(method, await rpc.call({ to, data: abi.encodeFunctionData(method, args), blockTag: tag }));
    await Promise.all((["parent", "wrapper", "factory", "account", "minter"] as const).map(async key => {
      const code = await rpc.getCode(m[key], tag);
      demand(code !== "0x" && same(keccak256(code), m[`${key}Hash`]));
    }));
    const [rawOwner, receiptOwner, control, epoch, wrapped, account, parent, parentHash, minter, creator,
      factoryWrapper, accountWrapper, accountWrapperHash, accountMinter, accountToken, nonce, balance] = await Promise.all([
      read(m.parent, nft, "ownerOf", [m.tokenId]), read(m.wrapper, receipt, "ownerOf", [m.tokenId]),
      read(m.wrapper, receipt, "controlOf", [m.tokenId]), read(m.wrapper, receipt, "ownershipEpoch", [m.tokenId]),
      read(m.wrapper, receipt, "isWrapped", [m.tokenId]), read(m.wrapper, receipt, "accounts", [m.tokenId]),
      read(m.wrapper, receipt, "parent"), read(m.wrapper, receipt, "parentCodeHash"), read(m.wrapper, receipt, "minter"),
      read(m.wrapper, receipt, "accountFactory"), read(m.factory, factory, "wrapper"),
      read(m.account, child, "wrapper"), read(m.account, child, "wrapperCodeHash"), read(m.account, child, "minter"),
      read(m.account, child, "tokenId"), read(m.account, child, "actionNonce"), rpc.getBalance(m.account, tag),
    ]);
    demand(same(rawOwner[0], m.wrapper) && wrapped[0] === true && control[2] === true);
    demand(same(control[0], receiptOwner[0]) && control[1] === epoch[0] && epoch[0] > 0n);
    demand(!["0x0000000000000000000000000000000000000000", m.wrapper, m.account].some(a => same(a, control[0])));
    demand(same(account[0], m.account) && same(parent[0], m.parent) && same(parentHash[0], m.parentHash));
    demand(same(minter[0], m.minter) && same(creator[0], m.factory) && same(factoryWrapper[0], m.wrapper));
    demand(same(accountWrapper[0], m.wrapper) && same(accountWrapperHash[0], m.wrapperHash));
    demand(same(accountMinter[0], m.minter) && accountToken[0] === BigInt(m.tokenId));
    // Guard a reorg during the multi-read snapshot. All calls above share one block.
    demand((await rpc.getBlock(tag))?.hash === block.hash);
    return { version: 1, chainId: 31337, collection: m.parent.toLowerCase(), tokenId: m.tokenId,
      wrapper: m.wrapper.toLowerCase(), account: m.account.toLowerCase(), owner: String(control[0]).toLowerCase(),
      epoch: String(epoch[0]), nonce: String(nonce[0]), block: tag, hash: block.hash,
      timestamp: block.timestamp, nativeBalanceWei: String(balance) };
  }
  return { current, async unchanged(previous: LocalControlEvidence) {
    const next = await current();
    demand(previous.version === 1 && previous.chainId === 31337 && next.collection === previous.collection
      && next.tokenId === previous.tokenId && next.wrapper === previous.wrapper && next.account === previous.account
      && next.owner === previous.owner && next.epoch === previous.epoch && next.nonce === previous.nonce);
    demand(Number.isSafeInteger(previous.block) && previous.block >= 0 && next.block >= previous.block
      && next.block - previous.block <= 1200 && (await rpc.getBlock(previous.block))?.hash === previous.hash);
    return next;
  } };
}
