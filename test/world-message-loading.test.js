import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { isDyoorWorldAbortError, readDyoorWorldResponse } from "../lib/dyoor-world-client.ts";

// Exercise the actual component callback, including finally/abort sequencing,
// without connecting a wallet, loading server secrets or calling an API.
const client = fs.readFileSync("components/dyoor-world/DyoorWorldClient.tsx", "utf8");
const start = client.indexOf("const loadMessages = useCallback");
const end = client.indexOf("const scrollToLatestMessage", start);
assert.ok(start >= 0 && end > start);
const callback = ts.transpileModule(client.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function harness() {
  const state = { loading: false, messages: [], error: "" };
  const ref = { current: { sequence: 0, controller: null } };
  const requests = [];
  const timers = new Map();
  let timerId = 0;
  const context = vm.createContext({
    AbortController, DOMException, Error, channelId: "trade-desk",
    messageRequestRef: ref,
    useCallback: (fn) => fn,
    isDyoorWorldAbortError, readDyoorWorldResponse,
    setLoadingMessages: (value) => { state.loading = value; },
    setMessages: (value) => { state.messages = value; },
    setMessageLoadError: (value) => { state.error = value; },
    window: {
      setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
      clearTimeout(id) { timers.delete(id); },
    },
    fetch: (_url, { signal }) => new Promise((resolve, reject) => {
      requests.push({ resolve, reject, signal });
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
  });
  const load = vm.runInContext(`${callback}\nloadMessages`, context);
  return { load, state, ref, requests, timers };
}

test("a poll never aborts or replaces a slow initial World message load", async () => {
  const h = harness();
  const initial = h.load();
  assert.equal(h.state.loading, true);
  await h.load(true);
  await h.load(true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].signal.aborted, false);
  h.requests[0].resolve(Response.json({ messages: [{ id: "slow-success" }] }));
  await initial;
  assert.equal(h.state.loading, false);
  assert.equal(h.state.messages[0].id, "slow-success");
  assert.equal(h.timers.size, 0);
});

test("a newer foreground request invalidates the old response and owns loading state", async () => {
  const h = harness();
  const old = h.load();
  const current = h.load();
  await old;
  assert.equal(h.requests[0].signal.aborted, true);
  assert.equal(h.state.loading, true);
  assert.equal(h.state.error, "");
  h.requests[1].resolve(Response.json({ messages: [{ id: "current-channel" }] }));
  await current;
  assert.equal(h.state.messages[0].id, "current-channel");
  assert.equal(h.state.loading, false);
});

test("a timed-out World request leaves the skeleton and can be retried", async () => {
  const h = harness();
  const initial = h.load();
  const timer = [...h.timers.values()][0];
  assert.equal(timer.ms, 20_000);
  timer.fn();
  await initial;
  assert.equal(h.state.loading, false);
  assert.match(h.state.error, /taking too long/);
  assert.equal(h.ref.current.controller, null);
  const retry = h.load();
  assert.equal(h.state.error, "");
  h.requests[1].resolve(Response.json({ messages: [] }));
  await retry;
  assert.equal(h.state.loading, false);
  assert.equal(h.state.error, "");
  assert.equal(h.timers.size, 0);
});

test("HTTP failure is surfaced instead of an endless skeleton or successful empty result", async () => {
  const h = harness();
  const request = h.load();
  h.requests[0].resolve(Response.json({ error: "Messages temporarily unavailable" }, { status: 503 }));
  await request;
  assert.equal(h.state.loading, false);
  assert.equal(h.state.error, "Messages temporarily unavailable");
  assert.equal(h.ref.current.controller, null);
});

test("channel cleanup prevents an aborted callback from updating the new channel", async () => {
  const h = harness();
  const request = h.load();
  h.ref.current.controller.abort();
  h.ref.current.sequence += 1;
  h.ref.current.controller = null;
  await request;
  assert.equal(h.state.error, "");
  assert.equal(h.state.loading, true);
  assert.equal(h.timers.size, 0);
});
