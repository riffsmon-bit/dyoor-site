# D.Y.O.O.R Season 2 Trait Lab User Guide

This is the public-facing operating guide for D.Y.O.O.R Season 2 Trait Lab.

Trait Lab lets Season 2 Droid holders update eligible dynamic traits after mint. The user connects a wallet, selects one of their Droids, chooses an available action, previews the result, and confirms the final metadata update.

## What Can Change

Locked traits cannot be changed:

- Background
- Droid

Guaranteed traits can be rerolled, but cannot be unlocked, removed, or recycled:

- Eyes
- Mouth

Wearable and optional traits can be rerolled, unlocked when empty, or recycled when filled:

- Clothes
- Hat
- Accessories
- Accessories 2
- Stickers/Body art

Special traits are disabled for new unlocks and rerolls until the final Special compatibility rules and asset registry are complete. Existing Special traits may be recycled/removed only where supported.

## Reroll

Reroll replaces an existing filled trait with a new approved trait from the D.Y.O.O.R registry.

The user does not choose arbitrary metadata. Trait Lab generates a valid result, checks compatibility, shows a before/after preview, and only saves the result after confirmation.

Current pricing uses this conversion:

```txt
1 MON = 50 Energy
```

Approved meme-token payments use the same numeric unit price as MON. For example, a 2 MON reroll costs 2 units of the selected approved meme token. Meme-token payments are split 50/50: half to the burn address and half to the D.Y.O.O.R treasury.

Current reroll pricing:

| Trait | Energy | MON | Approved Meme Token |
| --- | ---: | ---: | ---: |
| Eyes | 100 | 2 | 2 |
| Mouth | 100 | 2 | 2 |
| Hat | 200 | 4 | 4 |
| Clothes | 200 | 4 | 4 |
| Accessories | 300 | 6 | 6 |
| Accessories 2 | 300 | 6 | 6 |
| Stickers/Body art | 300 | 6 | 6 |

## Unlock

Unlock fills an empty optional slot for a Droid that minted without that trait.

Empty means the trait is missing, blank, or set to `None`. Unlocks choose from the approved trait registry and still obey all compatibility rules.

Eyes and Mouth are guaranteed traits, so unlock is not shown for those slots.

Current unlock pricing is a flat rate:

| Trait | Energy | MON | Approved Meme Token |
| --- | ---: | ---: | ---: |
| Clothes | 100 | 2 | 2 |
| Hat | 100 | 2 | 2 |
| Accessories | 100 | 2 | 2 |
| Accessories 2 | 100 | 2 | 2 |
| Stickers/Body art | 100 | 2 | 2 |

## Recycle

Recycle removes an eligible optional trait and turns that slot back to `None`.

Recycle does not cost Energy or MON. Instead, the removed trait is burned from active supply accounting and the wallet receives an Energy reward.

Current recycle rewards:

| Trait | Energy Reward |
| --- | ---: |
| Clothes | 50 |
| Hat | 50 |
| Accessories | 50 |
| Accessories 2 | 50 |
| Stickers/Body art | 50 |
| Special | 150 |

Eyes, Mouth, Background, and Droid cannot be recycled.

## Meme Token Payments

Approved meme-token rerolls and unlocks require two wallet transactions:

1. Send 50% of the configured meme-token amount to the treasury.
2. Send 50% of the configured meme-token amount to the burn address.

Treasury:

```txt
0x4d540f7d0eb841c839334655c9f88313d750c6d5
```

Burn address:

```txt
0x000000000000000000000000000000000000dEaD
```

Approved meme-token contracts:

```txt
0x43cF5407BDA1400498b8064d50A7e17528d87777
0x350035555E10d9AfAF1566AaebfCeD5BA6C27777
0x81A224F8A62f52BdE942dBF23A56df77A10b7777
0x21E325B059Cd83d4037C82F0F5998Ba2dF3d7777
0xFD97581D397622f6E6662917ea3DeEEfB9F57777
0x42a4aA89864A794dE135B23C6a8D2E05513d7777
0x0CC9B2e2AcD7BACfF79eb7dB48F5662B622E7777
```

