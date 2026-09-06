// Real deployed-code rehearsal on a disposable loopback fork. NEVER reads a key or broadcasts publicly.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import { JsonRpcProvider, JsonRpcSigner } from "ethers";
import { boundedAssistRpc, readAssistState, prepareAssistStep, validateAssistSubmission, reconcileAssistReceipt } from "../lib/droid-os/assist-session.mjs";
import m from "../lib/droid-os/assist-deployment.json" with { type: "json" };

if (process.argv.length !== 2) throw Error("No execution/target arguments accepted");
const listener = net.createServer();
await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const child = spawn("anvil", ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "143", "--silent",
  "--fork-url", "https://rpc.monad.xyz", "--fork-block-number", "102541084"], { stdio: "ignore", env: { PATH: process.env.PATH } });
let launchError;
child.on("error", error => { launchError = error; });
const provider = new JsonRpcProvider(`http://127.0.0.1:${port}`, 143, { staticNetwork: true, batchMaxCount: 1 });
provider.pollingInterval = 100;
const stop = () => { provider.destroy(); child.kill("SIGTERM"); process.exit(130); };
const deadline = setTimeout(stop, 90000); deadline.unref();
process.once("SIGINT", stop); process.once("SIGTERM", stop);
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (launchError || child.exitCode !== null) throw Error("Local fork unavailable");
    try { assert.match(await provider.send("web3_clientVersion", []), /anvil/i); assert.equal(await provider.send("eth_chainId", []), "0x8f"); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert(ready);
  const rpc = boundedAssistRpc({ request: ({ method, params }) => provider.send(method, params) });
  const initial = await readAssistState(rpc);
  assert.equal(initial.testBadgeOwner.toLowerCase(), m.account.toLowerCase());
  // Advance this isolated VM clock so UI freshness checks use the same wall clock as the test process.
  await provider.send("evm_setNextBlockTimestamp", [Math.floor(Date.now() / 1000)]);
  await provider.send("evm_mine", []);
  const owner = initial.owner;
  await provider.send("anvil_impersonateAccount", [owner]);
  await provider.send("anvil_setBalance", [owner, "0xde0b6b3a7640000"]); // 1 MON inside the disposable VM only.
  const plan = await prepareAssistStep(rpc, owner, "WITHDRAW_BADGE");
  const tx = await validateAssistSubmission(rpc, owner, plan);
  const other = "0x0000000000000000000000000000000000000Bad";
  await assert.rejects(validateAssistSubmission(rpc, other, plan));
  await assert.rejects(rpc("eth_call", [{ ...tx, from: other }, "latest"]));
  const signer = new JsonRpcSigner(provider, owner);
  const { gas, ...envelope } = tx;
  const receipt = await (await signer.sendTransaction({ ...envelope, gasLimit: gas })).wait();
  assert.equal(receipt.status, 1);
  await provider.send("anvil_mine", ["0x2"]);
  const verified = await reconcileAssistReceipt(rpc, { plan, hash: receipt.hash });
  assert.equal(verified.status, "CONFIRMED");
  const after = await readAssistState(rpc);
  assert.equal(after.testBadgeOwner.toLowerCase(), owner.toLowerCase());
  assert.equal(BigInt(after.nonce), BigInt(initial.nonce) + 1n);
  await assert.rejects(prepareAssistStep(rpc, owner, "WITHDRAW_BADGE"));
  await assert.rejects(rpc("eth_call", [tx, "latest"]));
  console.log(JSON.stringify({ status: "PASS", environment: "EPHEMERAL_LOOPBACK_MONAD_FORK", forkBlock: 102541084,
    publicTransactions: 0, realMonSpent: "0", verified: ["deployed runtime identities", "canonical owner", "badge #1 custody",
      "exact withdrawal simulation", "non-owner rejection by contract", "owner-approved transaction", "audit and Transfer events",
      "badge at owner", "nonce advancement", "repeat withdrawal rejected"], localTransactionHash: receipt.hash }));
} finally {
  clearTimeout(deadline); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
  provider.destroy(); if (child.exitCode === null) child.kill("SIGTERM");
}
