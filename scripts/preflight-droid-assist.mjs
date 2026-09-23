// Public read-only deployment estimate. No keys, dotenv, signing or broadcast RPC.
import { readFile } from "node:fs/promises";
import { Interface, keccak256, formatEther } from "ethers";

const rpcUrl = "https://rpc.monad.xyz";
const collection = "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A";
const collectionHash = "0x2baa62e8fad053a2b59e10eb8dbfc9bbb8ef98c93a55a1114ff7776226ae15fd";
const allowed = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call", "eth_estimateGas", "eth_gasPrice"]);
async function rpc(method, params) {
  if (!allowed.has(method)) throw Error("Non-read RPC denied");
  const response = await fetch(rpcUrl, {
    method: "POST", redirect: "error", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw Error(`Public RPC HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > 200_000) throw Error("RPC response too large");
  const result = JSON.parse(body);
  if (result.error || result.result === undefined) throw Error(`RPC ${method} failed: ${result.error?.message ?? "missing result"}`);
  return result.result;
}

if (BigInt(await rpc("eth_chainId", [])) !== 143n) throw Error("Wrong chain");
const block = await rpc("eth_getBlockByNumber", ["latest", false]);
if (keccak256(await rpc("eth_getCode", [collection, block.number])) !== collectionHash) throw Error("Collection changed");
const abi = new Interface(["function ownerOf(uint256) view returns(address)"]);
const [owner] = abi.decodeFunctionResult("ownerOf", await rpc("eth_call", [
  { to: collection, data: abi.encodeFunctionData("ownerOf", [11]) }, block.number,
]));
const artifact = JSON.parse(await readFile(new URL(
  "../contracts/droid-os-v2/out/DroidAssistCanaryRegistry.sol/DroidAssistCanaryRegistry.json", import.meta.url,
), "utf8"));
const code = artifact.bytecode.object;
if (!/^0x(?:[\da-fA-F]{2})+$/.test(code) || code.length > 2 + 49152 * 2) throw Error("Invalid creation artifact");
const estimatedGas = BigInt(await rpc("eth_estimateGas", [{ from: owner, value: "0x0", data: code }, block.number]));
const gasLimit = (estimatedGas * 120n + 99n) / 100n;
const gasPrice = BigInt(await rpc("eth_gasPrice", []));
if (estimatedGas === 0n || gasLimit > 10_000_000n || gasPrice === 0n) throw Error("Invalid deployment estimate");
console.log(JSON.stringify({
  version: 1, status: "ESTIMATED_NOT_DEPLOYED", observedAt: new Date().toISOString(), chainId: 143,
  blockNumber: BigInt(block.number).toString(), blockHash: block.hash, rpcUrl,
  contract: "DroidAssistCanaryRegistry", from: owner, collection, tokenId: "11",
  creationBytecodeHash: keccak256(code), creationBytes: (code.length - 2) / 2,
  estimatedGas: estimatedGas.toString(), gasLimitWith20PercentBuffer: gasLimit.toString(),
  observedGasPriceWei: gasPrice.toString(), estimatedBufferedDeploymentFeeWei: (gasLimit * gasPrice).toString(),
  estimatedBufferedDeploymentFeeMon: formatEther(gasLimit * gasPrice),
  includes: ["Canary registry", "Fixed test badge deployed by registry constructor"],
  excludes: ["Owner opt-in/account activation", "Owner mint transaction", "Optional badge withdrawal"],
  publicDeployment: false, productionReady: false,
  blockers: ["Review and freeze final canary artifacts", "Verified deployment manifest", "Preview approval and receipt-reconciliation UI"],
}, null, 2));
