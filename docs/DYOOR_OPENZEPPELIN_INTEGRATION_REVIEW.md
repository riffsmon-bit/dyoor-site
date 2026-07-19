# D.Y.O.O.R Season 2 OpenZeppelin And SeaDrop Integration Review

Internal production-readiness review. This is not a formal audit.

Review date: 2026-07-13

## Versions

- D.Y.O.O.R contract compiler: Solidity `0.8.17`
- Foundry optimizer: enabled, `1` run
- Vendored SeaDrop package: `1.0.0`
- Vendored SeaDrop commit: `8b4792f7067c8d99d2d20026eeac9f80f5c5dfeb`
- Foundry OpenZeppelin remapping: `lib/seadrop/lib/openzeppelin-contracts`, package version `4.7.0`
- Root npm OpenZeppelin package: `@openzeppelin/contracts@5.6.1`

The Season 2 SeaDrop contract compiles through Foundry remappings against the vendored SeaDrop/OpenZeppelin v4 stack. OpenZeppelin v5 transfer-hook assumptions must not be applied to this contract.

## Inheritance Tree

```text
DYOORSeason2SeaDrop
  ERC721SeaDrop
    ERC721ContractMetadata
      ERC721AConduitPreapproved
      ERC721TransferValidator
      TwoStepOwnable
      ISeaDropTokenContractMetadata
    INonFungibleSeaDropToken
    ERC721SeaDropStructsErrorsAndEvents
    ReentrancyGuard
```

## Inherited Behavior Used

- ERC721A sequential minting starting at token ID `1`
- ERC721A `totalSupply`, `_totalMinted`, `_numberMinted`, `_safeMint`, `_burn`
- SeaDrop configuration hooks:
  - `updatePublicDrop`
  - `updateAllowList`
  - `updateTokenGatedDrop`
  - `updateDropURI`
  - `updateCreatorPayoutAddress`
  - `updateAllowedFeeRecipient`
  - `updateSignedMintValidationParams`
  - `updatePayer`
- Two-step ownership through `transferOwnership`, `acceptOwnership`, and `cancelOwnershipTransfer`
- ERC-2981 royalty reporting through `royaltyInfo`
- ERC-4906 interface support through SeaDrop metadata base

## D.Y.O.O.R Overrides

### `mintSeaDrop(address,uint256)`

Reason:

- Enforce local mint pause.
- Enforce authorized SeaDrop caller.
- Reject zero recipient and zero quantity.
- Permanently cap SeaDrop paid mints at `2723`.
- Keep total minted under `3333`.
- Update `totalSeaDropMinted` before `_safeMint`.

Compatibility note:

OpenSea's docs warn custom contracts should avoid modifying minting functionality for the smoothest OpenSea Drop experience. D.Y.O.O.R intentionally keeps this override minimal because protecting the 610-token reserve must not depend only on OpenSea UI configuration.

### `setBaseURI(string)`

Reason:

- Preserve mutable metadata for rerolls.
- Respect `metadataFrozen` if explicitly triggered later.
- Emit `BatchMetadataUpdate` when tokens already exist.

### `setContractURI(string)`

Reason:

- Preserve mutable collection metadata unless frozen.

### `emitBatchMetadataUpdate(uint256,uint256)`

Reason:

- Allow owner or metadata manager to emit validated ERC-4906 batch refreshes.
- Reject ranges outside minted tokens.

### `setMaxSupply(uint256)`

Reason:

- Permanently lock supply to `3333`.
- Reject any owner or self attempt to change the cap.

### `setProvenanceHash(bytes32)`

Reason:

- Preserve SeaDrop metadata API while blocking changes after mint start and respecting metadata freeze.

### `setRoyaltyInfo(RoyaltyInfo)`

Reason:

- Enforce D.Y.O.O.R owner/self authorization and nonzero receiver.

### `updateAllowedSeaDrop(address[])`

Reason:

- Reject zero addresses before updating SeaDrop authorization.
- Retain official SeaDrop authorization event from inherited implementation.

### `renounceOwnership()`

Reason:

- Reverts permanently. This project should not renounce operational ownership because metadata, reroll events, airdrops, royalties, treasury, and SeaDrop authorization remain active responsibilities.

## Custom Additions

- `MAX_SUPPLY = 3333`
- `AIRDROP_RESERVE = 610`
- `SEADROP_MAX_SUPPLY = 2723`
- `totalSeaDropMinted`
- `totalAirdropped`
- owner batch airdrops with `batchId` duplicate protection
- treasury withdrawal for funds held directly by the NFT contract
- metadata manager for ERC-4906 event emission only
- pause controls that stop mint creation without blocking transfers

## Version-Compatibility Findings

- The contract uses SeaDrop's ERC721A/OZ v4 inheritance tree, not OpenZeppelin v5 `_update` hooks.
- `nonReentrant` comes from SeaDrop's vendored Solmate dependency.
- ERC721A burn support remains inherited from SeaDrop.
- ERC-2981 is implemented through SeaDrop's metadata contract, not npm OpenZeppelin v5 `ERC2981`.
- `supportsInterface` is inherited from SeaDrop's metadata base and reports ERC-721, ERC-721 metadata, ERC-2981, Creator Token interfaces, and ERC-4906.

## Custom-Code Risks

- The `mintSeaDrop` override must be tested against real SeaDrop public and allowlist mint flows on Monad testnet.
- `getMintStats` still reports collection max supply `3333` because it is inherited; the local `mintSeaDrop` override enforces the lower SeaDrop cap `2723`.
- The real OpenSea Studio custom-contract attachment path on Monad remains unverified.
- If OpenSea requires an unmodified `mintSeaDrop`, the reserve-protection override could require manual OpenSea support review.

## Remaining Audit Recommendations

- Perform a third-party Solidity review before mainnet.
- Run the controlled Monad testnet OpenSea attachment experiment.
- Confirm the official Monad SeaDrop address with OpenSea or Monad before deployment.
- Confirm OpenSea creator earnings and SeaDrop payout behavior for Monad.
- Keep the owner as a multisig or dedicated hardware-secured wallet for mainnet.
