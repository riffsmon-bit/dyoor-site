# D.Y.O.O.R SeaDrop Final Production Review

Internal production-readiness review. This is not a formal audit.

Review date: 2026-07-13

## Final Inheritance Tree

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

## Final Mint Routes

- Authorized SeaDrop mint: `mintSeaDrop(address minter, uint256 quantity)`
- Owner airdrop: `airdrop(address[] recipients, uint256[] quantities, bytes32 batchId)`
- Owner indexed batch airdrop: `airdropBatch(bytes32 batchId, uint256 batchIndex, address[] recipients, uint256[] quantities)`

## Removed Mint Routes

The D.Y.O.O.R custom paid mint system was removed:

- `mintDirect`
- `teamMint`
- `ascensionMint`
- `gtdMint`
- `publicMint`
- custom phase timestamp setters
- custom phase price setters
- custom Merkle root setters
- custom Merkle proof validation
- frontend proof lookup and direct mint transaction building

## Remaining SeaDrop Allowlist Functionality

SeaDrop native allowlist/presale functionality remains available through the inherited SeaDrop configuration interface, including `updateAllowList`. SeaDrop may use Merkle roots internally; that is expected and is separate from the removed D.Y.O.O.R custom Merkle system.

## Supply Accounting

```text
MAX_SUPPLY = 3333
AIRDROP_RESERVE = 610
SEADROP_MAX_SUPPLY = 2723
```

`mintSeaDrop` increments `totalSeaDropMinted` before `_safeMint` and rejects any SeaDrop mint that would exceed `2723`.

The airdrop route increments `totalAirdropped` before minting and rejects any airdrop that would exceed `610`.

All mint routes still enforce the global `3333` max supply.

## Access Control

Owner controls:

- update authorized SeaDrop addresses
- execute airdrops
- pause/unpause mint creation
- pause/unpause airdrops
- update treasury
- update royalties
- update base URI
- update contract URI
- set metadata manager
- emit ERC-4906 refreshes
- withdraw funds held by the NFT contract

Metadata manager controls:

- `emitMetadataUpdate`
- `emitBatchMetadataUpdate`

Metadata manager cannot mint, airdrop, withdraw, update treasury, update royalties, change SeaDrop authorization, or transfer ownership.

`renounceOwnership` reverts.

## Pause Behavior

Global mint pause blocks:

- SeaDrop mints
- owner airdrops

Airdrop-specific pause blocks:

- owner airdrops only

Normal ERC-721 transfers remain available while minting is paused.

## Metadata Mutability

Metadata remains mutable for rerolls:

- base URI can be updated by owner/self unless metadata has been explicitly frozen
- contract URI can be updated by owner/self unless frozen
- ERC-4906 `MetadataUpdate(tokenId)` and `BatchMetadataUpdate(from,to)` are supported

`freezeMetadata()` without the exact confirmation phrase always reverts. The review did not call freeze.

## Royalty Behavior

ERC-2981 royalty reporting remains inherited through SeaDrop metadata support. Royalty receiver must be nonzero and royalty basis points must be `<= 10000`.

Marketplace royalty enforcement may vary. ERC-2981 only reports royalty information.

## Primary Payout Behavior

Primary SeaDrop mint proceeds are expected to follow SeaDrop/OpenSea payout configuration. This must be verified on Monad testnet with the confirmed SeaDrop protocol address.

The NFT contract still has `withdrawTreasury` for funds directly or accidentally held by the NFT contract.

## OpenZeppelin And SeaDrop Version Review

See `docs/DYOOR_OPENZEPPELIN_INTEGRATION_REVIEW.md`.

Key point: Foundry compiles the SeaDrop contract against vendored SeaDrop/OpenZeppelin v4 dependencies, not the root npm OpenZeppelin v5 package.

## Static Analysis

Slither is not installed locally, so no Slither report was generated.

`forge build --sizes` emitted Foundry lint notes for older unrelated contracts:

- unaliased imports in `DyoorDroids`, `DYOOREnergyBank`, `DyoorTraits`, and `DyoorTraitManager`
- naming notes in older contracts
- two unsafe typecast warnings in `DYOOREnergyBank`

No new Foundry lint warnings were reported for `DYOORSeason2SeaDrop.sol` beyond compiler mutability suggestions for reverting functions.

