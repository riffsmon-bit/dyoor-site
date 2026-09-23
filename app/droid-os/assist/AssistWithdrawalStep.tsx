import { ASSIST_DEPLOYMENT } from "@/lib/droid-os/assist-session.mjs";

export function AssistWithdrawalStep({ badgeOwner, owner, minted, allowed, busy, pending, onPrepare }: {
  badgeOwner: string | null | undefined; owner: string | undefined; minted: boolean;
  allowed: boolean; busy: boolean; pending: boolean; onPrepare: () => void;
}) {
  const held = badgeOwner?.toLowerCase() === ASSIST_DEPLOYMENT.account.toLowerCase();
  const atOwner = Boolean(badgeOwner && owner && badgeOwner.toLowerCase() === owner.toLowerCase());
  return <section className="assist-withdraw-step">
    <span className="assist-step-number">03 / OWNER CUSTODY TEST</span>
    <h2>Return the test badge</h2>
    <p>Withdraw only test badge #1 from the Droid account to the current owner wallet. Your Season 2 Droid stays where it is. No token approvals, other NFTs, or MON transfers are included.</p>
    <span className="assist-state">{held ? "TEST BADGE HELD BY DROID" : atOwner ? "TEST BADGE AT OWNER WALLET" : minted ? "TEST BADGE NOT IN DROID ACCOUNT" : "MINT THE TEST BADGE FIRST"}</span>
    <button disabled={!allowed || !held || busy || pending} onClick={onPrepare}>Review badge withdrawal →</button>
    {pending ? <p>Resolve the pending wallet request below before starting another action.</p> : null}
  </section>;
}
