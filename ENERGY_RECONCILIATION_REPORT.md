# Energy Reconciliation Report

Date: 2026-06-28
Branch: `audit-polish-migration-check`

## Purpose

This report identifies wallets whose Ascension `PointsClaimed` harvest history is greater than the usable Energy currently credited in the Energy Bank after preserving existing airdrops, recharge credits, transfers, and spend history.

Only wallets with confirmed missing usable Energy should be repaired. If the UI/indexing fix shows balances correctly and the Energy Bank source of truth is already correct, do not credit users again.

## Generation

Run:

```bash
npm run energy:reconciliation:report
```

The script reads:

- `GOLDSKY_SUBGRAPH_URL` or `NEXT_PUBLIC_GOLDSKY_SUBGRAPH_URL`
- `MONAD_RPC_URL` or `NEXT_PUBLIC_MONAD_RPC_URL`
- `ENERGY_BANK_ADDRESS` or `NEXT_PUBLIC_ENERGY_BANK_ADDRESS`
- `HARVEST_LEDGER_PATH`, defaulting to `data/harvested-energy.json`

It exports:

- `data/energy-reconciliation-YYYY-MM-DD.csv`
- `data/energy-reconciliation-YYYY-MM-DD.json`

## Report Columns

- `wallet`
- `totalHarvestedFromEvents`
- `legacyHarvested`
- `harvestedShown`
- `lifetimeShown`
- `bankShown`
- `spent`
- `expectedHarvested`
- `expectedLifetime`
- `expectedBank`
- `creditedHarvest`
- `uncreditedHarvest`
- `missing`
- `affected`
- `recommendedCredit`
- `repairable`
- `evidenceTxHashes`
- `evidenceClaimKeys`
- `notes`
- `repairItems` in JSON export

## Affected Wallet Rule

A wallet is marked affected when:

```text
expectedBank > EnergyBank.spendableEnergy(wallet)
```

Recommended credit is capped at uncredited harvest events:

```text
recommendedCredit = min(missing, uncreditedHarvest)
```

The admin repair API credits unused claim keys with `creditEnergy`. If a claim key is already marked used but the wallet is still short in Energy Bank lifetime/spendable balance, the repair plan uses a reconciliation `correctEnergy` reason for that shortfall and records the issue id in the repair log.

## Owner Repair Tool

Open `/admin` or `/admin-command-center`, connect the owner wallet, then use `Energy Reconciliation`.

Workflow:

1. Load report.
2. Export CSV/JSON.
3. Review affected wallets and evidence hashes.
4. Confirm the repair preview.
5. Apply the next capped credit batch.
6. Export or save the repair result log.
7. Reload the report and repeat only if affected wallets remain.

Security:

- server-side owner wallet check;
- action-specific signed message: `energy-reconciliation`;
- timestamp window;
- nonce replay protection;
- operator must hold Energy Bank `CREDIT_ROLE`;
- operator must hold Energy Bank `DEFAULT_ADMIN_ROLE` when a reconciliation correction is required;
- repair logs are marked as reconciliation activity.

## Current Status

The code path is implemented in:

- `app/api/admin/energy-reconciliation/route.ts`
- `app/admin/page.tsx`
- `scripts/generate-energy-reconciliation-report.js`

Run the generator after deployment environment variables are available to create the dated CSV/JSON artifacts. The generated files should be reviewed before any repair batch is applied.
