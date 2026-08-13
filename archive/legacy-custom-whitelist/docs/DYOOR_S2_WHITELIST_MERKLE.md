# D.Y.O.O.R Season 2 Regular Whitelist

This is an internal production-readiness note. It is not a formal audit.

## Current Direction

The regular Season 2 whitelist is no longer stored as a D.Y.O.O.R contract
Merkle root. The whitelist window is reserved for OpenSea/SeaDrop so wallets can
mint directly on OpenSea if OpenSea supports custom-contract drops for the
target Monad deployment.

The D.Y.O.O.R contract still controls:

- one shared ERC721A supply capped at `3,333`
- authorized SeaDrop addresses
- SeaDrop mint enablement and route cap
- Team, Ascension, GTD, and Public direct dyoor.xyz mint routes
- owner airdrops, metadata events, royalties, treasury, and pause controls

The regular whitelist should be uploaded and configured in the OpenSea/SeaDrop
drop settings, not submitted to the D.Y.O.O.R contract as `whitelistMerkleRoot`.

## Source Of Truth

- Source file: `DYOOR_WL_Comma_Separated_Merged_Deduped.txt`
- Last expected wallet count: `12,612`
- Allowance: `3` NFTs per wallet
- Price: `350 MON` per NFT
- Chain target: Monad
- Collection max supply: `3,333`

## Adding More Wallets

If more wallets need to be added, update the whitelist source/export before the
OpenSea/SeaDrop stage is configured.

1. Merge the new wallets into the regular whitelist source/export.
2. Deduplicate case-insensitively.
3. Reject zero, dead, and malformed EVM addresses.
4. Confirm the final wallet count.
5. Preserve a source SHA-256 and canonical-address SHA-256 in deployment notes.
6. Upload the final allowlist to OpenSea/SeaDrop when configuring the whitelist stage.
7. Confirm OpenSea/SeaDrop shows `350 MON` and `3` NFTs per wallet.
8. Test one eligible wallet and one ineligible wallet on testnet, if OpenSea supports the target testnet flow.

Do not append the 12,612-plus wallets to Solidity and do not add storage writes
for the regular whitelist.

## Contract Behavior

There is intentionally no regular whitelist direct mint function:

```solidity
// Removed from the D.Y.O.O.R contract:
// whitelistMint(uint256 quantity, uint256 allowance, bytes32[] proof)
// setWhitelistMerkleRoot(bytes32 root)
// whitelistMerkleRoot()
// whitelistMinted(address wallet)
```

The `MintPhase.Whitelist` timestamp can still be configured for site display and
phase scheduling, but `mintDirect()` reverts during that window. SeaDrop mints
use `mintSeaDrop(address minter, uint256 quantity)` and count against the same
global `3,333` supply.

## OpenSea Caveat

Official OpenSea documentation describes Primary Drops through SeaDrop for EVM
chains and custom ERC721SeaDrop-compatible contracts, but the exact Monad
custom-contract onboarding path still needs manual confirmation with OpenSea.

The collection must still work through dyoor.xyz even if OpenSea custom-drop
onboarding is unavailable. If OpenSea cannot support the Monad custom-contract
drop, the fallback is to run direct dyoor.xyz phases for the non-regular-WL
routes and decide whether to add a separate direct regular whitelist route in a
future contract revision.

## Operator Checklist

1. Confirm the final regular whitelist file and count.
2. Confirm OpenSea supports the target Monad custom-contract drop flow.
3. Authorize the final SeaDrop contract address on the D.Y.O.O.R contract.
4. Enable SeaDrop minting with an explicit route cap.
5. Configure OpenSea/SeaDrop whitelist stage: `350 MON`, allowance `3`, final allowlist.
6. Confirm SeaDrop mints hit the same D.Y.O.O.R contract and shared supply.
7. Confirm dyoor.xyz direct mint console shows the whitelist window as OpenSea-managed.
8. Do not use `/admin/whitelist`; that root-manager page was removed.
