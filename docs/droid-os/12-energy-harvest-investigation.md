# Energy harvest investigation — 2026-09-06

Status: preliminary diagnosis with an authorized, preview-only display fix. User reports harvesting failures; affected wallet, page, error and transaction hash are not yet supplied. A successful claim/credit for an affected user remains unverified.

## Read-only live evidence

- Monad RPC reports chain 143.
- `pendingPoints` on Ascension `0xf9611226c1CcCcCa37951938d6f358D3d5106549` returned a positive balance for the project owner's public wallet.
- Exact `claimPoints()` `eth_call` from that wallet succeeded (`0x`). No transaction was signed or submitted.
- Production `GET /api/energy/<owner>` returned HTTP 200, positive pending/spendable balances and the bank/ledger/staking data source.
- These checks do not establish that affected users can harvest, or that post-harvest bank settlement works. No write endpoint was invoked, operator key inspected, or role/configuration changed.

## Concrete code findings

1. **Unknown pending balance is represented as zero.** `src/lib/energy/chain.ts` catches a failed `pendingPoints` read as `0n`. The public Energy GET route also converts a four-second pending-read timeout into zero. If bank reads succeed, the route still returns HTTP 200 with `pendingEnergy: "0"`.
2. **That zero can override a successful browser read.** `hooks/useAscension.ts:fetchEnergy` obtains its own on-chain pending balance, then unconditionally prefers the API's nonempty pending string. String `"0"` is truthy. `app/ascension/page.tsx` disables Harvest when this displayed balance is nonpositive. This is a concrete failure path, but not yet linked to a reported user's incident.
3. **Claiming and bank credit are separate stages.** The browser submits `claimPoints`, then POSTs the receipt hash to `/api/energy/sync-wallet`. Successful harvesting does not prove bank credit. That endpoint depends on receipt RPC, durable storage, operator funding/role, and its bank transaction.
4. **Historical synchronization can be expensive.** Its default chunks span 2,500 blocks; the read helper recursively splits all RPC errors. A public provider with restrictive log ranges or outages can require many requests. The direct receipt path bypasses scanning, but the post-harvest refresh requests a historical scan. It should not be used as proof a claim failed.
5. **Wallet network handling needs targeted review.** Ascension compares the provider's string directly with `0x8f`, attempts add-chain after any switch error, and does not explicitly re-read the chain before submission. This differs from the stricter ASSIST flow. No evidence yet identifies this as the reported cause.

## Next diagnosis / repair boundaries

- Obtain the affected public wallet, exact page, wallet app and error; if a transaction exists, inspect its receipt and `PointsClaimed`, then read `usedClaimTxHash` on the bank.
- For a disabled button, distinguish real zero pending from unavailable data. Preserve successful canonical reads; represent unknown explicitly. Do not fabricate Energy or bypass transaction checks.
- For confirmed-but-uncredited claims, inspect bank deduplication and operator health before any repair. Never blindly re-credit or ask users to claim repeatedly.
- Keep pending-display fixes separate from accounting, settlement, Trait Lab debits and reroll authorization. No mainnet transaction or production deployment was performed in this investigation.

## Authorized preview fix

- Added a strict pending read for the GET display endpoint only. RPC errors/timeouts yield `pendingReadStatus: "unavailable"`, `pendingRaw: null`, `pendingEnergy: null`; a real zero is marked `ok`. Bank balances remain separately readable, and unavailable bank reads still return 503.
- Ascension preserves its successful direct RPC read, including genuine zero and all 18 fractional digits. Only when that read fails can an API value marked explicitly `ok` supply the pending display. Legacy/unmarked values do not masquerade as verified fallback balances.
- Unknown pending Energy displays `Unavailable`, with a retry explanation. Harvest is disabled while unknown or refreshing, and when the known amount is zero. Existing pre-submit pending read and wallet transaction flow remain unchanged.
- Legacy `readPendingEnergyRaw` callers, synchronization/credit endpoints, bank accounting, Trait Lab, and ASSIST execution are untouched. This fixes a demonstrated false-zero path, not every possible harvest failure.
- Added six regression test groups covering failures, timeouts, real zero, malformed values, direct-read precedence, API fallback, fractional precision, recovery, unknown state, and display wiring.

## Baseline tests

The first direct Node run passed the four Trait Lab authorization tests and wallet parser test. Four Energy Bank contract tests could not start because the worktree lacked the compiled `DYOOREnergyBank` Hardhat artifact; this is a test prerequisite failure, not evidence of a live contract defect. A subsequent `npx hardhat compile` failed with HHE902 resolving `@droid-oz/token/ERC721/ERC721.sol` from the separate Foundry V2 subtree. The chained contract-test rerun therefore did not run. Do not alter frozen deployed canary source, dependencies or compiler settings merely to make this legacy suite pass; isolate the legacy build in follow-up work.
