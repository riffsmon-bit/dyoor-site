# D.Y.O.O.R Season 2 SeaDrop Refactor Initial Audit

Internal production-readiness review. This is not a formal audit.

Review date: 2026-07-13

Reference Monad testnet contract: `0xcE586aA467F6351bf819DbF134BC69947125CD92`

## Current Contract Architecture

Primary Season 2 contract:

- `contracts/DYOORSeason2SeaDrop.sol`
- Solidity `0.8.17`
- Extends the vendored OpenSea `ERC721SeaDrop`
- Constructor takes `name`, `symbol`, and `allowedSeaDrop` addresses
- Uses ERC721A token IDs starting at `1`
- Sets `_maxSupply` to `3,333`
- Is not upgradeable: there is no proxy, initializer, UUPS, beacon, or transparent proxy pattern in the contract

Current inheritance tree:

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

Dependency versions found locally:

- Vendored SeaDrop: `lib/seadrop`, package version `1.0.0`, commit `8b4792f7067c8d99d2d20026eeac9f80f5c5dfeb`
- Foundry OpenZeppelin remapping: `lib/seadrop/lib/openzeppelin-contracts`, version `4.7.0`
- Root npm OpenZeppelin package: `@openzeppelin/contracts` version `5.6.1`

The Season 2 Solidity contract compiles through Foundry remappings against the vendored SeaDrop/OpenZeppelin v4 stack, not the npm OpenZeppelin v5 package.

## Current Custom Allowlist Implementation

The contract currently contains a parallel D.Y.O.O.R direct-mint allowlist system:

- `enum MintPhase`
- `struct DirectPhaseConfig`
- `_phaseConfigs`
- `directMintedByPhase`
- `allowlistLeaf(address)`
- `MerkleProof` import
- `setPhaseStartTimes`
- `setPhaseConfig`
- `updatePrices`
- `updateMerkleRoots`
- `activePhase`
- `phaseConfig`
- `mintDirect`
- `teamMint`
- `ascensionMint`
- `gtdMint`
- `publicMint`

The current leaf formula is:

```solidity
keccak256(abi.encodePacked(wallet))
```

The regular whitelist phase has been partially moved toward OpenSea because `mintDirect` rejects `MintPhase.Whitelist`, but the contract still stores a Whitelist phase config and the frontend still reads it.

Legacy whitelist/proof files found:

- `scripts/generate-whitelist-merkle.js`
- `scripts/regular-whitelist-merkle-lib.js`
- `scripts/verify-whitelist-merkle.js`
- `test/regular-whitelist-merkle.test.js`
- `docs/DYOOR_S2_WHITELIST_MERKLE.md`
- Empty route directories: `app/admin/whitelist`, `app/api/whitelist-proof`

The latest master whitelist source file named by the owner, `DYOOR_WL_Comma_Separated_Merged_Deduped_v3.txt`, was not present in this checkout during this review. It must not be deleted if added later; it should be preserved for OpenSea presale upload/export workflows.

## Current SeaDrop Implementation

The contract extends OpenSea's `ERC721SeaDrop` and exposes native SeaDrop configuration hooks inherited from the official interface:

- `updatePublicDrop`
- `updateAllowList`
- `updateTokenGatedDrop`
- `updateDropURI`
- `updateCreatorPayoutAddress`
- `updateAllowedFeeRecipient`
- `updateSignedMintValidationParams`
- `updatePayer`
- `getMintStats`
- `updateAllowedSeaDrop`

The D.Y.O.O.R contract currently overrides `mintSeaDrop` to add:

- Local pause check
- Explicit `seaDropMintingEnabled`
- Authorized SeaDrop check
- Route cap through `seaDropMintCap`
- Optional route-level wallet cap through `seaDropWalletLimit`
- `totalSeaDropMinted` accounting

OpenSea documentation says SeaDrop supports public drops, Merkle allowlists, server-signed mints, and token-gated drops, and that custom contracts can extend `ERC721SeaDrop`. The same docs caution that projects should not modify minting functionality when they want the smoothest OpenSea drop experience. D.Y.O.O.R still needs a narrow local override because the 610-token reserve must not depend only on OpenSea UI configuration.

## Duplicate Or Competing Mint Systems

The current contract has two paid mint authorities:

- D.Y.O.O.R direct phase mints
- SeaDrop mints

This creates duplicated configuration for:

- Phase schedules
- Prices
- Allowlist proofs
- Wallet limits
- Public mint windows

