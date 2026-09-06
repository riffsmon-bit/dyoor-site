// Fresh loopback Anvil only. No dotenv, stored keys, remote RPC or public deployment.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import net from "node:net";
import { ContractFactory, JsonRpcProvider, parseEther } from "ethers";

const listener = net.createServer();
await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const child = spawn("anvil", ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "31337", "--silent"], {
  stdio: "ignore", env: { PATH: process.env.PATH },
});
let launchError;
child.on("error", error => { launchError = error; });
const provider = new JsonRpcProvider(`http://127.0.0.1:${port}`, 31337, { staticNetwork: true, batchMaxCount: 1 });
provider.pollingInterval = 100;
const receipts = [];
function terminate() { provider.destroy(); child.kill("SIGTERM"); process.exit(130); }
process.once("SIGTERM", terminate);
process.once("SIGINT", terminate);
const deadline = setTimeout(terminate, 55000);
deadline.unref();
try {
  let started = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (launchError || child.exitCode !== null) throw new Error("Isolated Anvil failed to start");
    try {
      assert.equal(await provider.send("eth_chainId", []), "0x7a69");
      assert.match(await provider.send("web3_clientVersion", []), /anvil/i);
      started = true; break;
    } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(started, "No local test chain");
  const [owner, executor, reviewer, nextOwner] = await Promise.all([0, 1, 2, 3].map(index => provider.getSigner(index)));
  const ownerAddress = await owner.getAddress();
  async function receipt(label, transaction) {
    const result = await (await transaction).wait();
    assert.equal(result.status, 1);
    receipts.push({ label, hash: result.hash, gasUsed: result.gasUsed.toString() });
  }
  async function deploy(name, args) {
    const artifact = JSON.parse(await readFile(new URL(`../contracts/droid-os-lab/out/${name}.sol/${name}.json`, import.meta.url), "utf8"));
    const contract = await new ContractFactory(artifact.abi, artifact.bytecode.object, owner).deploy(...args);
    await receipt(`deploy ${name}`, contract.deploymentTransaction());
    return contract;
  }
  const parent = await deploy("LabCollection", [ownerAddress]);
  const mint = await deploy("LabMint", [parseEther("0.01")]);
  const account = await deploy("DroidMintAccountLab", [await parent.getAddress(), 11, await mint.getAddress(), await executor.getAddress(), await reviewer.getAddress()]);
  const accountAddress = await account.getAddress();
  async function denied(operation, expectedError) {
    try { await operation(); assert.fail(`Expected ${expectedError}`); }
    catch (error) {
      assert.equal(error.code, "CALL_EXCEPTION", "A network failure is not evidence of policy rejection");
      assert.equal(account.interface.parseError(error.data)?.name, expectedError);
    }
  }
  await receipt("owner directly funds test Droid", owner.sendTransaction({ to: accountAddress, value: parseEther("0.05") }));
  const now = (await provider.getBlock("latest")).timestamp;
  await receipt("owner grants bounded mint", account.setMintGrant(parseEther("0.03"), parseEther("0.01"), parseEther("0.02"), 2, now, now + 3600));
  const action = await account.nextActionHash();
  // Fixture inspection followed by an exact-account eth_call below; not production simulation certification.
  await mint.mint.staticCall(accountAddress, { value: parseEther("0.01") });
  await receipt("reviewer attests exact action", account.connect(reviewer).attestSimulation(action, now + 60));
  await account.connect(executor).executeMint.staticCall(0);
  await receipt("executor mints within grant", account.connect(executor).executeMint(0));
  assert.equal(await mint.ownerOf(1), accountAddress);
  assert.equal(BigInt(await provider.send("eth_getBalance", [accountAddress, "latest"])), parseEther("0.04"));
  await denied(() => account.connect(executor).executeMint.staticCall(0), "Denied");
  await receipt("owner revokes mint permission", account.revokeMintGrant());
  await denied(() => account.connect(executor).executeMint.staticCall(1), "GrantInactive");
  await receipt("owner explicitly reauthorizes mint", account.setMintGrant(parseEther("0.03"), parseEther("0.01"), parseEther("0.02"), 2, now, now + 3600));
  await receipt("Droid transfers to owner B", parent.transfer(11, await nextOwner.getAddress()));
  await denied(() => account.withdrawNative.staticCall(ownerAddress, 1), "Denied");
  await denied(() => account.withdrawMintedNft.staticCall(ownerAddress, 1), "Denied");
  await denied(() => account.connect(executor).executeMint.staticCall(1), "StaleAuthority");
  assert.equal(await mint.ownerOf(1), accountAddress);
  await receipt("new owner withdraws test NFT", account.connect(nextOwner).withdrawMintedNft(await nextOwner.getAddress(), 1));
  await receipt("new owner withdraws test native funds", account.connect(nextOwner).withdrawNative(await nextOwner.getAddress(), parseEther("0.005")));
  await receipt("Droid returns to owner A", parent.connect(nextOwner).transfer(11, ownerAddress));
  await denied(() => account.connect(executor).executeMint.staticCall(1), "StaleAuthority");
  assert.equal(await mint.ownerOf(1), await nextOwner.getAddress());
  assert.equal(await account.actionNonce(), 1n);
  console.log(JSON.stringify({
    version: 1, status: "PASS", completedAt: new Date().toISOString(), chainId: 31337, environment: "EPHEMERAL_LOCAL_ANVIL", publicDeployment: false,
    walletKeysUsed: "Anvil unlocked test accounts only; no stored owner key",
    account: accountAddress,
    verified: ["direct funding", "bounded mint grant", "account-context eth_call", "executor mint", "reserve retained", "replay denied", "revocation enforced", "former-owner native/NFT withdrawal denied", "new owner native/NFT withdrawal", "A-B-A grant invalidation", "assets remain until owner withdrawal; nonce persists"],
    receipts,
  }, null, 2));
} finally {
  clearTimeout(deadline);
  process.removeListener("SIGTERM", terminate);
  process.removeListener("SIGINT", terminate);
  provider.destroy();
  if (child.exitCode === null) child.kill("SIGTERM");
}
