# D.Y.O.O.R Production Security and Trait Lab Audit

Date: 2026-07-22

Scope: Monad mainnet (chain ID `143`), Season 2 contract
`0x349d8eb480c92cf75371fba5c6344a4d11b9103a`, production metadata served from
`https://dyoor.netlify.app/api/metadata/`.

## Architecture

- Next.js App Router routes run as Netlify serverless functions.
- Wallet access is provided by Privy with an injected EIP-1193 fallback.
- Trait Lab previews verify current NFT ownership, select compatible traits,
  render the proposed image, and spend Energy before returning the preview.
- Confirm requests verify a second wallet signature, persist a metadata
  override, update the trait-supply ledger, and enqueue OpenSea refreshes.
- Runtime metadata, Trait Lab operations, supply accounting, burned-droid
  records, and refresh work are stored in the `dyoor-s2-metadata` Blob store.
- Spendable, lifetime, and spent Energy are authoritative on the Energy Bank
  contract. The JSON Energy ledger remains diagnostic and indexing support.

## Trust Boundaries

- Client input and wallet signatures are untrusted until verified server-side.
- Mainnet RPC responses and receipts must be checked against chain ID `143` and
  the configured production contract addresses.
- Blob writes are durable but do not provide multi-document transactions or
  compare-and-swap in the current storage wrapper.
- Public metadata reads must be side-effect free.
- On-chain Energy spends and credits are irreversible and must have stable,
  deterministic idempotency identifiers.

## Findings

1. Admin nonces are process-local, so a signature can be replayed in another
   serverless instance. Admin messages also omit domain, chain, route, and
   payload binding.
2. Public metadata GET requests can repair Blob overrides and call OpenSea.
3. Trait Lab operation states (`created`, `charged`, `confirmed`) do not expose
   charge submission, metadata commit, completion, or failure/recovery states.
4. Shared Blob JSON documents use read-modify-write and can lose concurrent
   supply, gallery, and refresh-queue updates.
5. A charged preview can be lost client-side before confirmation, and generic
   confirmation failures do not expose a durable recovery path.
6. Monad configuration accepts legacy generic/testnet environment paths in
   production-facing code.
7. Leaderboard and bounty behavior does not yet have a completed-operation-only
   data contract or default-off feature gates.

## Safe-Fix Plan

1. Bind new admin signatures to an explicit domain/version, chain ID, route,
   action, and canonical payload hash. Persist consumed nonce records with a
   deterministic key and keep sensitive handlers idempotent.
2. Make metadata GET strictly read-only. Move all repair and OpenSea work to
   authenticated/explicit mutation paths.
3. Expand Trait Lab operation state and write append-only completion records.
   Make confirmation retries return the completed result rather than applying
   metadata or supply changes twice.
4. Add an operation lookup/recovery API and preserve pending charged previews
   in browser storage until completion.
5. Aggregate leaderboard rows exclusively from completed operation records.
   Keep leaderboard and bounty feature flags disabled unless explicitly
   enabled in the environment.
6. Pin the production wallet/network surface to Monad mainnet constants and
   reject legacy testnet configuration instead of silently selecting it.

## Implemented Hardening

- Admin authorization version 2 binds the production domain, Monad chain ID
  `143`, action, exact API route, and a canonical payload hash. Consumed nonces
  are stored under deterministic keys in the `dyoor-admin-auth` store, and
  security-sensitive reads fail closed on storage errors.
- Metadata upload batches are bound to a signed manifest. Snapshot discovery is
  scoped to a short-lived read session, while the final snapshot payload
  requires a second signature over the exact export input.
- Public metadata GET is now read-only. It builds and normalizes metadata but no
  longer repairs overrides, writes Blob data, processes refresh jobs, or calls
  OpenSea.
- Trait Lab preview requests require a fresh wallet signature over the wallet,
  token, trait, action, timestamp, and nonce. The signed authorization produces
  a deterministic operation ID and a server-secret deterministic candidate, so
  retries cannot produce a different paid result.
- Energy spends use a deterministic reason, reconcile existing matching
  `EnergySpent` logs before submission, reject an already-busy operator, and
  submit against a fixed confirmed operator nonce snapshot. Concurrent
  serverless attempts therefore contend for one account nonce rather than
  executing multiple debits.
- Confirmation verifies the stored Energy transaction receipt, Energy Bank
  address, wallet, amount, and reason before metadata can change. Recycle
  previews require an explicit prepared/charged state even though they do not
  debit Energy.
- Trait Lab records now expose preparation, charge submission, confirmation,
  metadata commit, recovery, failure, and completion states. Completed results
  are stored under append-only per-operation keys and exact confirmation retries
  return the prior completed result.
- The browser stores paid previews until completion. The operation lookup API
  and recovery UI can restore interrupted confirmations with a fresh signature;
  old five-minute confirmation challenges are not reused.
- Supply events, completion records, burned-Droid records, and OpenSea refresh
  jobs use independent keys. The legacy OpenSea queue is migrated to append-only
  job records when processed, avoiding unrelated read-modify-write losses.
- Charged previews write per-operation positive-supply reservations before they
  return to the browser. Candidate generation and confirmation include other
  outstanding reservations, and a committed supply event releases its
  reservation, preventing paid previews from competing for the same final
  capped unit.
- The optional Trait Lab leaderboard aggregates only completion records.
  `DYOOR_TRAIT_LAB_ENABLE_LEADERBOARD` and
  `DYOOR_TRAIT_LAB_ENABLE_BOUNTIES` are disabled by default. No bounty payout
  execution path was added.
- The wallet, metadata scope, Trait Lab, Blueprint checker, and Energy
  reconciliation reject explicit testnet configuration in production rather
  than silently remapping it to mainnet.

## Production Prerequisites

- Set a dedicated `DYOOR_TRAIT_LAB_SECRET`.
- Prefer a dedicated `TRAIT_LAB_ENERGY_SPENDER_PRIVATE_KEY` with only
  `SPENDER_ROLE`. The existing Energy Bank operator key remains a compatibility
  fallback.
- Keep leaderboard and bounty flags false until their product rules and
  operational monitoring are approved.
- Continue invoking the rate-limited OpenSea refresh processor or its scheduled
  equivalent so append-only follow-up jobs are drained.

## Validation

Validation on 2026-07-23 was read-only against production systems; contract
tests used the local Hardhat network.

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `node --test test/*.test.js`: 36 passed, 0 failed.
- `npm run build`: passed with Next.js 16.2.9.
- `git diff --check`: passed.

## Release Invariants

- No audit code sends transactions during validation.
- Public metadata GET performs no Blob writes and no outbound refresh request.
- A reused admin signature cannot authorize a different route, action, or
  payload.
- A Trait Lab operation has at most one Energy debit identifier and one
  completion record.
- Only completed operations contribute to leaderboard totals.
- Bounty execution remains disabled by default.
- Typecheck, focused tests, and production build must pass before any push.
