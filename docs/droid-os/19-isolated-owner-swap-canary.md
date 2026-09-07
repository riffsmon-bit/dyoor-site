# Isolated owner-approved swap canary

Status: **built and tested, not deployed, not wired to preview controls**. No mainnet
transaction, owner key access, funding, delegation change or autonomous activation
was performed for this work. The user requested faster live testing; this does not
turn the unresolved venue findings into a completed security review.

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
and recovery transaction gas are additional. A numeric total owner budget has
been requested and is still pending. Do not use the historical quote or nonce as
a ready-to-broadcast transaction.

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
- Five JS preflight tests cover RPC quantities, owner-code classification, gas
  bounds, unknown artifacts and absence of broadcast/secret-loading interfaces.
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
npm run preflight:droid-swap-canary
```

Passing tests is not an audit or a production-safety claim. Next: explicit total
budget, reviewed owner-signing deployment flow, verified deployed runtime and
bindings, then preview-only simulated/reviewed actions and tiny owner-approved
funding. Do not enable chat approvals, agents or broad autonomous trading as a
side effect of deploying this experiment.
