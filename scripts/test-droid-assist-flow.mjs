// Disposable LOOPBACK Anvil fork. Uses impersonation only inside this VM; no owner key or public writes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import net from "node:net";
import { Contract, ContractFactory, Interface, JsonRpcProvider, JsonRpcSigner, keccak256 } from "ethers";
import { prepareAssistCanary, ASSIST_COLLECTION } from "../lib/droid-os/assist-canary.mjs";

const useDeployedCanary = process.argv[2] === "--rehearse-deployed-canary";
if (process.argv.length > 2 && (!useDeployedCanary || process.argv.length !== 3)) throw Error("Unsupported local rehearsal argument");
const deployment = useDeployedCanary ? JSON.parse(await readFile(new URL(
  "../docs/droid-os/deployments/assist-canary-143-receipt.json", import.meta.url), "utf8")) : null;

const listener = net.createServer();
await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const child = spawn("anvil", ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "143", "--silent",
  "--fork-url", "https://rpc.monad.xyz", "--fork-block-number", String(deployment?.blockNumber ?? 102511645)], { stdio: "ignore", env: { PATH: process.env.PATH } });
let launchError;
child.on("error", error => { launchError = error; });
const provider = new JsonRpcProvider(`http://127.0.0.1:${port}`, 143, { staticNetwork: true, batchMaxCount: 1 });
provider.pollingInterval = 100;
const receipts = [];
function terminate() { provider.destroy(); child.kill("SIGTERM"); process.exit(130); }
process.once("SIGTERM", terminate); process.once("SIGINT", terminate);
const deadline = setTimeout(terminate, 90_000); deadline.unref();
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (launchError || child.exitCode !== null) throw Error("Local Anvil failed to start");
    try {
      assert.equal(await provider.send("eth_chainId", []), "0x8f");
      assert.match(await provider.send("web3_clientVersion", []), /anvil/i);
      ready = true; break;
    } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert(ready, "No isolated fork");
  const parent = new Contract(ASSIST_COLLECTION, ["function ownerOf(uint256) view returns(address)"], provider);
  const owner = await parent.ownerOf(11);
  await provider.send("anvil_impersonateAccount", [owner]);
  await provider.send("anvil_setBalance", [owner, "0x8ac7230489e80000"]); // 10 local test MON only.
  const signer = new JsonRpcSigner(provider, owner);
  const readArtifact = async name => JSON.parse(await readFile(new URL(
    `../contracts/droid-os-v2/out/${name}.sol/${name}.json`, import.meta.url), "utf8"));
  async function record(label, pending) {
    const receipt = await (await pending).wait();
    assert.equal(receipt.status, 1);
    receipts.push({ label, hash: receipt.hash, gasUsed: receipt.gasUsed.toString() });
    return receipt;
  }
  const artifact = await readArtifact("DroidAssistCanaryRegistry");
  const registry = deployment ? new Contract(deployment.registry, artifact.abi, signer)
    : await new ContractFactory(artifact.abi, artifact.bytecode.object, signer).deploy();
  if (deployment) assert.equal(keccak256(await provider.getCode(deployment.registry)), deployment.registryRuntimeHash);
  else await record("LOCAL deploy registry and test badge", registry.deploymentTransaction());
  await record("LOCAL current owner opts in", registry.optIn());
  const accountAddress = await registry.account();
  const badgeAddress = await registry.badge();
  const registryAddress = await registry.getAddress();
  const manifest = { version: 1, chainId: 143, tokenId: "11", collection: ASSIST_COLLECTION,
    registry: registryAddress, account: accountAddress, badge: badgeAddress,
    registryRuntimeHash: keccak256(await provider.send("eth_getCode", [registryAddress, "latest"])),
    accountRuntimeHash: keccak256(await provider.send("eth_getCode", [accountAddress, "latest"])),
    badgeRuntimeHash: keccak256(await provider.send("eth_getCode", [badgeAddress, "latest"])) };
  const block = await provider.send("eth_getBlockByNumber", ["latest", false]);
  const plan = await prepareAssistCanary({ manifest, owner,
    now: Number(BigInt(block.timestamp)), rpc: (method, params) => provider.send(method, params) });
  assert.equal(plan.transaction.to.toLowerCase(), accountAddress.toLowerCase());
  assert.equal(plan.transaction.value, "0x0");
  const accountArtifact = await readArtifact("DroidAssistAccountCandidate");
  const account = new Contract(accountAddress, accountArtifact.abi, signer);
  // Recheck at submission in the local driver; there is no off-chain execution grant.
  assert.equal((await account.currentOwner()).toLowerCase(), owner.toLowerCase());
  assert.equal((await account.actionNonce()).toString(), plan.evidence.nonce);
  const { gas, ...transaction } = plan.transaction;
  const receipt = await record("LOCAL owner submits exact simulated mint", signer.sendTransaction({ ...transaction, gasLimit: gas }));
  const event = receipt.logs.map(log => { try { return new Interface(accountArtifact.abi).parseLog(log); } catch { return null; } })
    .find(log => log?.name === "AssistMintExecuted");
  assert(event);
  assert.equal(event.args.evidenceHash, plan.evidenceHash);
  const badgeArtifact = await readArtifact("DroidAssistBadge");
  const badge = new Contract(badgeAddress, badgeArtifact.abi, provider);
  assert.equal(await badge.ownerOf(event.args.mintedTokenId), accountAddress);
  assert.equal(BigInt(await provider.send("eth_getBalance", [accountAddress, "latest"])), 0n);
  await record("LOCAL owner withdraws test badge", account.withdrawERC721(badgeAddress, owner, event.args.mintedTokenId));
  assert.equal(await badge.ownerOf(event.args.mintedTokenId), owner);
  console.log(JSON.stringify({ version: 1, status: "PASS", environment: "EPHEMERAL_LOCAL_MAINNET_FORK",
    publicDeployment: false, realMonSpent: "0", completedAt: new Date().toISOString(),
    manifestForDeployedCanary: deployment ? manifest : null,
    runtimeFixtures: deployment ? {
      registry: await provider.getCode(registryAddress), account: await provider.getCode(accountAddress),
      badge: await provider.getCode(badgeAddress), sourceForkBlock: deployment.blockNumber,
    } : null,
    verified: ["real S2 owner", "opt-in", "runtime and binding validation", "exact-account mint simulation",
      "owner-only submission", "receipt evidence commitment", "NFT held by Droid", "owner NFT withdrawal"], receipts }, null, 2));
} finally {
  clearTimeout(deadline); process.removeListener("SIGTERM", terminate); process.removeListener("SIGINT", terminate);
  provider.destroy(); if (child.exitCode === null) child.kill("SIGTERM");
}
