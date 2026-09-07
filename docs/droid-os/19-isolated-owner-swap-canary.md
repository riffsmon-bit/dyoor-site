# Isolated owner-approved swap canary

Status: **deployed, unfunded, not wired to preview swap controls**. After approving
a 1 MON total deployment/testing budget, the owner authorized this isolated
experiment. One fixed, zero-value CREATE transaction was signed using the existing
deployment credential. No funding, swap, delegation change, NFT movement or
autonomous activation was performed. The request for faster testing does not turn
the unresolved venue findings into a completed security review.

## Deployment receipt

- Account: `0xac33a73b923ac2b711b5f2fbe175e2b63036f101`.
- [Transaction](https://monadscan.com/tx/0xcd990bc62ddcb00da3c90dbf37b443750f3ecaa0a1906a6dc49f23fc13eacf88),
  block **102641082**, canonical hash
  `0x1f0a7263a2b59c2368053cd0d2198fd0444cf193751e9f3f8d528b0bdc55688d`.
- Actual deployment fee **0.206602836 MON**; gas used 2,025,518 at 102 gwei.
- Remaining approved experiment budget: **0.793397164 MON**. No test capital has
  been transferred. Funding/trade/recovery fees must come out of this remainder.
- Trading expiration timestamp: **1788836424**. Recovery is not subject to that expiry.
- Trading expires **September 7 at 11:00:24 PM America/Detroit** (September 8,
  03:00:24 UTC). This is a fixed experiment, not a permanent trading wallet.
- Sourcify verification job `4acecc6d-91e7-48ba-895d-455223767ca9` returned
  **exact_match**. Source matching is not an independent security audit.
- Runtime, owner, collection/token bindings, zero phase/nonce and zero native
  balance were checked after two-confirmation receipt acceptance.
- Public manifest: `lib/droid-os/swaps/isolated-canary-deployment.json`.

`scripts/deploy-droid-owner-swap-canary.mjs` defaults to read-only inspection and
has a fixed owner, nonce 4602, creation address, artifact hash and **0.3 MON**
deployment sub-limit. It signs only a type-0, zero-value creation with no target,
authorization list or user/AI-supplied calldata. It rechecks the preflight after
signing and before submission, emits the public transaction hash before sending,
and refuses another deployment if the nonce changed or the address has code.
Exceptions are redacted; no raw transaction or key is logged. **Do not rerun to
create a replacement.** The source's predeployment notice is retained to preserve
the byte-for-byte deployed artifact, not to contradict this receipt.

## Purpose and boundaries

`contracts/droid-os-swap-canary` is a separate disposable experiment for Monad 143,
Season 2 `0x349D8eb480c92cF75371fbA5C6344A4d11b9103A`, token 11. It is **not** the
canonical Droid Wallet, not an upgrade to the deployed badge-only ASSIST account,
and not a replacement for the opt-in control-receipt architecture. No Season 2 NFT
wrapping, approvals, migration, V1 balance movement or production configuration
change is included. The canonical integration remains in the local lab described
in [the venue/security review](18-venue-security-canonical-wallet.md).

The candidate fixes one Kuru MON/USDC market, router and USDC address in Solidity.
There is no arbitrary target/calldata entry point, NFT receiver, runner, delegated
grant, AI key, upgrade mechanism or general ERC20 approval/transfer API.

| Constraint | Enforcement |
| --- | --- |
| Authority | Current on-chain S2 `ownerOf(11)`, checked before and after external interactions |
| Owner funding | At most 0.0011 MON normal funded balance, only before the first trade |
| Buy | One MON→USDC buy, at most 0.001 MON, at most 1,000 raw USDC units received |
| Sell | One USDC→MON sell, only the amount acquired by that buy |
| Reserve | At least 0.0001 MON after each swap; owner recovery can withdraw it |
| Expiration | Trading stops 24 hours after deployment |
| Replay | One shared increasing action nonce, 120-second maximum action deadline |
| Recovery | Separate MON and fixed-USDC recovery to the current owner; closes trading permanently |

Router refunds and forced native transfers can increase the balance independently
of normal funding. They cannot increase the fixed trade cap. Gas is paid by the
owner transaction sender, separately from the test wallet's protected reserve.
Partial fills consume the one-shot buy/sell allowance; leftover supported assets
can be recovered. This is not a memecoin or NFT sniping implementation.

## Execution and remaining risks

Owner approves every operation. Buy/sell require a nonzero minimum output and
simulation-evidence hash, enforce observed balance deltas, forbid a pre-existing
router allowance, create only an exact temporary USDC allowance and clear it in
the same transaction. The evidence hash is audit correlation, **not proof that a
simulation occurred**. A future preview action builder still needs fresh
account-specific simulation, a durable evidence record, explicit review and a
wallet signature. No such production execution path is enabled by this package.

Kuru proxy runtime hashes do **not** attest to the implementation executing at
transaction time. Exact deployed Kuru implementation source remains unverified;
the upgrade race and transitive venue review findings in document 18 remain open.
A fork test explicitly demonstrates that changing the router implementation does
not make the proxy code hash change. Caps limit this experiment's exposure; they
do not certify the venue or guarantee execution results.

The USDC proxy's exposed implementation getter and that implementation's code
hash are checked before and after trades. USDC issuer pause/blacklist powers remain.
Separate native recovery does not depend on the router or USDC being operational;
USDC recovery itself may still fail under issuer restrictions. Recovery has no
trading-expiration restriction. Burns, ownership cycles involving uncallable
contracts, or loss of owner access can strand assets. Unsupported tokens/NFTs are
not recoverable through this deliberately narrow interface. Do not deposit them.

The receipt is not used here, so no transfer epoch is claimed. There are no grants
to revive after A→B→A: only a new transaction by the current canonical owner can
act. Persistent caps, nonce, history and balances remain attached to this test
account. It must not be advertised as the final V2 canonical wallet.

## Artifacts and read-only preflight

Solidity 0.8.24, optimizer 200, Cancun, no via-IR:

- Creation: 7,919 bytes; hash `0x8e8ec8f1666069eccffd381d7e92bcb98393be737a034f2becc985a5f3170291`.
- Runtime: 6,937 bytes; hash `0xe5308ebb7ebed94e968c33333844f68d550e0a322b48b48807310546df2b3ec2`.
- No constructor arguments or runtime immutable substitutions.
- `lib/droid-os/swaps/isolated-canary-preflight.ts` rejects changed artifacts before RPC access.
- `npm run preflight:droid-swap-canary` permits only explicit read RPC methods,
  accepts no execution arguments, loads no keys or environment secrets, and cannot
  broadcast. It checks the existing 47-observation venue snapshot, S2 bytecode,
  current owner, transaction nonce, simulated creation runtime, bounded gas and
  block freshness/reorganization. It returns an **unsigned** envelope and retains
  `deploymentAuthorized`, `broadcastEnabled`, `venueExecutionAllowed` and
  `autonomousTradingEnabled` as false.

Direct transaction origination recognizes empty-code EOAs and the exact 23-byte
[EIP-7702 designator](https://eips.ethereum.org/EIPS/eip-7702#transaction-origination).
The observed owner uses `0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b`.
Recognition is not a review of that delegate's logic. Its code hash and delegation
address are reported, no delegation is changed, and other contract-owner deployment
paths are rejected rather than estimated as ordinary EOA transactions.

The latest read-only quote at block 102638850 (hash
`0xd25a8315eadbf6807dfe62cc5f9c09d258535a2a06c860880875d7bf5df2e416`)
estimated a 2,025,518 gas limit
(including 20% headroom) at 102 gwei: **0.206602836 MON**. This is an expiring
deployment estimate, not a spending authorization. Proposed test capital is
**0.0011 MON**, transferred only after deployment verification. Funding, buy, sell
and recovery transaction gas are additional. The numeric total owner budget was
pending at the time of that estimate. Do not use the historical quote or nonce as
a ready-to-broadcast transaction. This historical pending-budget status is now
superseded by the explicit 1 MON approval and deployment receipt above; the
read-only estimator deliberately remains incapable of authorizing execution.

## Verification

- 17 contract unit/fuzz tests pass: caps/reserve, canonical-owner transfer, round-trip
  ownership, expiry/recovery, shared nonce, reentrancy, ownership callback changes,
  wrong recipients, false returns, ignored minimum, partial fills, excess debit,
  allowance reset rollback, paused USDC and invalid selectors/chain.
- Four public-mainnet fork tests pass at block 102612438, entirely in local state.
  The real route returns 27 raw USDC for 0.001 MON, then 998114600000000 wei on
  the sell. These are historical test observations, not current quotes.
- Fork tests preserve original S2 ownership and the V1 account MON balance; test
  non-owner rejection, changed USDC implementation, and the unresolved Kuru race.
- Two post-deployment fork tests at block **102641082** start from the actual
  deployed account (not a replacement deployment). A local VM funds it, obtains
  buy/sell quotes using snapshots, performs the fixed round trip with exact
  minimums, clears allowances and recovers both supported assets. Original S2
  ownership and V1 funds stay unchanged. The second test verifies non-owner denial.
  These operations occurred only in fork state; mainnet remains unfunded/untraded.
- Five JS preflight tests cover RPC quantities, owner-code classification, gas
  bounds, unknown artifacts and absence of broadcast/secret-loading interfaces.
- Two additional deployment-envelope tests enforce the fixed creation identity,
  zero value, nonce, gas sub-budget and prohibition of arbitrary calls/delegation.
- Existing route/dependency, mission-review, ASK/provider, ASSIST, website/Energy/
  World regression suites pass. The workflow includes the new unit/preflight suite.
- The 94 existing mission/canonical contract tests, 34 V2 contract tests and 13
  World-security/Trait Lab tests also pass. TypeScript, ESLint and the production
  webpack build pass; the build retains the existing optional Privy dependency
  warnings for `@stripe/crypto` and `@farcaster/mini-app-solana`.

Commands:

```sh
npm run test:droid-swap-canary
npm run test:droid-swap-canary:fork
npm run test:droid-swap-canary:deployed-fork
npm run preflight:droid-swap-canary
```

Passing tests is not an audit or a production-safety claim. Next: preview-only
simulated/reviewed actions, pending-request recovery, budget accounting and tiny
owner-approved funding. Do not enable chat approvals, agents or broad autonomous
trading as a side effect of deploying this experiment.
