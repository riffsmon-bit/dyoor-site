# D.Y.O.O.R Season 2 OpenSea / SeaDrop Onboarding Checklist

Internal checklist. Do not claim OpenSea primary minting is live until the Monad custom-contract path is manually verified.

Detailed test log template: `docs/OPENSea_CUSTOM_CONTRACT_MONAD_TEST.md`

## Current Technical Position

- The production-intended contract remains a custom `DYOORSeason2SeaDrop` contract owned by D.Y.O.O.R.
- It inherits OpenSea SeaDrop-compatible token behavior.
- `mintSeaDrop(address,uint256)` can only be called by explicitly allowed SeaDrop contracts.
- D.Y.O.O.R custom direct paid mint functions have been removed.
- OpenSea/SeaDrop should manage paid mint stages, wallet lists, prices, and per-wallet limits where supported.
- The NFT contract enforces `MAX_SUPPLY = 3333`.
- The NFT contract enforces `SEADROP_MAX_SUPPLY = 2723`.
- The NFT contract enforces `AIRDROP_RESERVE = 610`.
- dyoor.xyz remains responsible for dynamic metadata, rerolls, ownership checks, admin airdrops, and operational tooling.

## Manual OpenSea Unknowns

Confirm these directly with OpenSea before representing that OpenSea minting is live:

- Whether OpenSea supports onboarding this custom Monad contract for primary drops.
- The approved SeaDrop contract address for Monad testnet and mainnet.
- The exact creator onboarding flow for a custom already-deployed contract.
- Whether any OpenSea UI step attaches an existing manually deployed contract.
- Whether presale wallet lists can be uploaded for this custom contract.
- How proceeds are routed for Monad SeaDrop mints.
- Whether OpenSea reads `contractURI()` from IPFS, HTTP, or both.
- How OpenSea refreshes ERC-4906 metadata events on Monad.

## Testnet Steps

1. Deploy a fresh D.Y.O.O.R Season 2 contract to Monad testnet.
2. Verify source on MonadScan.
3. Confirm `allowedSeaDrops()` contains only the intended testnet SeaDrop address.
4. Configure a tiny OpenSea/SeaDrop public stage if OpenSea UI supports it.
5. Keep the test stage supply at `<= 5` and wallet limit at `1`.
6. Mint one test NFT through OpenSea/SeaDrop or the supported local SeaDrop public-mint helper.
7. Confirm `totalSupply()` and `totalSeaDropMinted()` increment.
8. Confirm `tokenURI()` resolves to the dynamic metadata endpoint.
9. Confirm `pause()` blocks another SeaDrop mint.
10. Confirm normal NFT transfer still works while minting is paused.
11. Record outcome in `docs/OPENSea_CUSTOM_CONTRACT_MONAD_TEST.md`.

## Wallet Lists

Generate OpenSea-compatible exports:

```bash
npm run export:opensea-wallet-list -- --input DYOOR_WL_Comma_Separated_Merged_Deduped_v3.txt --stage regular-wl --limit 3
```

Do not assume OpenSea accepts a single comma-separated source line. Confirm UI format before upload.

## If OpenSea Primary Drop Onboarding Is Unavailable

The contract remains usable for:

- Owner airdrops
- Mutable metadata
- Trait rerolls through dyoor.xyz metadata/API systems
- ERC-4906 metadata refresh
- ERC-2981 royalty reporting
- Secondary marketplace trading after indexing

Paid primary minting would need a new owner-approved plan if OpenSea cannot attach/configure the custom SeaDrop contract on Monad.
