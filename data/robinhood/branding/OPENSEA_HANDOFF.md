# HoodYØØR OpenSea branding handoff

This package is ready for the OpenSea collection page once the Robinhood Chain
contract address exists. Every image now uses the refined HoodYØØR pixel collection
identity: crisp fine-grained pixels, the approved Droid proportions and complete
facial trait stacks with a visible mouth unless a deliberate face covering is worn.

## Upload map

| OpenSea field | Asset |
| --- | --- |
| Desktop page header | `opensea/opensea-banner-desktop.png` |
| Mobile page header | `opensea/opensea-banner-mobile.png` |
| Banner logo / collection profile | `opensea/opensea-banner-logo.png` |
| Overview background | `opensea/opensea-overview-background.png` |
| Collection-art preview | `opensea/opensea-pixel-art-preview.png` |
| Social/share card | `opensea/opensea-social-share.png` |

Use `opensea-collection-details.json` for the final copy, links, royalty disclosure,
and launch facts. Add the deployed collection address only after verifying its
runtime bytecode and constructor configuration on chain 4663.

## Rebuild and verify

```bash
npm run build:robinhood:opensea-branding
node --test test/robinhood-opensea-branding.test.js
```

`opensea/opensea-branding-manifest.json` records every output dimension, byte size,
logical pixel grid, source asset, and SHA-256 hash. The source masters were created
with built-in image generation, and the exact prompt set is recorded in
`PIXEL_OPENSEA_IMAGEGEN_PROMPTS.md`. Exports use integer nearest-neighbor scaling so
the marketplace receives hard pixel edges rather than blurred resizes.

## Publishing boundary

OpenSea publishing requires a wallet-authenticated Studio session and the deployed
contract. Do not publish a collection page with an unverified address or language
that implies affiliation with Robinhood Markets, Inc.
