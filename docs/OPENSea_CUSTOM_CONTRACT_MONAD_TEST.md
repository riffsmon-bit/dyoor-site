# OpenSea Custom Contract Monad Test

Internal test checklist. Do not treat any outcome as verified until recorded after a fresh Monad testnet deployment.

## Preconditions

- Fresh D.Y.O.O.R Season 2 testnet contract deployed.
- Contract verified on MonadScan.
- `SEADROP_ADDRESS` confirmed as an official or explicitly approved Monad testnet SeaDrop protocol address.
- At least one controlled test mint completed, if OpenSea indexing requires a Transfer event.
- No mainnet deployment.
- No real 610-NFT airdrop.
- No metadata freeze.

## Owner Checklist

1. Connect the deployer/owner wallet to OpenSea.
2. Open OpenSea Studio.
3. Confirm whether Monad testnet/mainnet network selection is available.
4. Search for the deployed D.Y.O.O.R contract address.
5. Check whether the collection indexes as a normal NFT collection.
6. Check whether collection settings are editable by the owner wallet.
7. Check whether Drop schedule configuration is available.
8. Check whether a custom or existing contract attachment option appears.
9. Check whether presale stages can be created.
10. Check whether wallet lists can be uploaded.
11. Check whether per-wallet limits can be configured.
12. Check whether public-stage settings can be configured.
13. Check whether SeaDrop fee recipients or payout recipients can be configured.
14. Check whether token metadata settings are visible.
15. Check whether creator earnings can be configured.
16. Capture screenshots of available controls without exposing secrets.
17. Stop before publishing a real drop.

## Wallet List Upload Files

Use the export helper:

```bash
npm run export:opensea-wallet-list -- --input DYOOR_WL_Comma_Separated_Merged_Deduped_v3.txt --stage regular-wl --limit 3
```

Confirm which output OpenSea accepts:

- `wallet-list-exports/opensea/regular-wl-addresses.csv`
- `wallet-list-exports/opensea/regular-wl-with-limit.csv`

Do not assume OpenSea accepts a comma-separated single-line source file.

## Possible Outcomes

A. Custom contract can be fully attached and configured through OpenSea UI.

B. Contract indexes as a collection but cannot be configured as a Drop.

C. OpenSea requires manual creator-support onboarding.

D. Monad custom SeaDrop contracts are not currently supported.

E. Result is inconclusive.

## Result Log

Fill this after the test:

```text
Date:
Tester wallet:
Contract address:
Chain:
SeaDrop address:
Mint tx:
OpenSea collection URL:
OpenSea Drop URL:
Outcome: A / B / C / D / E
Controls available:
Controls unavailable:
Screenshots captured:
Manual OpenSea support needed:
Notes:
```

Indexing for secondary trading is not proof that primary Drop configuration works.
