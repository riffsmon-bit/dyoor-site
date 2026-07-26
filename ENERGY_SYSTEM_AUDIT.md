# DYOOR Energy System Audit

Date: 2026-06-28
Branch: `audit-polish-migration-check`

## Summary

Energy is an internal points balance, not an ERC20 token. Pending Ascension Energy, harvested Ascension Energy, and usable Energy Bank balance are separate states and must not be collapsed into one frontend-only number.

The latest fix makes the UI read harvested Energy from indexed `PointsClaimed` events, reads usable Energy from the Energy Bank contract, credits newly confirmed harvests into the Energy Bank, and adds an owner-only reconciliation workflow for historical harvests that were indexed but not credited.

## Data Sources

- Pending Energy: Ascension staking contract `pendingPoints(address)`.
- Harvested Energy: Ascension staking `PointsClaimed(address indexed user,uint256 amount)` events from Goldsky, merged with non-duplicated local legacy ledger rows in `data/harvested-energy.json`.
- Usable Energy Bank: Energy Bank `spendableEnergy(address)`.
- Lifetime Energy: Energy Bank `lifetimeEnergy(address)`, plus indexed harvest totals where historical harvests are missing from Energy Bank.
- Spent Energy: Energy Bank `totalSpent(address)`.
- Airdrops: Energy Bank `airdropEnergy(...)` and `EnergyAirdropped` event.
- Recharge purchases: `/api/energy-recharge`, verified MON treasury payment, then `creditEnergy(user, amount, paymentTxHash)`.
- Lend to a Fren: `/api/energy-transfer`, server-verified signed transfer; sender uses `spendEnergy`, recipient uses `creditEnergy`.
- Admin credits: Energy airdrops and corrections through admin/operator tooling.
- Historical seed data: `data/harvested-energy.json`, used only as fallback or non-duplicated merge source.

## Formulas

All contract values use 18 decimals.

```text
pendingEnergy = Ascension.pendingPoints(wallet)

harvestedEnergy =
  sum(unique Goldsky PointsClaimed events)
  + non-duplicated historical harvest ledger entries

creditedEnergy = EnergyBank.lifetimeEnergy(wallet)

spentEnergy = EnergyBank.totalSpent(wallet)

energyBank = EnergyBank.spendableEnergy(wallet)

nonHarvestLifetime = max(EnergyBank.lifetimeEnergy(wallet) - creditedHarvestEvents, 0)

expectedLifetime = nonHarvestLifetime + harvestedEnergy

expectedBank = max(expectedLifetime - spentEnergy, 0)

missingSpendable = max(expectedBank - EnergyBank.spendableEnergy(wallet), 0)
```

Pending Energy is never counted as harvested. Failed or unconfirmed transactions are never counted. Historical ledger rows are skipped when the same harvest transaction hash is already present in indexed events.

## Event And Indexing Notes

- Ascension harvest event: `PointsClaimed(address indexed user,uint256 amount)`.
- Primary indexer: `GOLDSKY_SUBGRAPH_URL` / `NEXT_PUBLIC_GOLDSKY_SUBGRAPH_URL`, query `pointsClaimeds`.
- Fallback scan: chunked `eth_getLogs` against the Ascension staking contract.
- Default S1 / Ascension start block: `54985442`.
- RPC fallback respects chunking and recursive split behavior to avoid oversized log ranges.
- Event dedupe key: Goldsky event id or `txHash + logIndex`.
- EnergyBank replay/double-credit guard: `usedClaimTxHash(bytes32)`.

## UI Fix

`hooks/useAscension.ts` now:

- normalizes wallet addresses with `getAddress`;
- keeps query keys wallet-specific;
- refuses to render previous wallet data for a newly connected wallet;
- fetches pending, banked, harvested, and lifetime values from the stats function plus direct contract reads;
- keeps same-wallet previous values visible while refreshes run;
- emits dev-only debug logs with wallet, pending, harvested, credited, transfer placeholders, spent, lifetime, bank, event count, scanned block range, and data source.

`netlify/functions/ascension-stats.js` now:

- defaults harvested reads to Goldsky indexed events;
- merges non-duplicated historical ledger claims;
- reads `spendableEnergy`, `lifetimeEnergy`, and `totalSpent`;
- reports `calculatedBankEnergy` and `missingSpendableEnergy` for reconciliation visibility;
- keeps `bankedEnergy` tied to the actual Energy Bank spendable balance.

`app/ascension/page.tsx` now verifies each confirmed harvest transaction and calls `/api/energy-harvest-credit` so future harvests are credited into the Energy Bank source of truth.

## Reconciliation

Owner-only reconciliation is available through:

- Admin UI: `/admin` or `/admin-command-center`, section `Energy Reconciliation`.
- API: `POST /api/admin/energy-reconciliation`.
- CLI export: `npm run energy:reconciliation:report`.

The reconciliation report compares indexed harvest activity with Energy Bank balances and recommends credits only for harvest claim keys that are not already marked used by `usedClaimTxHash`.

Repair batches:

- require owner wallet server-side verification;
- require an action-specific signed `energy-reconciliation` admin message;
- use timestamp and nonce replay protection;
- require the operator key to have Energy Bank `CREDIT_ROLE`;
- call `creditEnergy(wallet, amount, claimKey)` for unused harvest claim keys;
- call `correctEnergy(wallet, amount, reconciliationReason)` only when the claim key is already marked used but Energy Bank lifetime/spendable balance is still short;
- write a best-effort repair log to Netlify Blobs store `energy-reconciliation/repair-log.json`;
- skip already-used claim keys to prevent double credits.

## Remaining Risks

- Admin nonce replay protection is in-memory and should become durable before high-volume admin usage.
- Transfer-in and transfer-out detail is preserved through Energy Bank lifetime/spent values, but not yet separated into per-reason UI rows.
- Goldsky availability is required for the complete reconciliation report. The UI can fall back to RPC or legacy ledger for display, but repair decisions should use Goldsky plus Energy Bank.
- Existing historical rows with synthetic legacy claim keys require manual review if their recommended amount cannot be matched to whole claim entries.

## 2026-07-22 Flow Hardening

- Trait Lab now requires a fresh wallet signature over wallet, token ID, trait, action, timestamp, and nonce before the backend can spend Energy for a preview.
- Trait Lab derives a stable roll ID from that signed authorization and rejects reused or concurrently active authorizations.
- MON recharge credits the on-chain Energy Bank before writing its diagnostic ledger row. The verified payment transaction maps to a deterministic claim key, making retries idempotent.
- Public wallet harvest scans default to Ascension block `54985442`, cap caller-controlled scan and credit limits, and save checkpoints only after every discovered event is persisted.
- The wallet Energy API fails closed when the Energy Bank cannot be read. Ledger totals remain diagnostic and are not presented as spendable.
- The admin airdrop UI and its legacy route alias now use the on-chain Energy Bank path rather than creating ledger-only balances.

The reconciliation report generated at `2026-07-22T02:59:32.091Z` covered 35 wallets through indexed block `89337060` and reported zero affected wallets, zero missing Energy, and zero recommended credits. This is a point-in-time operational result, not a substitute for the scheduled reconciliation job.
