import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getCreateAddress } from "ethers";
import { LAUNCH, validateFixedDeployment } from "../scripts/deploy-droid-owner-swap-canary.mjs";

const artifact=JSON.parse(readFileSync(new URL("../contracts/droid-os-swap-canary/out/DroidOwnerSwapCanary.sol/DroidOwnerSwapCanary.json",import.meta.url)));
const tx=()=>({type:0,chainId:143,nonce:4602,data:artifact.bytecode.object,value:0n,gasPrice:102000000000n,gasLimit:2025518n});
test("only one fixed zero-value deployment fits the approved sub-budget",()=>{
  assert.deepEqual(validateFixedDeployment(tx()),tx());
  assert.equal(getCreateAddress({from:LAUNCH.owner,nonce:LAUNCH.nonce}).toLowerCase(),LAUNCH.address);
  assert(LAUNCH.deploymentBudgetWei+1100000000000000n<LAUNCH.totalBudgetWei);
});
test("no attached funds, calls, nonce replacement, authorization or higher gas bill can be signed",()=>{
  for(const patch of [{to:LAUNCH.owner},{value:1n},{nonce:4603},{nonce:4601},{data:"0x6000"},{chainId:1},
    {type:4},{authorizationList:[]},{gasLimit:3000001n},{gasLimit:0n},{gasPrice:0n},
    {gasPrice:300000000001n},{gasPrice:200000000000n}])
    assert.throws(()=>validateFixedDeployment({...tx(),...patch}));
});
test("post-deployment preflight reports the fixed account rather than estimating another CREATE",()=>{
  const script=readFileSync(new URL("../scripts/preflight-droid-swap-canary.mjs",import.meta.url),"utf8");
  assert.match(script,/ALREADY_DEPLOYED_NO_NEW_DEPLOYMENT_PREPARED/);
  assert.match(script,/Recorded deployment missing or changed/);
  assert.doesNotMatch(script,/prepareIsolatedCanaryDeployment|signTransaction|broadcastTransaction/);
  const manifest=JSON.parse(readFileSync(new URL("../lib/droid-os/swaps/isolated-canary-deployment.json",import.meta.url)));
  assert.equal(manifest.account,LAUNCH.address);
  assert.equal(manifest.deployerNonce,LAUNCH.nonce);
  assert.equal(BigInt(manifest.deploymentFeeWei)+BigInt(manifest.remainingBudgetAfterDeploymentWei),LAUNCH.totalBudgetWei);
  assert.equal(manifest.autonomousTradingEnabled,false);
});
