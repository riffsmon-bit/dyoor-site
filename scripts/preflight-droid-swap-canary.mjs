// Public, read-only, fixed-chain estimate. No keystore, dotenv, signing or broadcast.
import { readFile } from "node:fs/promises";
import { FetchRequest, JsonRpcProvider } from "ethers";
import { prepareIsolatedCanaryDeployment } from "../lib/droid-os/swaps/isolated-canary-preflight.ts";

if (process.argv.length !== 2) throw Error("No arguments or execution mode are accepted");
const allowed = new Set(["eth_chainId", "eth_call", "eth_getCode", "eth_getStorageAt", "eth_getBlockByNumber",
  "eth_getTransactionCount", "eth_getBalance", "eth_gasPrice", "eth_estimateGas"]);
class ReadOnlyProvider extends JsonRpcProvider {
  send(method, params) {
    if (!allowed.has(method)) throw Error("Non-read RPC denied");
    return super.send(method, params);
  }
}
const request = new FetchRequest("https://rpc.monad.xyz"); request.timeout = 15000;
const provider = new ReadOnlyProvider(request, 143, { batchMaxCount: 1, cacheTimeout: -1 });
try {
  const artifact = JSON.parse(await readFile(new URL(
    "../contracts/droid-os-swap-canary/out/DroidOwnerSwapCanary.sol/DroidOwnerSwapCanary.json", import.meta.url), "utf8"));
  const plan = await prepareIsolatedCanaryDeployment(provider, artifact.bytecode.object, artifact.deployedBytecode.object);
  // Keep the bulky unsigned bytecode out of operator logs. The pinned artifact and
  // read-only builder reconstruct it; this script intentionally cannot submit it.
  const { unsignedTransaction, ...summary } = plan;
  console.log(JSON.stringify({ ...summary, unsignedEnvelope: { ...unsignedTransaction, data: `[pinned creation bytecode: ${plan.creationHash}]` } }, null, 2));
} finally { provider.destroy(); }
