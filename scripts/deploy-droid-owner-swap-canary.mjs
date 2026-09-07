// Fixed CREATE only. Never signs funding, swaps, approvals, delegation or withdrawals.
// User authorization: 1 MON total experiment ceiling; deployment sub-limit 0.3 MON.
import { readFile } from "node:fs/promises";
import { parse } from "dotenv";
import { Contract, FetchRequest, JsonRpcProvider, Wallet, Transaction, getCreateAddress, keccak256 } from "ethers";
import { ISOLATED_CANARY, prepareIsolatedCanaryDeployment } from "../lib/droid-os/swaps/isolated-canary-preflight.ts";

export const LAUNCH = Object.freeze({
  owner: "0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6", nonce: 4602,
  address: "0xac33a73b923ac2b711b5f2fbe175e2b63036f101", chainId: 143,
  totalBudgetWei: 1_000_000_000_000_000_000n, deploymentBudgetWei: 300_000_000_000_000_000n,
});
export function validateFixedDeployment(tx) {
  const keys = ["type", "chainId", "nonce", "data", "value", "gasPrice", "gasLimit"];
  if (!tx || Object.keys(tx).length !== keys.length || Object.keys(tx).some(key => !keys.includes(key))
    || tx.type !== 0 || tx.chainId !== 143 || tx.nonce !== LAUNCH.nonce || tx.value !== 0n
    || keccak256(tx.data) !== ISOLATED_CANARY.creationHash || tx.gasLimit <= 0n || tx.gasLimit > 3_000_000n
    || tx.gasPrice <= 0n || tx.gasPrice > 300_000_000_000n
    || tx.gasLimit * tx.gasPrice > LAUNCH.deploymentBudgetWei)
    throw Error("Fixed deployment or sub-budget mismatch");
  return tx;
}
let stage = "arguments";
async function main() {
  const execute = process.argv.length === 3 && process.argv[2] === "--execute-fixed-owner-approved-deployment";
  if (process.argv.length !== 2 && !execute) throw Error("Invalid arguments");
  const request = new FetchRequest("https://rpc.monad.xyz"); request.timeout = 15000;
  const provider = new JsonRpcProvider(request, 143, { batchMaxCount: 1, cacheTimeout: -1 });
  provider.pollingInterval = 1000;
  try {
    const artifact = JSON.parse(await readFile(new URL(
      "../contracts/droid-os-swap-canary/out/DroidOwnerSwapCanary.sol/DroidOwnerSwapCanary.json", import.meta.url), "utf8"));
    stage = "existing-deployment";
    if (BigInt(await provider.send("eth_chainId", [])) !== 143n) throw Error("Wrong chain");
    if (getCreateAddress({from: LAUNCH.owner, nonce: LAUNCH.nonce}).toLowerCase() !== LAUNCH.address)
      throw Error("Wrong creation address");
    if (await provider.getCode(LAUNCH.address) !== "0x") {
      console.log(JSON.stringify({status:"ADDRESS_OCCUPIED_RECONCILE_DO_NOT_REDEPLOY", address:LAUNCH.address}));
      return;
    }
    stage = "fresh-preflight";
    const plan = await prepareIsolatedCanaryDeployment(provider, artifact.bytecode.object, artifact.deployedBytecode.object);
    if (plan.owner !== LAUNCH.owner || BigInt(plan.unsignedTransaction.nonce) !== BigInt(LAUNCH.nonce)
      || !plan.ownerBalanceSufficientAtSnapshot) throw Error("Owner/nonce/balance changed");
    const tx = validateFixedDeployment({type:0,chainId:143,nonce:LAUNCH.nonce,data:artifact.bytecode.object,
      value:0n,gasPrice:BigInt(plan.gasPriceWei),gasLimit:BigInt(plan.gasLimit)});
    console.log(JSON.stringify({status:execute ? "FIXED_DEPLOYMENT_CHECKED" : "DRY_RUN_NO_SIGNING",
      address:LAUNCH.address, maximumDeploymentFeeWei:(tx.gasPrice*tx.gasLimit).toString(),
      totalExperimentBudgetWei:LAUNCH.totalBudgetWei.toString(), testCapitalWei:ISOLATED_CANARY.maxFundingWei,
      unresolvedVenueRisks:plan.unresolvedVenueRisks, funding:false, swaps:false, autonomousTrading:false}));
    if (!execute) return;
    stage = "selected-deployer";
    const file = process.env.DYOOR_SWAP_DEPLOYER_ENV_FILE;
    if (!file) throw Error("Explicit credential file required");
    const value = parse(await readFile(file, "utf8")).DEPLOYER_PRIVATE_KEY;
    if (!value) throw Error("Missing credential");
    const signer = new Wallet(value.startsWith("0x") ? value : `0x${value}`);
    if (signer.address.toLowerCase() !== LAUNCH.owner) throw Error("Deployer mismatch");
    const signed = await signer.signTransaction(tx);
    const decoded = Transaction.from(signed);
    if (decoded.from.toLowerCase() !== LAUNCH.owner || decoded.to !== null || decoded.chainId !== 143n
      || decoded.nonce !== LAUNCH.nonce || decoded.value !== 0n || decoded.data !== tx.data
      || decoded.gasLimit !== tx.gasLimit || decoded.gasPrice !== tx.gasPrice || decoded.type !== 0)
      throw Error("Signed envelope mismatch");
    stage = "final-owner-nonce-simulation";
    const latest = await prepareIsolatedCanaryDeployment(provider, artifact.bytecode.object, artifact.deployedBytecode.object);
    if (latest.owner !== LAUNCH.owner || BigInt(latest.unsignedTransaction.nonce) !== BigInt(LAUNCH.nonce)
      || latest.ownerCodeHash !== plan.ownerCodeHash || BigInt(latest.gasLimit) > tx.gasLimit
      || BigInt(latest.gasPriceWei) > tx.gasPrice || !latest.ownerBalanceSufficientAtSnapshot)
      throw Error("Signing snapshot changed; no submission");
    const hash = keccak256(signed);
    // Public identifier emitted before submission. Fixed nonce prevents another
    // deployment on retry. Never log the signed transaction or signer exceptions.
    console.log(JSON.stringify({status:"RECONCILE_THIS_HASH_BEFORE_ANY_RETRY",hash,address:LAUNCH.address,nonce:LAUNCH.nonce}));
    stage = "broadcast-fixed-create";
    const sent = await provider.broadcastTransaction(signed);
    stage = "receipt";
    const receipt = await sent.wait(2, 45000);
    if (!receipt || receipt.status !== 1 || receipt.contractAddress?.toLowerCase() !== LAUNCH.address
      || receipt.fee > LAUNCH.deploymentBudgetWei
      || keccak256(await provider.getCode(LAUNCH.address,receipt.blockNumber)) !== ISOLATED_CANARY.runtimeHash)
      throw Error("Receipt/runtime mismatch");
    const account = new Contract(LAUNCH.address,artifact.abi,provider);
    if ((await account.currentOwner()).toLowerCase() !== LAUNCH.owner || await account.TOKEN_ID() !== 11n
      || (await account.COLLECTION()).toLowerCase() !== ISOLATED_CANARY.collection
      || await account.phase() !== 0n || await account.actionNonce() !== 0n
      || await provider.getBalance(LAUNCH.address) !== 0n) throw Error("Deployed bindings/state mismatch");
    console.log(JSON.stringify({status:"DEPLOYED_UNFUNDED_OWNER_ONLY_CANARY",hash,account:LAUNCH.address,
      blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,gasUsed:receipt.gasUsed.toString(),
      feeWei:receipt.fee.toString(),remainingExperimentBudgetWei:(LAUNCH.totalBudgetWei-receipt.fee).toString(),
      runtimeHash:ISOLATED_CANARY.runtimeHash,expiresAt:(await account.expiresAt()).toString(),
      funded:false,traded:false,autonomousTrading:false}));
  } finally { provider.destroy(); }
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch(() => {
    console.error(JSON.stringify({status:"STOPPED_RECONCILE_BEFORE_RETRY",stage,details:"No secret-bearing diagnostics logged"}));
    process.exitCode = 1;
  });
}
