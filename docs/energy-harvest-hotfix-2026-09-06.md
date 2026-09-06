# Energy harvest recovery — 2026-09-06

## Verified incident

Claim `0x082f9ad4b86117452f20e1e967d564ee3d159a8edf79b910e256d25345d28d63` succeeded on Monad at block 102550638, emitting PointsClaimed for wallet `0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6`, amount `57134393333333333333333` raw Energy (57,134.393333333333333333).

Before recovery, bank `usedClaimTxHash` was false, and neither the event nor its wallet-ledger entry existed in the site's strong-consistency Energy store. Both preview and production displayed the old harvested total, 29,358.886666666666666665.

The server had no MONAD_RPC_URL, so receipt/credit handling inherited NEXT_PUBLIC_MONAD_RPC_URL. That configured Alchemy endpoint returned HTTP 429 / quota limit for this exact receipt. Public Monad RPC returned the successful receipt. No RPC credential is included here.

## Scoped fix

- Energy receipt reads and bank settlement use a dedicated HTTPS ENERGY_RPC_URL when explicitly configured, otherwise https://rpc.monad.xyz. Browser/general RPC subscription settings no longer affect this workflow. Dynamic chain detection and the chain-143 check remain mandatory.
- Receipt verification checks mainnet, successful receipt, exact staking emitter/topic and matching wallet; credit amount remains derived from the event. Bank deduplication, credit role, static-call preflight and fixed gas limit remain unchanged.
- A transaction is submitted via one provider. No automatic cross-provider transaction recreation or broadcast retry was added.
- Post-harvest UI refresh no longer launches historical scanning after the exact receipt sync. Unknown pending reads remain distinguishable from real zero and cannot overwrite a successful direct read.
- No NFT, reroll, Energy pricing, contract, admin role, secret, or Droid OS changes are included.

## Recovery procedure

User authorized repairing this confirmed claim. Back up the Energy ledger first; recheck the on-chain claim and bank deduplication flag. Invoke the existing sync-wallet endpoint with only the verified wallet/hash. Afterward verify the credit receipt and exact event, bank usedClaimTxHash, durable event/ledger entry, and displayed totals. Do not create a second harvest or manually fabricate a credit amount. Unknown submission outcomes require read-only reconciliation, not blind retries.

Other users' failed historical claims are not automatically backfilled by this change; each needs receipt verification. No claims of broad reconciliation are made.
