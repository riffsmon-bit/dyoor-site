# D.Y.O.O.R Season 2 Trait Lab

This is the public guide for the D.Y.O.O.R Trait Lab.

## What Trait Lab Does

Trait Lab lets Season 2 holders update mutable traits on droids they own. The server verifies NFT ownership, charges Energy, creates a compatible trait result, renders a new image, saves the metadata override, increments Metadata Version, and queues an OpenSea metadata refresh when the API key is configured.

Background and Droid are locked. They cannot be changed, removed, or overwritten.

## Current Pricing

Trait Lab is Energy-only.

| Action | Trait | Cost |
| --- | --- | ---: |
| Reroll | Eyes | 100 Energy |
| Reroll | Mouth | 100 Energy |
| Reroll | Clothes | 200 Energy |
| Reroll | Hat | 200 Energy |
| Reroll | Accessories | 300 Energy |
| Reroll | Accessories 2 | 300 Energy |
| Reroll | Stickers/Body art | 300 Energy |
| Unlock Slot | Clothes | 100 Energy |
| Unlock Slot | Hat | 100 Energy |
| Unlock Slot | Accessories | 100 Energy |
| Unlock Slot | Accessories 2 | 100 Energy |
| Unlock Slot | Stickers/Body art | 100 Energy |
| Burn Droid | Entire NFT | Rewards 2,500 Energy |

Eyes and Mouth are guaranteed traits, so they are not unlockable. If either is somehow empty, Trait Lab blocks unlock and treats it as a metadata repair case.

Special is currently display-only in Trait Lab. It stays visible in metadata, but users cannot unlock or reroll Special until the Special compatibility rules are fully locked.

## How To Reroll

1. Connect the wallet that owns the Season 2 droid.
2. Select a droid from the owned token grid.
3. Pick a filled mutable trait.
4. Click Roll Reroll.
5. Review the before/after metadata and proposed image.
6. Click Confirm Change.

Energy is spent when the roll is generated. Confirming the already-generated result does not charge Energy again.

## How To Unlock A Slot

1. Select a droid with an empty mutable trait slot.
2. Pick an unlockable empty slot.
3. Click Roll Unlock.
4. Review the proposed trait and image.
5. Click Confirm Change.

Unlocking chooses from the approved trait registry. Users cannot submit arbitrary metadata.

## How Burning Works

Burn Droid permanently burns the selected ERC-721 NFT from the owner wallet by sending it to the zero address through the contract burn function. After the transaction confirms, the site verifies the on-chain burn and credits 2,500 Energy.

Burning cannot be undone. The burned droid appears in the Burned Gallery with a WASTED-style overlay. OpenSea circulating supply and media can take a few minutes to update after indexing.

## Compatibility Rules

The renderer and server validation now require every non-empty trait to have a category-correct layer. A Clothes reroll must resolve to a Clothes layer, a Hat reroll must resolve to a Hat layer, and so on. If a matching layer is missing, Trait Lab blocks the save before Energy-confirmed metadata can become live.

Trait Lab renders from the Season 2 layer registry/CID and server-generated image route. It does not use the retired public Droid Builder page or the old local builder layer URL path.

Current enforced rules include:

- Background and Droid are locked.
- Special is not user-editable.
- Special side effects may only hide wearable layers, never Background or Droid.
- Bandanna cannot combine with incompatible mouth items such as tongue, gold bar, joint, cigar, cigarette, flame, or toothpick variants.
- Approved generator compatibility checks are preserved where present.

## OpenSea Updates

After confirm, `/api/metadata/{tokenId}` serves the new metadata immediately. The site also attempts to queue an OpenSea refresh when `OPENSEA_API_KEY` is configured.

OpenSea may still cache the previous image or traits for several minutes. If metadata looks correct at `https://dyoor.netlify.app/api/metadata/{tokenId}` but OpenSea is stale, refresh the item metadata on OpenSea and wait for indexing.

## Live Metadata Base URI

The current live contract base URI should be:

```text
https://dyoor.netlify.app/api/metadata/
```

Token metadata URLs resolve like:

```text
https://dyoor.netlify.app/api/metadata/759
```
