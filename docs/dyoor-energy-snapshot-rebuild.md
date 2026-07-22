# DYOOR Energy And Snapshot Rebuild

## Root Cause

The previous harvest flow had two separate systems:

1. the Ascension staking contract emitted `PointsClaimed` events when users
   harvested Energy
2. the app then called `/api/energy-harvest-credit`, which required a server
   operator key to push the same amount into the Energy Bank contract

If the second write failed or was delayed, the UI showed harvested Energy from
events or legacy ledgers, but spendable Energy came from the Energy Bank
contract. That created `missingSpendableEnergy` and required owner/admin
reconciliation to push credits.

Harvested Energy should not require a second owner/operator write to become
spendable in the app.

## New Energy Model

Production note, July 2026: Trait Lab still debits the on-chain Energy Bank
contract for rerolls, recycle rewards, Droid burn rewards, and wallet-to-wallet
Energy transfers. The ledger/indexer is used for visibility, diagnostics, and
repair planning. If indexed harvests are ahead of the Energy Bank, the admin
reconciliation flow must credit the missing spendable Energy before those users
can spend it in Trait Lab.

Spendable Energy is now derived from an off-chain ledger:

```text
spendableEnergy = CREDIT_HARVEST + CREDIT_AIRDROP + CREDIT_RECHARGE + CREDIT_TRANSFER + ADJUSTMENT_ADMIN - DEBIT_*
lifetimeEnergy = CREDIT_HARVEST + CREDIT_AIRDROP + CREDIT_RECHARGE + CREDIT_TRANSFER
```

`pendingEnergy` still comes from the staking contract live read when available.

Harvest credits are indexed from the staking contract `PointsClaimed` event and
deduped by `txHash:logIndex`. User harvest confirmation now syncs the confirmed
transaction into the ledger instead of requiring `/api/energy-harvest-credit`.

Admin airdrops, MON recharge credits, wallet-to-wallet transfers, and reroll
spends also write ledger entries. The Energy Bank remains the production
spendable source for Trait Lab until a transactional ledger debit path replaces
it end to end.

Reconciliation compares ledger-derived totals against the Energy Bank and
repairs mismatches when harvested credits were indexed but not credited to
spendable Bank balances.

## New Energy Endpoints

```text
GET  /api/energy/{wallet}
POST /api/energy/sync-wallet
POST /api/energy-transfer
POST /api/energy-recharge
POST /api/reroll
POST /api/admin/energy/airdrop
POST /api/admin/energy/reindex
POST /api/admin/energy/reconcile
GET  /api/admin/energy/export
```

`/api/admin/energy/reindex` accepts either owner wallet authorization or
`x-admin-secret` with `ENERGY_INDEXER_SECRET` / `ADMIN_API_SECRET`.

## Automatic Indexing

The scheduled function:

```text
netlify/functions/energy-indexer-hourly.js
```

runs every 15 minutes and calls `/api/admin/energy/reindex`. Set:

```text
ENERGY_INDEXER_SECRET=
ENERGY_INDEXER_MAX_CHUNKS=8
ASCENSION_ENERGY_LOG_CHUNK_SIZE=2500
ASCENSION_ENERGY_START_BLOCK=
```

## Storage

The storage adapter writes to Netlify Blobs in production and to local files
under `data/runtime` in local/dev. Set `DYOOR_STORAGE_ADAPTER=file` or
`DYOOR_RUNTIME_DATA_DIR=/tmp/dyoor-runtime` for local scripts/tests.

Before mainnet Energy spending for rerolls goes fully live, use a transactional
database such as Supabase, Neon, or Postgres. Netlify Blobs are durable, but they
do not provide transaction isolation for simultaneous debits.

Rerolls fail closed unless `NEXT_PUBLIC_DYOOR_S2_CONTRACT_ADDRESS` and
`DYOOR_S2_RPC_URL` / `NEXT_PUBLIC_DYOOR_S2_RPC_URL` are configured, because the
API must verify current token ownership before debiting Energy or changing
traits.

## Snapshot Rebuild

The new snapshot script replays canonical S1 `Transfer` events involving the
Ascension staking contract:

```text
npm run snapshot:s1:full
npm run snapshot:s1:incremental
npm run snapshot:s1:validate
npm run snapshot:s1:export
```

It saves outputs under:

```text
data/snapshots/s1-ascended/
```

The engine:

- scans chunked block windows
- stores a checkpoint after each successful chunk
- resumes incremental scans from the checkpoint
- builds token-level and wallet-level snapshots
- validates token state with S1 `ownerOf` and staking `stakeInfo` when possible
- exports JSON and CSV

Use these env vars:

```text
S1_SNAPSHOT_START_BLOCK=
S1_SNAPSHOT_BLOCK_WINDOW=2500
MONAD_RPC_URL=
DYOOR_S1_CONTRACT=0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f
ASCENSION_STAKING_ADDRESS=0xf9611226c1CcCcCa37951938d6f358D3d5106549
```