The server verifies both ERC-20 transfer receipts before it creates the preview. If either transaction is missing, unconfirmed, from the wrong wallet, sent to the wrong address, uses an unapproved token, or has the wrong amount, the roll is rejected.

If the treasury transfer confirms but the burn transfer is rejected or interrupted, Trait Lab remembers the treasury transaction for the same token, trait, action, and payment token so the user can retry the burn transaction without starting over. This is client-side recovery; the server still verifies both on-chain receipts before any metadata preview is created.

## Compatibility Rules

Trait Lab blocks impossible combinations before metadata is saved.

Current important rules:

- Background and Droid are always preserved.
- Special traits are not available for new unlocks or rerolls.
- Special cleanup, when supported, may clear wearable layers but must not clear Background or Droid.
- Bandanna cannot combine with conflicting mouth items such as Ahhh tongue, gold bar, joint, cigar, cigarette, Ahhh flame, or toothpick.
- Bandanna/Bandana accessory layers cannot combine with Hat. If a Hat is added, the Bandanna accessory slot is cleared; if a Bandanna accessory is added, the Hat slot is cleared.
- Accessories and Accessories 2 cannot equip the same visible trait at the same time.
- Every result must come from the approved trait registry or approved asset list.

## What Happens When A User Confirms

1. The wallet signs the Trait Lab confirmation message.
2. The server re-verifies the wallet owns the token.
3. The server re-checks the selected trait and action.
4. The server validates Energy spend, MON payment, or recycle reward.
5. The server validates supply and compatibility rules.
6. The server renders the new token image.
7. The server saves the metadata override.
8. Metadata Version increments.
9. The public metadata endpoint returns the updated metadata.
10. OpenSea metadata refresh fires immediately and schedules a follow-up refresh when `OPENSEA_API_KEY` is configured.

OpenSea receives one refresh immediately after confirmation, then a delayed follow-up so rapid back-to-back rerolls settle into one final metadata/image state. The D.Y.O.O.R metadata endpoint updates first; marketplace display may lag behind it.

## OpenSea Refresh

After a successful confirmed Trait Lab change, the server calls OpenSea's metadata refresh endpoint for the affected token immediately, then schedules one follow-up refresh. Repeated rerolls on the same token update the queued follow-up run time instead of stacking multiple delayed refreshes.

The browser also pings the refresh processor after the delay, and Netlify runs `opensea-refresh-queue` every two minutes as a fallback. This keeps follow-up refreshes moving even if the user closes the tab after confirming a reroll.

Required private environment variable:

```txt
OPENSEA_API_KEY=...
```

Optional environment variables:

```txt
OPENSEA_CHAIN=monad
OPENSEA_METADATA_REFRESH_TIMEOUT_MS=3500
OPENSEA_METADATA_REFRESH_DELAY_MS=120000
OPENSEA_METADATA_REFRESH_DISABLED=0
```

Refresh failures do not revert a successful Trait Lab update. If OpenSea rate-limits or errors, the metadata remains updated on D.Y.O.O.R and the refresh queue retries later.

## User Tutorial

1. Open Trait Lab.
2. Connect the wallet that owns the Season 2 Droid.
3. Select a Droid from the owned token grid.
4. Choose a trait slot from the dropdown.
5. Choose the action:
   - Reroll for a filled trait.
   - Unlock for an empty optional slot.
   - Recycle to remove an eligible optional trait and earn Energy.
6. Choose payment method when applicable:
   - Spend Energy.
   - Spend MON.
   - Spend an approved meme token.
7. Preview the generated result.
8. Confirm the change with the connected wallet.
9. Wait for the new Metadata Version and image to appear.
10. OpenSea refresh is scheduled automatically, but OpenSea display can lag while it re-indexes.

## Notes

- Trait Lab metadata is dynamic.
- The contract base URI should remain pointed at the live D.Y.O.O.R metadata API.
- Images can continue using Pinata assets and generated render URLs.
- Recycle rewards are credited through the Energy Bank.
- The system tracks trait supply deltas for equipped and burned traits.
- Meme-token payments require two wallet confirmations because the payment is split between treasury and burn.
