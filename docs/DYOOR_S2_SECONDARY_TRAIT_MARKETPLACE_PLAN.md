# D.Y.O.O.R Season 2 Secondary Trait Marketplace Plan

This is a planning document, not an implementation spec or audit.

> Update (August 2026): the site now includes a direct-equip primary Trait Marketplace where holders buy approved optional traits with Energy or MON. See `docs/DYOOR_S2_TRAIT_MARKETPLACE.md`. The ERC-1155 inventory and user-to-user secondary market described below remain future work.

## Why This Matters

If the final Season 2 NFT supply is cut below 3,333, individual traits become more sensitive to active supply. The Trait Lab already moves traits through reroll, unlock, remove, and burn-style accounting. A secondary trait marketplace should build on that accounting instead of treating metadata edits as arbitrary JSON changes.

## Current Trait Lab Model

- Droids own their active metadata traits.
- Background, Droid, Eyes, and Mouth are protected from removal.
- Optional traits can be removed to `None`.
- Rerolling equips a new approved trait and burns the previous active trait from supply accounting.
- Unlocking fills an empty optional slot with an approved trait.
- Special is currently not rerollable or unlockable because Special side effects can hide wearable layers.
- Compatibility is enforced server-side before a preview is returned and again before confirmation.
- Metadata updates remain off-chain through the site API and Netlify Blob overrides.

## Marketplace Goal

Let users trade optional traits without letting anyone bypass:

- NFT ownership checks
- Trait compatibility rules
- Active supply caps
- Burn accounting
- Metadata Version updates
- ERC-4906 metadata refreshes
- D.Y.O.O.R-controlled approved trait registry

## Recommended Architecture

Use a separate ERC-1155-style trait inventory contract for tradable, unequipped traits.

The Season 2 NFT contract should stay focused on droid ownership, metadata, SeaDrop compatibility, and collection-level controls. A separate trait contract keeps marketplace inventory distinct from NFTs and makes traits easier to list, transfer, and index.

## Core Trait States

- Active: equipped on a Droid and visible in metadata.
- Inventory: owned by a wallet as a trait token, not currently equipped.
- Listed: inventory trait is listed for sale through a marketplace/orderbook.
- Burned: permanently removed from circulation.

## Proposed User Flows

### Extract Trait To Inventory

User selects an eligible optional trait, pays the configured extraction fee, and confirms:

- Server verifies NFT ownership.
- Server validates the trait is removable and not protected.
- Server updates the Droid trait to `None`.
- Server mints or releases one ERC-1155 trait token to the owner.
- Metadata Version increments.
- Active supply decreases by one.
- Inventory supply increases by one.

This should be different from the current Remove Trait action if Remove is intended to burn the trait.

### Burn Trait

User selects an eligible optional trait and burns/removes it:

- Active supply decreases by one.
- Burned supply increases by one.
- No tradable inventory token is created.

### Buy Trait

Buyer purchases an ERC-1155 trait token:

- Payment and transfer happen through the marketplace.
- The buyer receives an inventory trait token.
- Droid metadata is unchanged until the buyer equips it.

### Equip Purchased Trait

User selects a Droid and an owned inventory trait:

- Server verifies Droid ownership.
- Server verifies ERC-1155 trait ownership.
- Server validates compatibility against the Droid's current traits.
- Server burns or locks the inventory trait token.
- Server updates metadata.
- Active supply increases by one.
- Metadata Version increments.
- ERC-4906 refresh event is emitted where available.

## Traits Eligible For Trading

Initial recommendation:

- Clothes
- Hat
- Accessories
- Accessories 2
- Stickers/Body art

Special should stay disabled until the Special compatibility model is complete. Eyes and Mouth should stay non-removable and non-tradable because they are guaranteed identity traits.

## Supply Accounting

Every trait should have stable IDs from the approved trait registry. Track:

- Initial generated count
- Active supply
- Inventory supply
- Burned supply
- Max active supply, where configured
- Max total supply, if a hard cap is desired

Invariant:

`activeSupply + inventorySupply + burnedSupply == totalIssuedForTrait`

If reroll burns the old trait, burned supply should increase. If extract creates inventory, burned supply should not increase.

## Marketplace Options

### Option A: ERC-1155 Trait Tokens

Best long-term fit.

- Compatible with standard NFT/token marketplaces where supported.
- Gives users real wallet-owned trait inventory.
- Cleanly separates inventory from active metadata.
- Requires a new contract and full security review.

### Option B: Site-Only Signed Orders

Faster but more centralized.

- Store listings in Netlify Blobs or another database.
- Use signed seller approvals.
- Server coordinates payment and metadata updates.
- Harder to make portable to outside marketplaces.

### Option C: No Tradeable Inventory, Buy Paid Rerolls Only

Simplest but not a real secondary trait marketplace.

- Users pay for rerolls/unlocks.
- Supply burns still make traits rarer.
- No user-to-user trait trading.

## Required Contracts

Likely new contracts:

- `DYOORS2TraitInventory` as ERC-1155.
- Optional marketplace or escrow contract if not relying on third-party marketplaces.

The trait inventory contract needs:

- Owner or trait-manager controlled mint/burn.
- Stable trait ID mapping.
- Supply counters.
- Pause controls.
- No ability to mint D.Y.O.O.R NFTs.
- No ability to withdraw Season 2 NFT funds.

## Backend Requirements

- Canonical trait registry with stable IDs.
- Compatibility validation reused from Trait Lab.
- Trait supply ledger reconciliation.
- Signed preview and confirm flow.
- Ownership validation for both Droid NFT and trait inventory token.
- Metadata override update.
- Event or admin script to emit ERC-4906 updates.

## Open Questions

- Should Remove Trait burn permanently, or should there be a separate Extract Trait action?
- Should extracting traits cost Energy, MON, or both?
- Should all optional traits be extractable, or only traits above a rarity threshold?
- Should Special ever be tradeable?
- Should trait inventory tokens be transferable immediately or require a marketplace allowlist?
- Should marketplace royalties or fees apply to trait sales?
- Should active supply caps include inventory supply or only equipped traits?

## Recommended Next Steps

1. Keep current Remove Trait as a burn/removal action.
2. Export the current trait supply ledger and verify active supply math.
3. Freeze stable trait IDs in the trait registry.
4. Decide whether extracting to inventory is a separate paid action.
5. Draft `DYOORS2TraitInventory` as a separate contract.
6. Add tests for active, inventory, listed, equipped, and burned states.
7. Build a small admin-only dry run before exposing a public marketplace.
