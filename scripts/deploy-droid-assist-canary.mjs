// One fixed, user-authorized canary CREATE. Default is read-only. Never reused for account execution.
import { readFile } from "node:fs/promises";
import { parse } from "dotenv";
import { Contract, JsonRpcProvider, Wallet, getCreateAddress, keccak256 } from "ethers";

const ack = "--execute-owner-approved-canary-143";
const execute = process.argv.length === 3 && process.argv[2] === ack;
let stage = "arguments";
async function main() {
  if (process.argv.length > 2 && !execute) throw Error("Invalid arguments");
  const launch = JSON.parse(await readFile(new URL("../docs/droid-os/deployments/assist-canary-143-launch.json", import.meta.url), "utf8"));
  const artifact = JSON.parse(await readFile(new URL("../contracts/droid-os-v2/out/DroidAssistCanaryRegistry.sol/DroidAssistCanaryRegistry.json", import.meta.url), "utf8"));
  if (launch.chainId !== 143 || launch.nonce !== 4596 || launch.valueWei !== "0" || launch.autonomyEnabled ||
      launch.creationBytecodeHash !== "0xf40b239a2484d850c32c72cdd70f67a7be36670c25cd8a93da1363bc34385346" ||
      keccak256(artifact.bytecode.object) !== launch.creationBytecodeHash ||
      getCreateAddress({ from: launch.deployer, nonce: launch.nonce }) !== launch.predictedRegistry) throw Error("Launch mismatch");
  const provider = new JsonRpcProvider("https://rpc.monad.xyz", 143, { batchMaxCount: 1 });
  provider.pollingInterval = 1000;
  try {
    stage = "identity";
    if (BigInt(await provider.send("eth_chainId", [])) !== 143n) throw Error("Wrong chain");
    const collection = "0x349D8eb480c92cF75371fbA5C6344A4d11b9103A";
    if (keccak256(await provider.getCode(collection)) !== "0x2baa62e8fad053a2b59e10eb8dbfc9bbb8ef98c93a55a1114ff7776226ae15fd") throw Error("Collection mismatch");
    const parent = new Contract(collection, ["function ownerOf(uint256) view returns(address)"], provider);
    if ((await parent.ownerOf(11)) !== launch.deployer) throw Error("Owner changed");
    if (await provider.getCode(launch.predictedRegistry) !== "0x") {
      console.log(JSON.stringify({ status: "ADDRESS_ALREADY_HAS_CODE_RECONCILE_DO_NOT_REDEPLOY", registry: launch.predictedRegistry }));
      return;
    }
    stage = "nonce";
    if (await provider.getTransactionCount(launch.deployer, "latest") !== launch.nonce ||
        await provider.getTransactionCount(launch.deployer, "pending") !== launch.nonce) throw Error("Nonce changed; never replace a pending transaction");
    const gasPrice = BigInt(await provider.send("eth_gasPrice", []));
    const estimate = await provider.estimateGas({ from: launch.deployer, data: artifact.bytecode.object, value: 0 });
    const gasLimit = (estimate * 120n + 99n) / 100n;
    const fee = gasLimit * gasPrice;
    if (gasLimit > 5_000_000n || fee > 600_000_000_000_000_000n || gasPrice === 0n || estimate === 0n) throw Error("Budget exceeded");
    if (await provider.getBalance(launch.deployer) < fee) throw Error("Insufficient deployment balance");
    console.log(JSON.stringify({ status: execute ? "CHECKS_PASSED_READY_TO_SIGN_FIXED_CREATE" : "DRY_RUN_NO_SIGNING",
      registry: launch.predictedRegistry, nonce: launch.nonce, gasLimit: gasLimit.toString(), maximumFeeWei: fee.toString() }));
    if (!execute) return;
    stage = "deployer";
    const envFile = process.env.DYOOR_ASSIST_DEPLOYER_ENV_FILE;
    if (!envFile) throw Error("No explicitly selected credential file");
    const keyValue = parse(await readFile(envFile, "utf8")).DEPLOYER_PRIVATE_KEY;
    if (!keyValue) throw Error("No deployer key");
    const signer = new Wallet(keyValue.startsWith("0x") ? keyValue : `0x${keyValue}`);
    if (signer.address !== launch.deployer) throw Error("Deployer mismatch");
    // Exact legacy envelope, fixed nonce, zero value. No target/calldata from arguments, UI or AI output.
    const signed = await signer.signTransaction({ type: 0, chainId: 143, nonce: launch.nonce,
      data: artifact.bytecode.object, value: 0, gasPrice, gasLimit });
    const hash = keccak256(signed);
    stage = "broadcast";
    console.log(JSON.stringify({ status: "FIXED_TRANSACTION_HASH_RECONCILE_IF_INTERRUPTED", hash, registry: launch.predictedRegistry }));
    const sent = await provider.broadcastTransaction(signed);
    stage = "receipt";
    const receipt = await sent.wait(2, 60_000);
    if (!receipt || receipt.status !== 1 || receipt.contractAddress !== launch.predictedRegistry) throw Error("Receipt mismatch");
    const registry = new Contract(launch.predictedRegistry, artifact.abi, provider);
    const badge = await registry.badge();
    console.log(JSON.stringify({ status: "DEPLOYED_REGISTRY_AND_TEST_BADGE_ONLY", hash: receipt.hash,
      blockNumber: receipt.blockNumber, registry: launch.predictedRegistry, badge,
      accountCreated: (await registry.account()) !== "0x0000000000000000000000000000000000000000",
      registryRuntimeHash: keccak256(await provider.getCode(launch.predictedRegistry)),
      badgeRuntimeHash: keccak256(await provider.getCode(badge)),
      feeWei: receipt.fee.toString(), gasUsed: receipt.gasUsed.toString(), autonomousExecution: false }));
  } finally { provider.destroy(); }
}
main().catch(() => {
  // Never stringify signer/provider exceptions: some include supplied arguments or raw transactions.
  console.error(JSON.stringify({ status: "STOPPED_RECONCILE_BEFORE_RETRY", stage, details: "No secret-bearing diagnostics logged" }));
  process.exitCode = 1;
});
