import { JsonRpcProvider, FetchRequest, Interface, keccak256, id, toBeHex, zeroPadValue } from "ethers";
import { AskError, COLLECTION } from "./schema.ts";
export type OwnerEvidence = { owner: string; block: number; hash: string };
export interface OwnerReader {
  current(tokenId: string): Promise<OwnerEvidence>;
  unchanged(tokenId: string, evidence: OwnerEvidence): Promise<void>;
}
const abi = new Interface(["function ownerOf(uint256) view returns (address)"]);
const RUNTIME_HASH = "0x2baa62e8fad053a2b59e10eb8dbfc9bbb8ef98c93a55a1114ff7776226ae15fd";
export function createOwnerReader(): OwnerReader {
  // Public reads only. Never inherit an operator signer or keyed trading client.
  const request = new FetchRequest("https://rpc.monad.xyz");
  request.timeout = 5000;
  const rpc = new JsonRpcProvider(request, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  async function current(tokenId: string): Promise<OwnerEvidence> {
    try {
      if (BigInt(await rpc.send("eth_chainId", [])) !== 143n) throw new Error("chain");
      const block = await rpc.getBlock("latest");
      if (!block?.hash || Date.now() / 1000 - block.timestamp > 30 || block.timestamp > Date.now() / 1000 + 10) throw new Error("block");
      const [code, owner] = await Promise.all([
        rpc.getCode(COLLECTION, block.number),
        rpc.call({ to: COLLECTION, data: abi.encodeFunctionData("ownerOf", [tokenId]), blockTag: block.number }),
      ]);
      if (keccak256(code) !== RUNTIME_HASH) throw new Error("code");
      return { owner: String(abi.decodeFunctionResult("ownerOf", owner)[0]).toLowerCase(), block: block.number, hash: block.hash };
    } catch { throw new AskError("Canonical Droid ownership is unavailable. Nothing was authorized.", 503); }
  }
  return { current, async unchanged(tokenId, evidence) {
    const now = await current(tokenId);
    if (now.owner !== evidence.owner) throw new AskError("This wallet no longer owns the selected Droid.", 403);
    if (now.block < evidence.block || now.block - evidence.block > 1200 || (await rpc.getBlock(evidence.block))?.hash !== evidence.hash) throw new AskError("Ownership proof expired or changed. Sign again.", 401);
    // Includes the issue block: a transfer in that block causes a safe retry.
    // Detects A→B→A during the short-lived challenge; no indexer/session authority.
    for (let start = evidence.block; start <= now.block; start += 100) {
      const logs = await rpc.getLogs({ address: COLLECTION, fromBlock: start, toBlock: Math.min(start + 99, now.block), topics: [id("Transfer(address,address,uint256)"), null, null, zeroPadValue(toBeHex(BigInt(tokenId)), 32)] });
      if (logs.length) throw new AskError("The Droid transferred after this proof was issued. Sign again.", 401);
    }
  } };
}
