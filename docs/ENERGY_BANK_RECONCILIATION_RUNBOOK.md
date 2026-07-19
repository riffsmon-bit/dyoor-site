# Energy Bank Reconciliation Runbook

This is an operational runbook, not a formal audit.

## What The Warning Means

The Ascension page can show harvested and lifetime Energy from indexed staking events while the on-chain Energy Bank spendable balance is lower.

Example:

- Harvested Energy: `117.6K`
- Lifetime Energy: `117.6K`
- Energy Bank spendable: `94.8K`

That means the UI can see the harvest history, but at least one harvest credit has not been applied to `DYOOREnergyBank.creditEnergy(...)` yet. The missing amount is not spendable for rerolls until reconciliation credits are applied.

## Required Access

- Connect the owner/admin wallet in the D.Y.O.O.R admin UI.
- The server-side Energy operator must be configured in Netlify, not in the browser.
- The operator address must have `CREDIT_ROLE` on `DYOOREnergyBank`.
- Required server env vars:
  - `MONAD_RPC_URL`
  - `GOLDSKY_SUBGRAPH_URL`
  - `ENERGY_BANK_ADDRESS`
  - `ENERGY_BANK_OPERATOR_PRIVATE_KEY`

Never paste the owner private key into the frontend, browser storage, repo, or Netlify client-side env vars.

## Admin UI Fix

1. Open `/admin`.
2. Connect the owner/admin wallet.
3. Find the `Energy Reconciliation` panel.
4. Click `Load Report`.
5. Confirm the preflight says `Ready`.
6. If preflight is blocked, fix the reported issue first:
   - wrong chain means the RPC is not Monad mainnet;
   - missing `CREDIT_ROLE` means grant the server operator the credit role;
   - paused means unpause the Energy Bank if appropriate.
7. Download the JSON/CSV report before applying repairs.
8. Review the affected-wallet rows.
9. Confirm the target wallet appears with the expected missing amount.
10. Set a conservative batch limit, such as `10`.
11. Check the confirmation box.
12. Click `Apply Next Credit Batch`.
13. Wait for the batch result.
14. Repeat `Load Report` and `Apply Next Credit Batch` until affected rows are gone or the target wallet is repaired.
15. Refresh `/ascension` for the wallet.
16. Confirm the warning clears and spendable Energy matches the repaired bank balance.

## CLI Report Only

Use this to generate a local report without applying credits:

```bash
npm run energy:reconciliation:report
```

This writes dated files under `data/`:

- `data/energy-reconciliation-YYYY-MM-DD.json`
- `data/energy-reconciliation-YYYY-MM-DD.csv`

The CLI report is diagnostic. Prefer the admin UI for repairs because it includes owner authorization, preflight checks, and batch logging.

## Safety Notes

- Repair credits use deterministic claim keys so already-credited harvests are skipped.
- The server caps repair batches at 25 credit actions.
- Failed rows are not marked complete.
- Re-run the report after each batch because wallet state can change.
- Do not use `DEPLOYER_PRIVATE_KEY` locally for repairs unless there is a deliberate emergency reason and the key holder approves that exact action.
