# Trait Lab Bounty Payout Engine

Status: built and tested locally; **not deployed to Monad mainnet**.

## Purpose

`DYOORTraitBounties.sol` pays internal, non-transferable Energy when a completed
Trait Lab operation reveals an exact configured trait value. The engine uses
the production `DYOOREnergyBank`; it does not custody MON or an ERC-20.

The server is responsible for verifying the append-only Trait Lab completion
record. The settlement contract independently enforces:

- An immutable campaign ID, trait type, trait value, reward, action mask, and
  claim limits.
- Draft-first creation. A newly created bounty is inactive until the owner
  explicitly activates it.
- Reroll, Unlock, and/or Reroll All eligibility.
- Completion-time start and end windows.
- A global maximum number of payouts.
- Per-wallet and per-Droid payout limits.
- One settlement for each bounty + operation + Droid + revealed trait.
- A unique Energy Bank claim key for every settlement.
- Owner pause, campaign close, and processor revocation controls.

The contract must receive `CREDIT_ROLE` on the production Energy Bank before it
can settle a payout. The Netlify operator only receives processor permission on
the bounty contract; it does not need Energy Bank admin permission.

## Application flow

1. Trait Lab verifies payment, commits metadata, writes supply events, and
   persists its append-only completion record.
2. The reveal matcher considers only positive `equip` supply deltas. Existing
   metadata values, removed traits, burned traits, previews, and failed
   operations cannot match a bounty.
3. Each exact match is submitted to `DYOORTraitBounties`.
4. The contract enforces all limits, records the settlement, and calls
   `DYOOREnergyBank.creditEnergy`.
5. The site stores a display receipt for the public winners table.
6. A secret-authenticated Netlify job retries unsettled completions every two
   minutes. A payout failure never rolls back a completed metadata operation.

## Owner workflow

The Admin Command Center contains the bounty creator and campaign list.

1. Choose a canonical campaign ID.
2. Select an exact trait type/value from the collection catalog.
3. Set the Energy reward, maximum winners, wallet limit, and Droid limit.
4. Select eligible reveal actions.
5. Set an optional start/end window.
6. Submit the owner transaction to create an **inactive** immutable draft.
7. Review the draft and payout preflight.
8. Activate the campaign with a second owner transaction.

Campaign rules are intentionally not editable. Close a mistaken campaign and
create a new ID.

## Deployment runbook

Do not enable `DYOOR_TRAIT_LAB_ENABLE_BOUNTIES` before every preflight item
passes.

1. Create a dedicated low-value processor wallet and fund it with enough MON
   for settlement gas. Do not use the owner wallet as the Netlify operator.
2. Set local deployment values. Never paste either private key into source:

   ```text
   DEPLOYER_PRIVATE_KEY=
   DYOOR_OWNER_ADDRESS=
   ENERGY_BANK_ADDRESS=0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767
   DYOOR_TRAIT_BOUNTY_PROCESSOR_ADDRESS=
   DYOOR_TRAIT_BOUNTY_GRANT_CREDIT_ROLE=false
   ```

3. Deploy:

   ```text
   npm run deploy:trait-bounties
   ```

4. Verify the bytecode and constructor arguments on a Monad explorer.
5. From the Energy Bank admin wallet, grant its `CREDIT_ROLE` to the verified
   bounty contract.
6. Confirm the bounty contract reports the production Energy Bank and the
   dedicated processor reports `processors(address) == true`.
7. Add these to Netlify **Functions** scope:

   ```text
   DYOOR_TRAIT_BOUNTY_OPERATOR_PRIVATE_KEY=...
   DYOOR_TRAIT_BOUNTY_PROCESSOR_SECRET=<fresh 64-character hex>
   DYOOR_TRAIT_LAB_ENABLE_BOUNTIES=true
   ```

8. Add this public address to Netlify **Builds** scope:

   ```text
   NEXT_PUBLIC_DYOOR_TRAIT_BOUNTIES_CONTRACT=0x...
   ```

   The server bundle uses this same public address. Keep the deployment block
   and processor address in the local deployment record rather than Netlify.

9. Build and deploy. Confirm the Admin Command Center shows:
   `Energy Role: Granted`, `Processor: Approved`, and `Payouts: Ready`.
10. Create a one-winner test bounty with a small Energy reward, activate it,
    complete a matching reveal, and verify the Energy Bank event and winners
    table before creating larger campaigns.

## Secret handling

- `DEPLOYER_PRIVATE_KEY` stays local and is only used for explicit deployment.
- `DYOOR_TRAIT_BOUNTY_OPERATOR_PRIVATE_KEY` belongs only in Functions scope.
- `DYOOR_TRAIT_BOUNTY_PROCESSOR_SECRET` belongs only in Functions scope.
- Never put either secret in a `NEXT_PUBLIC_` variable.
- Keep the feature flag false while the contract is absent, paused, missing
  `CREDIT_ROLE`, or missing the configured processor.
