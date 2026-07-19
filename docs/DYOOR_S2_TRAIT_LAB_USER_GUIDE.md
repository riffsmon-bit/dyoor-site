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

Current reroll pricing:

| Trait | Energy | MON |
| --- | ---: | ---: |
| Eyes | 500 | 10 |
| Mouth | 500 | 10 |
| Hat | 750 | 15 |
| Clothes | 750 | 15 |
| Accessories | 1000 | 20 |
| Accessories 2 | 1000 | 20 |
| Stickers/Body art | 1000 | 20 |

## Unlock

Unlock fills an empty optional slot for a Droid that minted without that trait.

Empty means the trait is missing, blank, or set to `None`. Unlocks choose from the approved trait registry and still obey all compatibility rules.

Eyes and Mouth are guaranteed traits, so unlock is not shown for those slots.

Current unlock pricing is a flat rate:

| Trait | Energy | MON |
| --- | ---: | ---: |
| Clothes | 750 | 15 |
| Hat | 750 | 15 |
| Accessories | 750 | 15 |
| Accessories 2 | 750 | 15 |
| Stickers/Body art | 750 | 15 |

## Recycle

Recycle removes an eligible optional trait and turns that slot back to `None`.

Recycle does not cost Energy or MON. Instead, the removed trait is burned from active supply accounting and the wallet receives an Energy reward.

Current recycle rewards:

| Trait | Energy Reward |
| --- | ---: |
| Clothes | 250 |
| Hat | 250 |
| Accessories | 250 |
| Accessories 2 | 250 |
| Stickers/Body art | 250 |
| Special | 750 |

Eyes, Mouth, Background, and Droid cannot be recycled.

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
10. OpenSea metadata refresh is queued automatically when `OPENSEA_API_KEY` is configured.

OpenSea can still take time to re-index after a refresh is queued. The D.Y.O.O.R metadata endpoint updates first; marketplace display may lag behind it.

## OpenSea Refresh

After a successful confirmed Trait Lab change, the server calls OpenSea's metadata refresh endpoint for the affected token.

Required private environment variable:

```txt
OPENSEA_API_KEY=...
```

Optional environment variables:

```txt
OPENSEA_CHAIN=monad
OPENSEA_METADATA_REFRESH_TIMEOUT_MS=3500
OPENSEA_METADATA_REFRESH_DISABLED=0
```

Refresh failures do not revert a successful Trait Lab update. If OpenSea rate-limits or errors, the metadata remains updated on D.Y.O.O.R and OpenSea can be refreshed again later.

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
7. Preview the generated result.
8. Confirm the change with the connected wallet.
9. Wait for the new Metadata Version and image to appear.
10. OpenSea refresh is queued automatically, but OpenSea display can lag while it re-indexes.

## Notes

- Trait Lab metadata is dynamic.
- The contract base URI should remain pointed at the live D.Y.O.O.R metadata API.
- Images can continue using Pinata assets and generated render URLs.
- Recycle rewards are credited through the Energy Bank.
- The system tracks trait supply deltas for equipped and burned traits.
