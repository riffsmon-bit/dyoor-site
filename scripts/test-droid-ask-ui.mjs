// Isolated UI fixtures, never a wallet/provider integration test. No real signatures,
// model calls, external writes or production state. Requires headless CDP on 9224.
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
const bundle = await build({ stdin: { contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {DroidOsPreview} from './components/droid-os/DroidOsPreview';
import {emptyState} from './lib/droid-os/ask/schema';
let state=emptyState();
const client=async op=>{if(op.kind==='save')state={...state,revision:state.revision+1,training:op.training};if(op.kind==='chat')state={...state,revision:state.revision+1,messages:[...state.messages,{role:'user',text:op.message},{role:'assistant',text:'UI TEST FIXTURE — not a real AI response.'}]};return {state:structuredClone(state),aiReady:true}};
createRoot(document.getElementById('root')).render(<DroidOsPreview roster={[{id:'11',role:'UI fixture',mon:'Unavailable',energy:'Unavailable',achievements:0,color:'#39ffe2',interests:[],liveRoster:true}]} askClient={client}/>);
`, loader: "tsx", resolveDir: root }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", absWorkingDir: root, define: { "process.env.NODE_ENV": '"development"' } });
const loadConfig = require("tailwindcss/loadConfig");
const styles = await require("postcss")([require("tailwindcss")({ ...loadConfig(path.join(root, "tailwind.config.ts")), content: [path.join(root, "components/droid-os/**/*.tsx")] }), require("autoprefixer")]).process((await Promise.all(["app/globals.css", "app/droid-os/droid-os.css", "app/droid-os/ask.css"].map(f => fs.readFile(path.join(root, f), "utf8")))).join("\n"), { from: undefined });
const server = http.createServer((req, res) => {
  if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
  if (req.url === "/ui.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); }
  else if (req.url === "/ui.css") { res.setHeader("Content-Type", "text/css"); res.end(styles.css); }
  else if (req.url === "/api/droid-os/ask") { res.setHeader("Content-Type", "application/json"); res.end('{"aiReady":true}'); }
  else if (req.url === "/") { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/ui.css"></head><body><div id="root"></div><script src="/ui.js"></script></body></html>'); }
  else { res.writeHead(404); res.end('{}'); }
});
await new Promise(r => server.listen(3205, "127.0.0.1", r));
const tab = await (await fetch("http://127.0.0.1:9224/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener("open", r, { once: true }));
let serial = 0; const pending = new Map();
ws.addEventListener("message", event => { const m = JSON.parse(event.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p?.reject(m.error) : p?.resolve(m.result); } });
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const delay = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(expression) { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(100); } throw Error(`UI timeout: ${expression}`); }
async function click(label) {
  const pos = await evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&b.getBoundingClientRect().width);if(!e||e.disabled)throw Error('Button unavailable: '+${JSON.stringify(label)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...pos });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...pos });
}
try {
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable"); await send("Network.setBypassServiceWorker", { bypass: true });
  for (const width of [1440, 390, 360]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
    await send("Page.navigate", { url: "http://127.0.0.1:3205/" });
    await waitFor("!!document.querySelector('.os-ask')");
    if (width < 500) { await evaluate("document.querySelector('.os-mobile-nav button:nth-child(2)').click()"); }
    await click("Load my training"); await waitFor("document.body.textContent.includes('Saved profile · revision 0')");
    await click("Train Droid");
    await evaluate("document.querySelector('.os-training-interests input').click()");
    await click("Save training · sign message"); await waitFor("document.body.textContent.includes('Saved profile · revision 1')");
    await click("Reload saved"); await waitFor("!!document.querySelector('.os-training-interests input:checked')");
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"), true, `overflow at ${width}`);
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await fs.writeFile(`/private/tmp/droid-ask-training-${width}.png`, Buffer.from(shot.data, "base64"));
    await click("Back to talk");
    await evaluate("(()=>{const t=document.querySelector('#os-ask-input');const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;set.call(t,'Explain how to research free mints.');t.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await waitFor("!document.querySelector('[aria-label=\"Sign and send ASK message\"]').disabled");
    await evaluate("document.querySelector('[aria-label=\"Sign and send ASK message\"]').click()");
    await waitFor("document.body.textContent.includes('UI TEST FIXTURE — not a real AI response.')");
    console.log(JSON.stringify({ width, load: true, save: true, reload: true, fixtureChat: true, horizontalOverflow: false, realSignatures: 0, modelCalls: 0 }));
  }
} finally { ws.close(); await fetch(`http://127.0.0.1:9224/json/close/${tab.id}`).catch(() => {}); await new Promise(r => server.close(r)); }