The current website test client still supports direct team, ascension, GTD, public, and active-phase mints. It also contains proof parsing and wallet leaf calculation for the old D.Y.O.O.R Merkle system.

## Findings

### High: Competing allowlist and paid mint systems

The contract and website still include D.Y.O.O.R-specific Merkle/direct paid mint paths while the intended production model is SeaDrop-managed presales and public drops. This can confuse operators and increases the chance that prices, schedules, wallet limits, or proofs diverge between OpenSea and dyoor.xyz.

### High: SeaDrop reserve protection is configurable instead of permanent

The current `seaDropMintCap` is owner-configurable and can be set up to `MAX_SUPPLY`. The 610-token airdrop reserve is not permanently enforced by a contract constant. A misconfiguration could allow SeaDrop to consume supply intended for the holder/treasury airdrop.

### High: Airdrop route does not enforce the 610 reserved allocation

The current airdrop route enforces the global `3,333` max supply but does not enforce `totalAirdropped <= 610`. If the production policy is that only the 610 reserved allocation should be airdropped, that invariant is currently missing.

### Medium: Airdrops are not blocked by global mint pause

`mintPaused` blocks direct and SeaDrop mints, while airdrops are controlled by `airdropPaused` only. The requested design is to stop mint creation with pause unless a separate exception is deliberately implemented and documented.

### Medium: OpenSea compatibility depends on a modified `mintSeaDrop`

Reserve enforcement requires a local `mintSeaDrop` override. That override should be kept minimal, documented, and tested because OpenSea's SeaDrop docs warn against altering minting behavior for best OpenSea mint compatibility.

### Medium: Deployment script guesses a SeaDrop address

The deployment script currently defaults to a documented Ethereum SeaDrop address if `SEADROP_ADDRESS` is missing. For Monad, the script must not guess a SeaDrop protocol address. It must require a chain-specific configured address with deployed bytecode and documented owner approval.

### Medium: Testnet deployment is required

The reference deployed Monad testnet contract is not upgradeable. Removing custom mint routes and adding permanent reserve enforcement changes bytecode, so the existing deployment cannot be patched.

### Low: Root OpenZeppelin package differs from Solidity remapping

The repo has npm `@openzeppelin/contracts@5.6.1`, but the Season 2 contract compiles against vendored SeaDrop dependencies using OpenZeppelin `4.7.0`. This is acceptable if documented, but mixing assumptions from v5 into this contract would be unsafe.

### Informational: SeaDrop's native allowlist support remains desirable

Removing D.Y.O.O.R's custom Merkle roots must not remove SeaDrop's own `updateAllowList` support. SeaDrop may internally use Merkle roots or signed mint parameters. That is expected and should remain intact.

### Informational: OpenSea attachment remains an experiment

OpenSea docs describe manual SeaDrop-compatible contract deployment and OpenSea primary drops, but the practical Monad custom-contract attachment/import path must be verified after a fresh testnet deployment. Indexing as a collection does not prove primary Drop configuration works.

## Proposed Refactor Plan

1. Remove D.Y.O.O.R custom Merkle/direct paid mint code from `DYOORSeason2SeaDrop`.
2. Preserve native SeaDrop configuration functions inherited from `ERC721SeaDrop`, including `updateAllowList`.
3. Replace configurable SeaDrop paid-mint cap with constants:
   - `MAX_SUPPLY = 3333`
   - `AIRDROP_RESERVE = 610`
   - `SEADROP_MAX_SUPPLY = 2723`
4. Keep a minimal `mintSeaDrop` override for:
   - Authorized SeaDrop-only access
   - Local pause
   - Nonzero minter/quantity
   - `totalSeaDropMinted <= 2723`
   - `totalMinted <= 3333`
5. Enforce `totalAirdropped <= 610` in the owner airdrop route.
6. Block airdrops when global mint pause is enabled unless a future owner decision creates a deliberate exception.
7. Preserve:
   - Two-step ownership
   - Metadata mutability
   - ERC-4906 events
   - ERC-2981 royalties
   - Treasury withdrawal for accidental/direct funds
   - `renounceOwnership` override
8. Update frontend/admin/runtime ABI to remove direct custom mint/proof usage.
9. Archive obsolete D.Y.O.O.R custom whitelist generation files without deleting historical wallet source files.
10. Update deployment, verification, validation, and test-mint scripts to require explicit Monad testnet configuration and no guessed SeaDrop address.
11. Rewrite tests around final mint routes: SeaDrop and owner airdrop only.
12. Generate final OpenZeppelin/SeaDrop integration review and final internal production-readiness review.