## Test Results

Solidity:

```text
forge test --offline
36 passed; 0 failed; 0 skipped
```

Fuzz tests included:

- `testFuzzSeaDropQuantity`
- `testFuzzAirdropQuantity`

Invariant tests included:

- `invariant_totalSupplyNeverExceedsMax`
- `invariant_seaDropNeverConsumesReserve`
- `invariant_airdropNeverExceedsReserve`
- `invariant_combinedRoutesNeverExceedMax`

The invariant harness ran with 256 runs and 128000 calls per invariant.

Node tests:

```text
node --test test/*.test.js
32 passed; 0 failed; 1 skipped
```

Skipped Node test:

- finalized airdrop CSV totals check, because `dyoor-s2-ascended-airdrop-with-treasury.csv` is not present in this checkout

`npm test` status:

- blocked before tests by Hardhat compiler-cache mutex:
  `MultiProcessMutexTimeoutError: Timed out waiting to acquire lock at /Users/brandonduke/Library/Caches/hardhat-nodejs/compilers-v3/compiler-download-list`

Frontend:

```text
npm run typecheck
npm run lint
npm run check
npm run build
```

All passed. `npm run build` emitted a Turbopack trace warning for `app/dyoor-builder/layers/[...path]`, unrelated to the SeaDrop refactor.

## Coverage

Command:

```bash
forge coverage --offline --report summary
```

`DYOORSeason2SeaDrop.sol`:

- Lines: `82.08%`
- Statements: `83.78%`
- Branches: `69.70%`
- Functions: `82.93%`

Total repo coverage is lower because unrelated contracts are included in the report.

## Gas And Bytecode

Command:

```bash
forge test --offline --gas-report
forge build --sizes
```

`DYOORSeason2SeaDrop`:

- Deployment cost: `4,836,642`
- Gas-report deployment size: `22,915`
- Runtime bytecode size: `20,852 bytes`
- Runtime margin: `3,724 bytes`
- Initcode size: `22,627 bytes`

Gas concern:

- Full reserve/cap boundary tests mint thousands of tokens and are expensive in tests, but production SeaDrop/OpenSea stage mints should use smaller user quantities.
- Airdrop batches should continue using gas-safe batches and simulation before execution.

## OpenSea Onboarding Uncertainty

OpenSea documentation supports custom SeaDrop-compatible contracts and OpenSea primary drops, but the manually deployed Monad custom-contract attachment path still must be verified.

Checklist: `docs/OPENSea_CUSTOM_CONTRACT_MONAD_TEST.md`

## Explicit Answers

- Can SeaDrop consume the 610 reserved NFTs? No. `totalSeaDropMinted` is capped at `2723`.
- Can total supply exceed `3333`? Tests prove the exposed mint routes cannot exceed `3333`.
- Can unauthorized callers mint? Unauthorized SeaDrop callers and non-owner airdrops revert.
- Can the metadata manager mint? No. Tests cover metadata-manager mint/airdrop denial.
- Can minting be stopped without freezing transfers? Yes. Pause blocks mint creation and normal transfers remain available.
- Can metadata remain dynamic after mint? Yes. Mutable base URI and ERC-4906 events remain.
- Are all custom Merkle functions gone? Yes from the Season 2 NFT contract and runtime website mint flow.
- Does SeaDrop's own presale functionality remain intact? Yes. The inherited SeaDrop `updateAllowList` and other configuration functions remain.
- Is a new testnet deployment required? Yes. The reference testnet contract is not upgradeable and bytecode changed.
- Is the contract ready for a controlled OpenSea attachment experiment? It is ready for a controlled Monad testnet deployment and experiment after the owner confirms the official Monad testnet SeaDrop address.

## Mainnet Blockers

- Confirm official Monad testnet SeaDrop address.
- Deploy fresh testnet contract.
- Verify on MonadScan.
- Run testnet validation script.
- Perform one controlled test mint only after owner approval.
- Confirm OpenSea custom-contract attachment/import behavior on Monad.
- Export/upload wallet lists through OpenSea/SeaDrop and record checksums.
- Independent Solidity review.
- Final owner wallet/multisig, treasury, royalty receiver, royalty percentage, contract URI, and OpenSea drop settings.

Do not deploy to Monad mainnet until these are complete.
