// Isolated headless-browser QA only. All wallet requests are mocked; no RPC broadcast exists.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Interface } from "ethers";
import { ASSIST_ABI } from "../lib/droid-os/assist-canary.mjs";
import { BADGE_WITHDRAW_ABI } from "../lib/droid-os/assist-withdraw.mjs";
import { ASSIST_DEPLOYMENT as m } from "../lib/droid-os/assist-session.mjs";

const origin = "http://127.0.0.1:3204";
const tab = await (await fetch("http://127.0.0.1:9224/json/new?about:blank", { method: "PUT" })).json();
assert(tab, "An isolated headless Chrome on loopback port 9224 is required");
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
const codes = JSON.parse(await readFile(new URL("../test/fixtures/droid-assist-deployed-code.json", import.meta.url)));
const season2 = JSON.parse(await readFile(new URL("../test/fixtures/droid-assist-season2-runtime.json", import.meta.url))).code;
const owner = "0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6", hash = `0x${"a".repeat(64)}`;
const registry = new Interface(["function optIn() returns(address)",
  "event AssistMintExecuted(uint256 indexed nonce,address indexed owner,bytes32 indexed evidenceHash,address target,uint256 mintedTokenId,uint64 deadline)"]);
let connected = false, active = false, minted = false, outcome = "reject", sends = 0, submitted;
let chain = "0x8f";
let withdrawn = false, submittedHash;
let accountReads = 0;
let sequence = 0;
const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
  return result.result.value;
};
async function mock({ method, params = [] }) {
  if (method === "eth_accounts") { accountReads++; return connected ? [owner] : []; }
  if (method === "eth_requestAccounts") { connected = true; return [owner]; }
  if (method === "eth_chainId") return chain;
  if (method === "eth_sendTransaction") {
    sends++; submitted = params[0];
    assert.equal(submitted.value, "0x0");
    assert.equal(submitted.chainId, "0x8f");
    if (outcome !== "confirmed") throw Object.assign(Error("MOCK wallet response"), { code: outcome === "reject" ? 4001 : -32603 });
    submittedHash = `0x${sends.toString(16).padStart(64, "0")}`;
    return submittedHash;
  }
  if (method === "eth_getBlockByNumber") return { number: "0x64", hash, timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` };
  if (method === "eth_getCode") {
    if (params[0].toLowerCase() === m.collection.toLowerCase()) return season2;
    const key = ["registry", "account", "badge"].find(key => m[key].toLowerCase() === params[0].toLowerCase());
    return key === "account" && !active ? "0x" : codes[key];
  }
  if (method === "eth_gasPrice") return "0x17bfac7c00";
  if (method === "eth_estimateGas") return active ? "0x249f0" : "0x111700";
  if (method === "eth_blockNumber") return "0x66";
  if (method === "eth_getTransactionByHash") return { ...submitted, input: submitted.data };
  if (method === "eth_getTransactionReceipt") {
    if (submitted.data.startsWith(BADGE_WITHDRAW_ABI.getFunction("withdrawERC721").selector)) {
      withdrawn = true;
      const audit = BADGE_WITHDRAW_ABI.encodeEventLog(BADGE_WITHDRAW_ABI.getEvent("Withdrawn"), [1n, owner, m.badge, owner, 1n, 2]);
      const transfer = BADGE_WITHDRAW_ABI.encodeEventLog(BADGE_WITHDRAW_ABI.getEvent("Transfer"), [m.account, owner, 1n]);
      return { transactionHash: submittedHash, blockHash: hash, blockNumber: "0x64", status: "0x1",
        logs: [{ address: m.account, ...audit }, { address: m.badge, ...transfer }] };
    }
    const args = ASSIST_ABI.decodeFunctionData("mintCanary", submitted.data);
    const event = registry.encodeEventLog(registry.getEvent("AssistMintExecuted"), [args.expectedNonce, owner, args.evidenceHash, m.badge, 1n, args.deadline]);
    minted = true;
    return { transactionHash: submittedHash, blockHash: hash, blockNumber: "0x64", status: "0x1", logs: [{ address: m.account, ...event }] };
  }
  assert.equal(method, "eth_call", `No external wallet/RPC method permitted: ${method}`);
  if (params[0].data === registry.encodeFunctionData("optIn")) return registry.encodeFunctionResult("optIn", [m.account]);
  if (params[0].data.startsWith(BADGE_WITHDRAW_ABI.getFunction("withdrawERC721").selector)) return "0x";
  const parsed = ASSIST_ABI.parseTransaction({ data: params[0].data });
  const answers = { CHAIN_ID: 143n, TOKEN_ID: 11n, COLLECTION: m.collection, predictAccount: m.account,
    account: active ? m.account : `0x${"0".repeat(40)}`, badge: m.badge, tokenChainId: 143n, tokenId: 11n,
    collection: m.collection, ownerOf: params[0].to.toLowerCase() === m.badge.toLowerCase() ? (withdrawn ? owner : m.account) : owner,
    currentOwner: owner, hasMinted: minted, actionNonce: withdrawn ? 2n : minted ? 1n : 0n, mintCanary: 1n };
  return ASSIST_ABI.encodeFunctionResult(parsed.name, [answers[parsed.name]]);
}
ws.addEventListener("message", async event => {
  const data = JSON.parse(event.data);
  if (data.id) { const entry = pending.get(data.id); pending.delete(data.id); data.error ? entry?.reject(data.error) : entry?.resolve(data.result); return; }
  if (data.method === "Runtime.exceptionThrown") errors.push(data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text);
  if (data.method !== "Runtime.bindingCalled" || data.params.name !== "dyoorMockWallet") return;
  const request = JSON.parse(data.params.payload);
  let reply;
  try { reply = { result: await mock(request.request) }; } catch (error) { reply = { error: { message: error.message, code: error.code } }; }
  try {
    await send("Runtime.evaluate", { contextId: data.params.executionContextId,
      expression: `window.dyoorMockResolve(${request.id},${JSON.stringify(reply)})` });
  } catch (error) { if (!/Cannot find context|target navigated or closed/.test(error.message ?? "")) errors.push(String(error.message)); }
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(expression) {
  for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await delay(250); }
  throw Error(`UI timeout: ${expression}. ${await evaluate("document.body.innerText.slice(-1200)")}`);
}
const click = text => evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(text)})); if(!b||b.disabled)throw Error('Unavailable button');b.click(); })()`);
async function screenshot(name, width, height) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 700 });
  await delay(300);
  assert(await evaluate("document.documentElement.scrollWidth <= innerWidth"), "Horizontal page overflow");
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(`/private/tmp/${name}.png`, Buffer.from(shot.data, "base64"));
}
const deadline = setTimeout(() => { ws.close(); process.exitCode = 1; }, 90000);
let injection;
try {
  await send("Runtime.enable"); await send("Page.enable");
  await send("Runtime.addBinding", { name: "dyoorMockWallet" });
  injection = await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    let serial=0;const waiting=new Map();
    window.dyoorMockResolve=(id,reply)=>{const p=waiting.get(id);waiting.delete(id);if(reply.error)p.reject(Object.assign(new Error(reply.error.message),{code:reply.error.code}));else p.resolve(reply.result);};
    const listeners=new Map();window.dyoorMockEmit=(name)=>{for(const cb of listeners.get(name)||[])cb();};
    window.ethereum={isMetaMask:true,on(name,cb){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(cb);},removeListener(name,cb){listeners.get(name)?.delete(cb);},request(request){return new Promise((resolve,reject)=>{const id=++serial;waiting.set(id,{resolve,reject});window.dyoorMockWallet(JSON.stringify({id,request}));});}};
  ` });
  await send("Page.navigate", { url: `${origin}/droid-os/assist` });
  await waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent==='Connect wallet'&&!b.disabled)");
  // SSR can show an enabled button before hydration has installed its handler.
  for (let i = 0; i < 120 && accountReads === 0; i++) await delay(250);
  assert(accountReads > 0, "Wait for the wallet provider to mount before clicking");
  await screenshot("droid-assist-desktop", 1440, 1100);
  await screenshot("droid-assist-mobile", 390, 844);
  await click("Connect wallet");
  await waitFor("document.body.innerText.includes('verified on-chain')");
  await waitFor("document.body.innerText.includes('No network switch needed')");
  assert.equal(await evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent==='Switch to Monad')"), false);
  chain = "0x1";
  await evaluate("window.dyoorMockEmit('chainChanged')");
  await waitFor("document.body.innerText.includes('provider reports Chain 1')");
  assert(await evaluate("[...document.querySelectorAll('button')].some(b=>b.textContent==='Switch to Monad')"));
  chain = "0x8f";
  await evaluate("window.dispatchEvent(new Event('focus'))");
  await waitFor("document.body.innerText.includes('verified on-chain')");
  await click("Review activation");
  await waitFor("document.body.innerText.includes('SIMULATION PASSED')");
  assert.equal(sends, 0, "Preparation must never ask to send");
  await evaluate("document.querySelector('.assist-review').scrollIntoView()");
  await screenshot("droid-assist-mobile-review", 390, 844);
  await evaluate("document.querySelector('input[type=checkbox]').click()");
  await click("Approve in my wallet");
  await waitFor("document.body.innerText.includes('approval cancelled')");
  assert.equal(sends, 1);
  assert.equal(await evaluate("localStorage.getItem('dyoor.assist.canary143.pending.v1')"), null);
  outcome = "unknown";
  await click("Approve in my wallet");
  await waitFor("document.body.innerText.includes('uncertain result')");
  await send("Page.reload");
  await waitFor("document.body.innerText.includes('Resolve the wallet request')");
  assert(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Review activation')).disabled"));
  assert.equal(sends, 2);
  // This browser has only mocked requests. Clear that fixture before the separate mint scenario.
  await evaluate("localStorage.removeItem('dyoor.assist.canary143.pending.v1')");
  active = true; outcome = "confirmed";
  await send("Page.reload");
  await waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Simulate & review')&&!b.disabled)");
  await click("Simulate & review");
  await waitFor("document.body.innerText.includes('SIMULATION PASSED')");
  await evaluate("document.querySelector('input[type=checkbox]').click()");
  await click("Approve in my wallet");
  await waitFor("document.body.innerText.includes('Test badge minted into your Droid. Confirmed')");
  assert.equal(sends, 3);
  await waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Review badge withdrawal')&&!b.disabled)");
  await click("Review badge withdrawal");
  await waitFor("document.body.innerText.includes('Return test badge #1 to your owner wallet')");
  assert(await evaluate(`document.querySelector('.assist-review').textContent.includes(${JSON.stringify(owner)})`));
  await evaluate("document.querySelector('.assist-review').scrollIntoView()");
  await screenshot("droid-assist-withdraw-mobile", 390, 844);
  await evaluate("document.querySelector('input[type=checkbox]').click()");
  await click("Approve in my wallet");
  await waitFor("document.body.innerText.includes('Test badge withdrawn to your owner wallet. Confirmed')");
  await waitFor("document.body.innerText.includes('TEST BADGE AT OWNER WALLET')");
  assert(await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Review badge withdrawal')).disabled"));
  assert.equal(sends, 4);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log(JSON.stringify({ status: "PASS", realTransactions: 0, mockWalletRequests: sends,
    verified: ["mobile/desktop overflow", "conditional network switch", "chain-change and mobile-return refresh", "explicit consent", "read-only preparation", "wallet cancellation", "unknown response reload recovery", "mint receipt reconciliation", "fixed-badge withdrawal review and receipt", "repeat withdrawal disabled"] }));
} finally {
  clearTimeout(deadline);
  if (injection) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: injection.identifier });
  await send("Runtime.removeBinding", { name: "dyoorMockWallet" });
  await send("Page.navigate", { url: "about:blank" });
  ws.close();
  await fetch(`http://127.0.0.1:9224/json/close/${tab.id}`);
}
