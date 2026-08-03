# D.Y.O.O.R Season 2 Trait Marketplace

The live Trait Marketplace is a first-party, direct-equip store at `/marketplace`. A holder chooses an approved trait, previews it on an owned Season 2 Droid, and pays with Energy or MON. A completed purchase immediately updates that Droid's metadata.

This first release is not a user-to-user ERC-1155 resale market. Wallet-owned trait inventory and secondary listings remain a separate future contract project.

## Eligible Slots

- Clothes
- Hat
- Accessories
- Accessories 2
- Stickers/Body art

Special, Eyes, Mouth, Background, and Droid are not sold. This preserves the existing identity-trait and Special-layer safety rules.

## Fixed Prices

| Rarity | Energy | MON |
| --- | ---: | ---: |
| Common | 300 | 6 |
| Uncommon | 500 | 9 |
| Rare | 750 | 14 |
| Super Rare | 1,500 | 75 |
| Legendary | 3,000 | 125 |
| Mythic | 7,500 | 300 |

Energy and MON use separate fixed rarity tiers. Direct selection is intentionally more expensive than a random Trait Lab roll.

## Availability

Each listing reads the canonical approved trait registry and the Trait Lab supply ledger. The UI displays:

- Active supply
- Reserved supply from unexpired quotes
- Maximum active supply
- Available supply

`availableSupply = maxActiveSupply - activeSupply - reservedSupply`

Quotes reserve one unit for ten minutes. Charged quotes extend their reservation while settlement is recoverable. Sold-out listings cannot be quoted or purchased.

## Purchase Flow

1. The holder selects an owned Droid and clicks an in-stock listing.
2. A rate-limited, read-only request immediately composes a live preview without a signature, payment, persistence, or supply reservation.
3. If the holder continues, a free wallet signature requests a quote bound to the wallet, Droid, listing, exact trait value, payment mode, timestamp, and nonce.
4. The server verifies ownership, metadata cooldown, compatibility, current metadata version, and live supply.
5. The server composes and persists the exact post-purchase Droid image before asking for payment.
6. The holder reviews every metadata side effect and signs the exact purchase authorization.
7. Energy purchases use the existing concurrency-safe server-settled Energy ledger. MON purchases use an exact native transfer to the treasury.
8. The server rechecks ownership and metadata, saves the override, applies supply deltas, increments Metadata Version, and queues OpenSea refreshes.

The replaced active trait is burned under the existing Trait Lab accounting model. If compatibility rules clear an opposite accessory slot, that side effect is shown before payment.

Shramp occupies the opposite shoulder from The Hive, Molandak, Mouch, and 10KSquad. Equipping Shramp alongside any of those four preserves both accessory slots and does not create a burn for the existing companion. The four same-shoulder companions remain mutually exclusive with one another. This shared rule applies to both Marketplace purchases and Trait Lab results.

For direct Hat selections, the purchased Hat takes visual layer priority over existing eye or face traits. The previous Hat is replaced and burned; existing Eyes and Mouth traits remain unchanged so a Hat purchase never silently removes an identity trait.

## MON Payment Binding

A MON transaction must match all of the following:

- Monad mainnet chain ID 143
- Quote wallet as sender
- Configured treasury as recipient
- Exact tier price as value
- Empty transaction data so delegated treasury accounts receive a plain native transfer
- Confirmation within the quote payment window
- Successful confirmed receipt
- Transaction hash claimed by only one marketplace quote

The signed purchase authorization identifies the exact quote, listing, and Droid. Exact payment checks plus the one-use transaction claim prevent a confirmed transfer from settling more than one purchase without invoking treasury contract code.

## API Routes

- `GET /api/s2/trait-marketplace/catalog`
- `POST /api/s2/trait-marketplace/preview`
- `POST /api/s2/trait-marketplace/quote`
- `POST /api/s2/trait-marketplace/purchase`
- `GET /api/s2/trait-marketplace/quotes/:quoteId?wallet=:wallet`

All state-changing requests are rate-limited and wallet-signed. Purchase records, MON claims, supply reservations, supply events, and Energy debits are idempotent.

## Recovery

The browser stores only the pending quote ID and, when applicable, its MON transaction hash. The Restore Purchase action reloads the server record. If payment was charged before a metadata or refresh interruption, retrying completes the same operation instead of charging again.
