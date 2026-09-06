"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatEther } from "ethers";
import { useWalletService } from "@/providers/WalletServiceProvider";
import { describeAssistNetwork } from "@/lib/droid-os/assist-network.mjs";
import { ASSIST_DEPLOYMENT as manifest, ASSIST_SESSION_KEY, boundedAssistRpc, readAssistState,
  prepareAssistStep, validateAssistSubmission, reconcileAssistReceipt } from "@/lib/droid-os/assist-session.mjs";

type Plan = Awaited<ReturnType<typeof prepareAssistStep>>;
type LiveState = Awaited<ReturnType<typeof readAssistState>>;
type Pending = { plan: Plan; hash?: string; state: "REQUESTED" | "SUBMITTED" | "UNKNOWN" };
const message = (error: unknown) => error instanceof Error ? error.message : "Wallet request could not complete.";
const explorer = (hash: string) => `https://monadscan.com/tx/${hash}`;

export function AssistCanaryClient() {
  const wallet = useWalletService();
  const [live, setLive] = useState<LiveState | null>(null);
  const [network, setNetwork] = useState<ReturnType<typeof describeAssistNetwork> | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [recoveryHash, setRecoveryHash] = useState("");
  const refreshGeneration = useRef(0);
  const { getProvider } = wallet;
  const invalidateRefresh = useCallback(() => { ++refreshGeneration.current; }, []);

  const rpc = useCallback(async () => boundedAssistRpc(await getProvider()), [getProvider]);
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    setLive(null); setNetwork(null); setPlan(null); setAccepted(false);
    if (!wallet.address) return;
    try {
      const readRpc = await rpc();
      const observed = describeAssistNetwork(await readRpc("eth_chainId", []));
      if (generation !== refreshGeneration.current) return;
      setNetwork(observed);
      const state = await readAssistState(readRpc);
      if (generation === refreshGeneration.current) { setLive(state); setError(""); }
    }
    catch (err) { if (generation === refreshGeneration.current) setError(message(err)); }
  }, [rpc, wallet.address]);

  useEffect(() => {
    const timer = setTimeout(() => { setPlan(null); setAccepted(false); void refresh(); }, 0);
    return () => { clearTimeout(timer); invalidateRefresh(); };
  }, [refresh, invalidateRefresh]);
  useEffect(() => {
    if (!wallet.address) return;
    let disposed = false;
    let detach: (() => void) | undefined;
    const onChange = () => { void refresh(); };
    const onVisible = () => { if (document.visibilityState === "visible") onChange(); };
    window.addEventListener("focus", onChange);
    document.addEventListener("visibilitychange", onVisible);
    void getProvider().then(provider => {
      if (disposed) return;
      provider.on?.("chainChanged", onChange);
      provider.on?.("accountsChanged", onChange);
      detach = () => {
        provider.removeListener?.("chainChanged", onChange);
        provider.removeListener?.("accountsChanged", onChange);
      };
    }).catch(() => { /* The explicit refresh displays provider failures. */ });
    return () => {
      disposed = true; detach?.();
      window.removeEventListener("focus", onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [getProvider, refresh, wallet.address]);
  useEffect(() => {
    const restore = () => {
      try {
        const raw = localStorage.getItem(ASSIST_SESSION_KEY);
        const entry = raw ? JSON.parse(raw) : null;
        if (entry && (!entry.plan?.transaction || !["REQUESTED", "SUBMITTED", "UNKNOWN"].includes(entry.state))) throw Error("Invalid pending record");
        setPending(entry);
      } catch { setError("Pending browser record could not be read. Check wallet activity before starting a new test."); }
    };
    restore();
    const onStorage = (event: StorageEvent) => { if (event.key === ASSIST_SESSION_KEY) restore(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!pending?.hash || !wallet.address) return;
    let active = true;
    let running = false;
    const poll = async () => {
      if (running) return;
      running = true;
      try {
        const result = await reconcileAssistReceipt(await rpc(), pending);
        if (!active || result.status === "PENDING") return;
        const historyKey = `${ASSIST_SESSION_KEY}.history`;
        const history = JSON.parse(localStorage.getItem(historyKey) || "[]");
        localStorage.setItem(historyKey, JSON.stringify([...history.slice(-9), { ...pending, result }]));
        localStorage.removeItem(ASSIST_SESSION_KEY);
        setPending(null); setPlan(null);
        setNotice(result.status === "CONFIRMED" ? `${pending.plan.kind === "ACTIVATE" ? "Canary account activated" : "Test badge minted into your Droid"}. Confirmed on Monad.` : "Transaction reverted. No success was recorded; refresh and prepare again.");
        setError(""); void refresh();
      } catch (err) { if (active) setError(`Awaiting verified reconciliation: ${message(err)} Do not submit a duplicate.`); }
      finally { running = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 3000);
    return () => { active = false; clearInterval(timer); };
  }, [pending, rpc, wallet.address, refresh]);

  async function prepare(kind: "ACTIVATE" | "MINT") {
    setBusy(true); setError(""); setNotice(""); setPlan(null); setAccepted(false);
    try {
      if (localStorage.getItem(ASSIST_SESSION_KEY)) throw Error("Resolve the pending wallet request first.");
      const result = await prepareAssistStep(await rpc(), await wallet.getAddress(), kind);
      setPlan(result);
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!plan || !accepted || busy || pending) return;
    setBusy(true); setError("");
    let walletRequested = false;
    let saved: Pending | null = null;
    try {
      if (localStorage.getItem(ASSIST_SESSION_KEY)) throw Error("Another canary request is pending.");
      const provider = await wallet.getProvider();
      const owner = await wallet.getAddress();
      const tx = await validateAssistSubmission(boundedAssistRpc(provider), owner, plan);
      const accounts = await provider.request({ method: "eth_accounts" }) as string[];
      if (accounts[0]?.toLowerCase() !== tx.from.toLowerCase()) throw Error("Wallet changed. Prepare again.");
      saved = { plan, state: "REQUESTED" };
      // Persist BEFORE requesting approval. Storage failure means no wallet request.
      localStorage.setItem(ASSIST_SESSION_KEY, JSON.stringify(saved)); setPending(saved);
      walletRequested = true;
      const hash = await provider.request({ method: "eth_sendTransaction", params: [tx] }) as string;
      if (!/^0x[\da-fA-F]{64}$/.test(hash)) throw Error("Wallet did not return a transaction hash.");
      saved = { plan, state: "SUBMITTED", hash };
      setPending(saved); localStorage.setItem(ASSIST_SESSION_KEY, JSON.stringify(saved));
      setNotice("Transaction submitted. Waiting for its canonical receipt; do not submit again.");
    } catch (err) {
      const code = (err as { code?: string | number })?.code;
      if (walletRequested && (code === 4001 || code === "ACTION_REJECTED")) {
        localStorage.removeItem(ASSIST_SESSION_KEY); setPending(null); setError("Wallet approval cancelled. Nothing was submitted by this page.");
      } else if (walletRequested && saved) {
        const uncertain: Pending = { ...saved, state: saved.hash ? "SUBMITTED" : "UNKNOWN" };
        try { localStorage.setItem(ASSIST_SESSION_KEY, JSON.stringify(uncertain)); } catch { /* In-memory record still blocks another send. */ }
        setPending(uncertain); setError("The wallet request has an uncertain result. Check wallet activity and recover its transaction hash. Do not retry the transaction.");
      } else setError(message(err));
    } finally { setBusy(false); }
  }

  function recover() {
    if (!pending || !/^0x[\da-fA-F]{64}$/.test(recoveryHash)) return;
    const updated: Pending = { ...pending, hash: recoveryHash, state: "SUBMITTED" };
    try { localStorage.setItem(ASSIST_SESSION_KEY, JSON.stringify(updated)); setPending(updated); setError(""); }
    catch { setError("Could not save the recovery record."); }
  }

  const isOwner = Boolean(live && live.owner.toLowerCase() === wallet.address.toLowerCase());
  return <main className="droid-os assist-shell">
    <header className="assist-heading"><a href="/droid-os">← Droid Control Center</a><span>MONAD 143 · LIVE CANARY</span></header>
    <div className="assist-title"><p className="os-eyebrow">D.Y.O.O.R #11 / OWNER-APPROVED TEST</p><h1>One action.<br /><em>Your approval.</em></h1><p>A free test NFT, minted directly into your Droid’s isolated ASSIST wallet. No trading. No delegated access. No account prefunding required.</p></div>
    <aside className="assist-caution">This uses <strong>real mainnet gas</strong>. This canary is not independently audited or upgradeable to autonomy. It does not replace your existing wallet, change rerolls, or move your Season 2 NFT. Do not deposit valuable assets here.</aside>
    <section className="assist-connection" aria-label="Wallet connection"><div><h2>{wallet.address ? `${wallet.address.slice(0, 8)}…${wallet.address.slice(-6)}` : "Connect the owner wallet"}</h2><p>{live ? isOwner ? "Current owner of Droid #11 verified on-chain." : "This wallet is not the current owner of Droid #11." : "Connection and inspection do not request a signature."}</p></div>
      {!wallet.address ? <button disabled={!wallet.ready || busy} onClick={() => void wallet.connect().catch(err => setError(message(err)))}>Connect wallet</button> : <>{network?.status === "OTHER" ? <button className="assist-secondary" disabled={busy} onClick={() => void wallet.switchChain().then(refresh).catch(err => setError(message(err)))}>Switch to Monad</button> : null}<button className="assist-secondary" disabled={busy} onClick={() => void refresh()}>Refresh status</button><button className="assist-secondary" disabled={busy} onClick={() => void wallet.disconnect().catch(err => setError(message(err)))}>Disconnect</button></>}
    </section>
    {wallet.address ? <p role="status">{wallet.providerName || "Connected wallet"} · {network?.label || (error ? "Network unavailable" : "Checking connected network…")}{network?.status === "MONAD" ? " · No network switch needed." : ""}</p> : null}
    {!wallet.ready ? <p className="assist-caution" role="status">Wallet connection is still initializing. If this persists, check that this preview’s exact origin is allowed in Privy: Configuration → App settings → Domains. Do not disable domain restrictions. <a href="https://dashboard.privy.io/" target="_blank" rel="noreferrer">Open Privy dashboard ↗</a></p> : null}
    <div className="assist-steps"><section><span className="assist-step-number">01</span><h2>Activate your test wallet</h2><p>Opt in to a separate address for Droid #11. No NFT transfer, approval, deposit, or V1 migration is included.</p><span className="assist-state">{live ? live.active ? "ACTIVATED" : "OWNER OPT-IN REQUIRED" : "CONNECT TO VERIFY STATUS"}</span><button disabled={!isOwner || Boolean(live?.active) || busy || Boolean(pending)} onClick={() => void prepare("ACTIVATE")}>Review activation →</button></section>
      <section><span className="assist-step-number">02</span><h2>Mint the test badge</h2><p>Simulate one fixed, zero-price NFT mint. Your wallet then approves the exact transaction. Test collectible only; no Energy or financial reward.</p><span className="assist-state">{live?.minted ? "BADGE ALREADY MINTED" : "ONE BADGE PER ACCOUNT"}</span><button disabled={!isOwner || !live?.active || Boolean(live?.minted) || busy || Boolean(pending)} onClick={() => void prepare("MINT")}>Simulate & review mint →</button></section></div>
    {busy && !pending ? <p role="status">Checking canonical ownership, code identity, and the exact transaction…</p> : null}
    {plan && !pending ? <section className="assist-review" aria-label="Transaction review"><p className="os-eyebrow">SIMULATION PASSED / OWNER APPROVAL REQUIRED</p><h2>{plan.kind === "ACTIVATE" ? "Create the isolated test account" : "Mint one test badge into your Droid"}</h2><dl><dt>Network</dt><dd>Monad mainnet · 143</dd><dt>Transaction target</dt><dd>{plan.transaction.to}</dd><dt>MON sent</dt><dd>0 MON</dd><dt>Quoted gas ceiling</dt><dd>{formatEther(plan.maximumQuotedGasCostWei)} MON</dd><dt>Outcome</dt><dd>{plan.kind === "ACTIVATE" ? "Activate the new test wallet; move no assets" : "One test NFT held by the Droid account"}</dd></dl><p>Simulation is evidence, not a guarantee. The wallet’s final gas settings control the fee. Owner and transaction checks run again before the request.</p><label className="assist-consent"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} />I understand this is a mainnet test transaction with gas costs and no autonomous permissions.</label><div className="assist-review-actions"><button disabled={!accepted || busy} onClick={() => void confirm()}>Approve in my wallet →</button><button className="assist-secondary" disabled={busy} onClick={() => setPlan(null)}>Cancel review</button></div></section> : null}
    {pending ? <section className="assist-review" aria-label="Pending transaction"><h2>{pending.hash ? "Waiting for a verified receipt" : "Resolve the wallet request"}</h2><p>No automatic resubmission. A reload preserves this pending record.</p>{pending.hash ? <a href={explorer(pending.hash)} target="_blank" rel="noreferrer">View transaction on Monadscan ↗</a> : <><p>Check your wallet. If it submitted a transaction, paste its hash to verify the exact action. If no transaction exists, resolve the wallet request before clearing this browser’s canary record.</p><label htmlFor="assist-recovery">Transaction hash</label><input id="assist-recovery" value={recoveryHash} onChange={event => setRecoveryHash(event.target.value.trim())} placeholder="0x…" /><button className="assist-secondary" disabled={!/^0x[\da-fA-F]{64}$/.test(recoveryHash)} onClick={recover}>Recover receipt</button></>}</section> : null}
    {notice ? <p className="assist-notice" role="status">{notice}</p> : null}{error || wallet.error ? <p className="assist-error" role="alert">{error || wallet.error}</p> : null}
    <footer className="assist-addresses"><h2>Inspect the boundaries</h2><dl><dt>Canary registry</dt><dd><a href={`https://monadscan.com/address/${manifest.registry}#code`} target="_blank" rel="noreferrer">{manifest.registry}</a></dd><dt>Test wallet {live ? live.active ? "" : "(not activated)" : "(status unverified)"}</dt><dd>{manifest.account}</dd><dt>Test NFT contract</dt><dd><a href={`https://monadscan.com/address/${manifest.badge}#code`} target="_blank" rel="noreferrer">{manifest.badge}</a></dd><dt>Existing wallet</dt><dd>Unchanged. No V1 assets are used in this test.</dd></dl><p>Funds can be stranded if the parent Droid is burned or sent into an ownership cycle. This test deliberately uses no wallet prefunding. No private key is requested by this page.</p></footer>
  </main>;
}
