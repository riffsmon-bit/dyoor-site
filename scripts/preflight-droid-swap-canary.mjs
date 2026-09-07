// Public, read-only deployed-state check. No keystore, dotenv, signing or broadcast.
import { Contract, FetchRequest, JsonRpcProvider, keccak256 } from "ethers";
import { ISOLATED_CANARY } from "../lib/droid-os/swaps/isolated-canary-preflight.ts";
import deployment from "../lib/droid-os/swaps/isolated-canary-deployment.json" with { type: "json" };

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
  if (BigInt(await provider.send("eth_chainId",[])) !== 143n) throw Error("Wrong chain");
  const deployedCode = await provider.getCode(deployment.account);
    if (deployedCode === "0x" || keccak256(deployedCode) !== ISOLATED_CANARY.runtimeHash)
      throw Error("Recorded deployment missing or changed; no replacement may be prepared");
    const deployed = new Contract(deployment.account,["function currentOwner() view returns(address)",
      "function phase() view returns(uint8)","function actionNonce() view returns(uint256)",
      "function expiresAt() view returns(uint64)"],provider);
    console.log(JSON.stringify({status:"ALREADY_DEPLOYED_NO_NEW_DEPLOYMENT_PREPARED",account:deployment.account,
      transactionHash:deployment.transactionHash,owner:await deployed.currentOwner(),
      phase:(await deployed.phase()).toString(),nonce:(await deployed.actionNonce()).toString(),
      balanceWei:(await provider.getBalance(deployment.account)).toString(),expiresAt:(await deployed.expiresAt()).toString(),
      deploymentFeeWei:deployment.deploymentFeeWei,autonomousTradingEnabled:false,broadcastEnabled:false},null,2));
} finally { provider.destroy(); }
