// Fresh, disposable LOOPBACK Anvil only. No RPC override, secret file, real owner
// account, public chain fork, or external transaction endpoint is accepted.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import net from "node:net";
import { AbiCoder, Contract, ContractFactory, JsonRpcProvider, Wallet, NonceManager, keccak256, toUtf8Bytes, parseEther } from "ethers";

const wrappedFlow = process.argv[2] === "--wrapped";
if (process.argv.length !== 2 && !(wrappedFlow && process.argv.length === 3)) throw Error("Only --wrapped is allowed; no external RPC endpoints");
const socket = net.createServer();
await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const child = spawn("anvil", ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "31337", "--silent"], { stdio: "ignore", env: { PATH: process.env.PATH } });
let launchError; child.on("error", error => { launchError = error; });
const provider = new JsonRpcProvider(`http://127.0.0.1:${port}`, 31337, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 });
provider.pollingInterval = 100;
const receipts = [];
function stop() { provider.destroy(); child.kill("SIGTERM"); process.exit(130); }
process.once("SIGINT", stop); process.once("SIGTERM", stop);
const timeout = setTimeout(stop, 90000); timeout.unref();
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (launchError || child.exitCode !== null) throw Error("Isolated Anvil failed to start");
    try {
      assert.equal(await provider.send("eth_chainId", []), "0x7a69");
      assert.match(await provider.send("web3_clientVersion", []), /anvil/i);
      ready = true; break;
    } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert(ready);
  // Ephemeral local keys, never printed or stored. Signing demonstrates separate
  // owner/runner transactions but does NOT test a browser wallet popup.
  const owner = new NonceManager(Wallet.createRandom().connect(provider));
  const runner = new NonceManager(Wallet.createRandom().connect(provider));
  const buyer = new NonceManager(Wallet.createRandom().connect(provider));
  for (const signer of [owner, runner, buyer]) await provider.send("anvil_setBalance", [await signer.getAddress(), "0x56bc75e2d63100000"]);
  async function record(label, pending) {
    const receipt = await (await pending).wait(); assert.equal(receipt.status, 1);
    receipts.push({ label, from: receipt.from, transactionHash: receipt.hash, gasUsed: receipt.gasUsed.toString() });
    return receipt;
  }
  async function deploy(file, name, args = []) {
    const artifact = JSON.parse(await readFile(new URL(`../contracts/droid-os-mission-lab/out/${file}.sol/${name}.json`, import.meta.url), "utf8"));
    const contract = await new ContractFactory(artifact.abi, artifact.bytecode.object, owner).deploy(...args);
    await record(`LOCAL deploy ${name}`, contract.deploymentTransaction()); return contract;
  }
  const parent = wrappedFlow ? await deploy("DroidControlReceiptLab.t", "LegacyParentLab") : await deploy("MissionFixtures", "EpochParentLab");
  const minter = await deploy("MissionFixtures", "MissionMintLab");
  const ownerAddress = await owner.getAddress(), runnerAddress = await runner.getAddress(), buyerAddress = await buyer.getAddress();
  await record("LOCAL mint parent fixture", parent.mint(ownerAddress, 11));
  let wrapper, account;
  if (wrappedFlow) {
    wrapper = await deploy("DroidControlReceiptLab", "DroidControlReceiptLab", [await parent.getAddress(), await minter.getAddress()]);
    const intent = AbiCoder.defaultAbiCoder().encode(["bytes32"], [await wrapper.WRAP_INTENT()]);
    await record("LOCAL owner directly opts in with exact wrap intent; no operator approval", parent["safeTransferFrom(address,address,uint256,bytes)"](ownerAddress, await wrapper.getAddress(), 11, intent));
    const artifact = JSON.parse(await readFile(new URL("../contracts/droid-os-mission-lab/out/WrappedMissionAccountLab.sol/WrappedMissionAccountLab.json", import.meta.url), "utf8"));
    account = new Contract(await wrapper.accounts(11), artifact.abi, owner);
    assert.equal(await parent.ownerOf(11), await wrapper.getAddress());
    assert.equal(await wrapper.ownerOf(11), ownerAddress);
    assert.equal(await wrapper.tokenURI(11), await parent.tokenURI(11));
  } else account = await deploy("DroidMissionAccountLab", "DroidMissionAccountLab", [await parent.getAddress(), 11, await minter.getAddress()]);
  const authority = wrapper || parent;
  const accountAddress = await account.getAddress();
  await record("LOCAL owner funds Droid directly", owner.sendTransaction({ to: accountAddress, value: parseEther("50") }));
  const timestamp = Number(BigInt((await provider.send("eth_getBlockByNumber", ["latest", false])).timestamp));
  const limits = { runner: runnerAddress, validAfter: timestamp, expiresAt: timestamp + 3600, maxActions: 3, maxActionsPerDay: 3,
    protectedReserveWei: parseEther("20"), missionHash: keccak256(toUtf8Bytes("LOCAL fixed free mint mission; no money spent")) };
  const epoch = await authority.ownershipEpoch(11), launchNonce = await account.actionNonce();
  await account.launch.staticCall(limits, launchNonce, epoch);
  await record("LOCAL owner signs bounded mission launch", account.launch(limits, launchNonce, epoch));
  const robot = account.connect(runner);
  async function prepare() {
    const id = await account.missionId(), nonce = await account.actionNonce();
    const block = await provider.send("eth_getBlockByNumber", ["latest", false]);
    const deadline = Number(BigInt(block.timestamp)) + 60;
    // Commitment is an audit correlation, not a trusted simulation attestation.
    const commitment = keccak256(toUtf8Bytes(JSON.stringify({ chainId: 31337, account: accountAddress, mission: String(id), nonce: String(nonce), block: block.hash })));
    return [id, nonce, deadline, commitment];
  }
  const first = await prepare();
  assert.equal(await robot.executeFreeMint.staticCall(...first), 1n);
  await record("LOCAL runner executes simulated mint without another owner signature", robot.executeFreeMint(...first));
  assert.equal(await minter.ownerOf(1), accountAddress);
  assert.equal(await provider.getBalance(accountAddress), parseEther("50"));
  await assert.rejects(robot.executeFreeMint.staticCall(...first)); // Replay denied.
  await record("LOCAL owner cancels mission", account.cancel());
  await assert.rejects(robot.executeFreeMint.staticCall(...await prepare()));
  await record("LOCAL owner explicitly relaunches", account.launch(limits, await account.actionNonce(), epoch));
  await record(`LOCAL ${wrappedFlow ? "receipt" : "parent"} transfer A to B`, authority.transferFrom(ownerAddress, buyerAddress, 11));
  await assert.rejects(robot.executeFreeMint.staticCall(...await prepare()));
  await assert.rejects(account.withdrawNative.staticCall(ownerAddress, 1));
  await record("LOCAL new owner withdraws minted NFT", account.connect(buyer).withdrawMint(buyerAddress, 1));
  await record(`LOCAL ${wrappedFlow ? "receipt" : "parent"} transfer B to A`, authority.connect(buyer).transferFrom(buyerAddress, ownerAddress, 11));
  await assert.rejects(robot.executeFreeMint.staticCall(...await prepare()));
  assert.equal(await provider.getBalance(accountAddress), parseEther("50"));
  assert.equal(await minter.ownerOf(1), buyerAddress);
  const preservedDroidBalanceWei = String(await provider.getBalance(accountAddress));
  if (wrappedFlow) {
    await assert.rejects(wrapper.unwrap.staticCall(11)); // Funded unwrap fails closed for supported assets.
    await record("LOCAL current owner recovers all test native funds", account.withdrawNative(ownerAddress, parseEther("50")));
    await record("LOCAL current owner unwraps", wrapper.unwrap(11));
    assert.equal(await parent.ownerOf(11), ownerAddress);
    await assert.rejects(robot.executeFreeMint.staticCall(...await prepare()));
    const intent = AbiCoder.defaultAbiCoder().encode(["bytes32"], [await wrapper.WRAP_INTENT()]);
    await record("LOCAL owner rewraps without a new wallet", parent["safeTransferFrom(address,address,uint256,bytes)"](ownerAddress, await wrapper.getAddress(), 11, intent));
    assert.equal(await wrapper.accounts(11), accountAddress);
    await assert.rejects(robot.executeFreeMint.staticCall(...await prepare()));
    await record("LOCAL owner restores original NFT custody", wrapper.unwrap(11));
    assert.equal(await parent.ownerOf(11), ownerAddress);
  }
  console.log(JSON.stringify({ status: "PASS", chainId: 31337, environment: "DISPOSABLE_LOCAL_FIXTURES", realMonSpent: "0",
    publicDeployments: 0, aiCalls: 0, localTransactionCount: receipts.length, ownerLaunchTransactions: 2, runnerMintTransactions: 1,
    wrappedFlow, preservedDroidBalanceWei, finalAccountBalanceWei: String(await provider.getBalance(accountAddress)),
    verifies: ["owner launch simulation and signed transaction", "separate runner transaction", "fixed-account mint simulation", "NFT custody", "reserve", "replay denial", "cancellation", "transfer and round-trip revocation", "current owner withdrawal"], receipts }, null, 2));
} finally {
  clearTimeout(timeout); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
  provider.destroy(); if (child.exitCode === null) child.kill("SIGTERM");
}
