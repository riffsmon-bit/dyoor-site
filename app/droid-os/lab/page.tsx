import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "../droid-os.css";
import "./lab.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Droid OS · Contract Test Bench", robots: { index: false, follow: false } };

export default function DroidContractLabPage() {
  if (process.env.DROID_OS_UI_PREVIEW !== "true") notFound();
  return <main className="droid-os os-contract-bench">
    <a href="/droid-os">← Back to your Droids</a>
    <p className="os-eyebrow">DROID OS / CONTRACT TEST BENCH</p>
    <h1>Permissions you can test.<br />Boundaries you can inspect.</h1>
    <p className="os-bench-intro">A local-only mint and custody experiment. This page does not connect your wallet or execute transactions.</p>
    <div className="os-bench-warning">Not deployed on Monad. Not your Season 2 collection. Not an upgrade to your existing Droid account.</div>
    <section><h2>Run the real local scenario</h2><p>The console creates a fresh disposable Anvil chain, deploys the test contracts, funds an account, grants and executes a bounded mint, then tests revocation, ownership transfer and owner-only withdrawals.</p><code>npm run lab:droid-contracts</code><a className="os-bench-action" href="http://localhost:3203" target="_blank" rel="noreferrer">Open local contract console ↗</a><p className="os-bench-note">The command must be running on this computer. The link will not work on a phone or another computer. No real MON or wallet is needed.</p></section>
    <section><h2>What the suite covers</h2><ul><li>Current-owner permission grants and explicit revocation.</li><li>Protected native reserve, per-action and daily caps.</li><li>Action-specific review, expiry, nonce and account binding.</li><li>Mint recipient checks and owner-only native/NFT withdrawals.</li><li>Reentrancy, unknown bytecode, stale-owner and A→B→A rejection.</li><li>Mainnet and public-testnet constructor rejection.</li></ul><a href="https://github.com/riffsmon-bit/dyoor-site/pull/29/checks" target="_blank" rel="noreferrer">View current GitHub test results ↗</a></section>
    <section><h2>A separate owner-approved mainnet test</h2><p>This original lab remains local-only. A separate, opt-in ASSIST canary now supports Droid #11 on Monad: activate an isolated test wallet, then approve a fixed free test-badge mint. Each transaction costs real gas. Existing wallets and assets remain untouched. No autonomous permissions, DEX trading, NFT sniping or Energy rewards are enabled.</p><a className="os-bench-action" href="/droid-os/assist">Review the ASSIST mainnet canary →</a><p className="os-bench-note">Delegated transfer-lifecycle revocation remains unresolved. Reviewer attestations are software assertions, not proof of production simulation. Passing tests is not an independent audit or a safety guarantee.</p></section>
  </main>;
}
