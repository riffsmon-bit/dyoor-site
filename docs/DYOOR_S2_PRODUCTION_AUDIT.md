# D.Y.O.O.R S2 Production-Readiness Review

> Superseded for the current SeaDrop-first refactor by
> `docs/DYOOR_SEADROP_REFACTOR_INITIAL_AUDIT.md`,
> `docs/DYOOR_OPENZEPPELIN_INTEGRATION_REVIEW.md`, and
> `docs/DYOOR_SEADROP_FINAL_PRODUCTION_REVIEW.md`.
> This older document reflects the previous direct-mint/Merkle production pass
> and should not be used as the current launch checklist.

Status: initial internal production-readiness review, not a formal audit.

Review date: 2026-07-12

Reference testnet contract: `0xcE586aA467F6351bf819DbF134BC69947125CD92`

## 1. Existing Architecture Summary

The repository currently has two Season 2 NFT contract architectures:

- `contracts/DYOORSeason2SeaDrop.sol`: the active custom ERC721A/SeaDrop-compatible contract intended for the dyoor.xyz direct mint path and optional OpenSea/SeaDrop mint path.
- `contracts/DyoorDroids.sol`, `contracts/DyoorTraits.sol`, and `contracts/DyoorTraitManager.sol`: an older or parallel ERC721/ERC1155 trait-item architecture. It has a 3,333 cap and `DYOOR` symbol, but it is not the active SeaDrop-compatible collection contract.

The website already has dynamic metadata at `/api/metadata/[tokenId]`, backed by local files, remote Pinata metadata, Netlify Blobs, and runtime trait overrides in the `dyoor-s2-metadata` store.

The hidden `/s2-mint-test` page tests the current direct mint functions on Monad testnet. It is gated by `NEXT_PUBLIC_ENABLE_S2_MINT_TEST=true`.

## 2. Contract Inheritance Tree

`DYOORSeason2SeaDrop` inherits:

```text
DYOORSeason2SeaDrop
  -> ERC721SeaDrop
    -> ERC721ContractMetadata
      -> ERC721AConduitPreapproved
      -> ERC721TransferValidator
      -> TwoStepOwnable
```

Important inherited behavior:

- ERC721A token IDs start at `1` via SeaDrop.
- `getMintStats(address)` returns `_numberMinted(minter)`, `_totalMinted()`, and `_maxSupply`.
- `TwoStepOwnable` provides `transferOwnership`, `acceptOwnership`, and `cancelOwnershipTransfer`.
- `TwoStepOwnable` also exposes `renounceOwnership`; the D.Y.O.O.R contract overrides it to revert.
- ERC-2981 royalty support is inherited from `ERC721ContractMetadata`.
- ERC-4906 interface support and `BatchMetadataUpdate` support are inherited.

## 3. Mint Routes

Current `DYOORSeason2SeaDrop` routes:

- `teamMint(uint256, bytes32[])`
- `ascensionMint(uint256, bytes32[])`
- `gtdMint(uint256, bytes32[])`
- `publicMint(uint256)`
- `mintDirect(uint256, bytes32[])`, which uses `activePhase()`
- `mintSeaDrop(address,uint256)`, callable only by allowed SeaDrop addresses
- `airdrop(address[],uint256[],bytes32)` / `airdropBatch(bytes32,uint256,address[],uint256[])`, callable only by owner

Regular whitelist note:

- The regular whitelist is intentionally not a direct D.Y.O.O.R contract mint route in the current OpenSea-oriented design. `MintPhase.Whitelist` is reserved for OpenSea/SeaDrop configuration so users can mint directly on OpenSea if Monad custom-contract drops are supported.

## 4. Administrative Roles

The SeaDrop-compatible NFT contract currently uses Owner-only administration. There is no separate metadata manager role, airdrop role, or emergency role.

Owner-controlled functions include:

- mint pause/unpause
- treasury update
- phase config, starts, prices, and Merkle roots
- base URI and contract URI
- metadata freeze
- provenance hash
- royalty receiver and bps
- withdrawals
- allowed SeaDrop updates through inherited SeaDrop functions
- external system address registry

The admin website uses owner-wallet signatures through `lib/adminAuth.ts`, but the current message format only includes action, wallet, timestamp, and nonce. It does not yet include chain ID or contract address.

## 5. Global Supply Logic

Resolved in this branch: `contracts/DYOORSeason2SeaDrop.sol` now sets:

```solidity
uint256 public constant MAX_SUPPLY = 3_333;
```

Production requirement is exactly `3,333`.

The contract uses ERC721A `_totalMinted()` for global supply accounting and enforces the cap in direct mint, SeaDrop mint, and airdrop paths. `setMaxSupply` is overridden to reject values other than `MAX_SUPPLY`.

The reference testnet deployment predates these production-readiness edits, so a fresh testnet deployment is required before relying on the new bytecode.

## 6. SeaDrop Integration

The current contract preserves the SeaDrop mint entrypoint and authorized SeaDrop mapping. `mintSeaDrop` checks:

- `mintPaused == false`
- `msg.sender` is an allowed SeaDrop address
- `_totalMinted() + quantity <= maxSupply()`

The vendored OpenSea SeaDrop docs state that custom token creators can inherit `ERC721SeaDrop`, and that `getMintStats()` should not be overridden incompatibly because SeaDrop uses it for wallet-limit accounting.

OpenSea/SeaDrop reference sources checked:

- https://github.com/ProjectOpenSea/seadrop
- https://github.com/ProjectOpenSea/seadrop/blob/main/docs/BringYourOwnTokenContract.md
- https://github.com/ProjectOpenSea/seadrop/blob/main/docs/SeaDropTokenDeployment.md

Monad/OpenSea custom drop onboarding remains unconfirmed. The repository's own `docs/DYOOR_SEADROP_SETUP.md` already warns that Monad SeaDrop support must be verified manually.

## 7. SeaDrop Versus Direct Mint Accounting

Direct wallet limits currently use `_numberMinted(msg.sender) + quantity`, not only direct mint counts. SeaDrop also reads `_numberMinted(minter)` through `getMintStats`.

This is good for a shared per-wallet cap when both routes are configured to the same cap.

Remaining risk:

- The D.Y.O.O.R contract does not enforce SeaDrop phase prices, timestamps, or per-stage limits internally.
- SeaDrop must be configured with matching `maxTotalMintableByWallet`, stage timing, stage supply cap, and price.
- If SeaDrop public or allowlist stages are configured with looser limits than the direct contract, users may mint more through SeaDrop than intended even though they cannot exceed global supply.

Current direct/SeaDrop global supply bypass risk:

- Total supply bypass: not currently seen in code, because both paths use `_totalMinted()` and `_maxSupply`.
- Per-wallet bypass: prevented only when SeaDrop stage wallet limits are configured correctly, because SeaDrop relies on `getMintStats`.
- Per-phase allocation bypass: not enforced by the D.Y.O.O.R contract for SeaDrop. Needs a design decision or stricter route caps.

## 8. Airdrop Architecture

NFT airdrop support is not present in `DYOORSeason2SeaDrop`.

Existing airdrop tooling only covers `DYOOREnergyBank` Energy credits. The existing admin page has Energy airdrop UI, but no Season 2 NFT airdrop manager.

Required work:

- Add `airdrop(address[] recipients, uint256[] quantities)`.
- Track total airdropped supply.
- Emit `AirdropBatchExecuted`.
- Add CSV parsing, validation, deterministic batch IDs, simulation, resume state, and connected-owner-wallet transaction execution.

## 9. Metadata Architecture

Contract metadata:

- `tokenURI` comes from SeaDrop: if base URI ends in `/`, it returns `baseURI + tokenId`.
- If base URI does not end in `/`, every token returns the same URI.

Dynamic site metadata:

- `/api/metadata/[tokenId]` loads runtime config, base metadata, remote metadata, Netlify Blob overrides, and can render reroll images.
- Blob store: `dyoor-s2-metadata`
- Uploaded base key: `metadata/{tokenId}.json`
- Overrides key: `overrides.json`

Local generator metadata checked at:

```text
/Volumes/DYOOR Hard Drive/dyoor-generator-local 3/output/metadata
```

Findings:

- 3,333 extensionless files exist.
- Files `1`, `2`, and `3333` exist.
- No `1.json`, `2.json`, or `3333.json` files were found in that folder.
- Therefore a static IPFS metadata base URI for this archive should resolve as `ipfs://CID/1`, not `ipfs://CID/1.json`.
- All 3,333 local metadata files parse as JSON.
- All 3,333 local final images exist as `{tokenId}.png`.
- All 3,333 local metadata files still use `ipfs://REPLACE_ME/{tokenId}.png`, not the production image CID.

The production prompt gives:

```text
Image CID:    bafybeifz4gwsvqbypeki3wwwmmvng2z2lusqjndevfqemzibisk266vepq
Metadata CID: bafybeidz7htb3digthznwvl4ytdpckq2q3d2ytgxtsie5bcp7a4lgtb2sq
```

The repo `.env.example` and `lib/dyoor-s2-metadata.js` currently point to older S2 CIDs. Those need to be updated through config/templates, not by overwriting production env.

## 10. Dynamic Trait Compatibility

The NFT contract does not store dynamic trait data on-chain. That is compatible with the current reroll architecture, where the site/API updates off-chain metadata and emits ERC-4906 events from the NFT contract.

The current local metadata trait types include:

- `Accessories`
- `Accessories 2`
- `Background`
- `Clothes`
- `Conditions`
- `Droid`
- `Eyes`
- `Hat`
- `Mouth`
- `Special`
- `Stickers/Body art`

The public metadata helper requires:

- `Background`
- `Droid`
- `Eyes`
- `Clothes`
- `Mouth`
- `Hat`
- `Special`
- `Accessories`

Trait Lab compatibility rules must continue to live in the site/API generator layer. The contract only needs metadata mutability and ERC-4906 refresh hooks.

## 11. ERC-4906 Support

Current support:

- ERC-4906 interface ID is supported by inherited `ERC721ContractMetadata`.
- `setBaseURI` emits `BatchMetadataUpdate(1, _nextTokenId() - 1)` when supply is nonzero.
- `emitBatchMetadataUpdate(uint256,uint256)` exists.

Missing:

- No single-token `emitMetadataUpdate(uint256 tokenId)` helper.
- `emitBatchMetadataUpdate` does not validate token ranges.

## 12. Royalty Behavior

The contract stores ERC-2981 royalty receiver and bps in inherited storage.

Current defaults:

- Receiver: deployer
- BPS: `500`

Controls:

- `setRoyaltyInfo`
- `updateRoyaltyReceiver`
- `updateRoyaltyPercentage`

Validation exists for zero receiver and bps greater than 10,000.

Owner decision still needed:

- Production royalty receiver
- Production royalty percentage

ERC-2981 only communicates royalties; marketplace enforcement may vary.

## 13. Treasury Behavior

Direct mint proceeds are held by the NFT contract and withdrawn by `withdrawTreasury()` to `treasury`.

SeaDrop proceeds are expected to be handled by SeaDrop payout configuration, not necessarily held by this NFT contract. This must be validated on Monad testnet if OpenSea/SeaDrop minting is available.

Current protections:

- Treasury cannot be zero when set.
- Withdraw is owner-only.
- Withdraw uses low-level `call`.
- Withdraw reverts on failure and emits `TreasuryWithdrawn`.

## 14. Pause Behavior

Current pause is mint-level only:

- Blocks direct minting.
- Blocks SeaDrop minting.
- Does not block transfers.
- Does not block metadata administration.
- Does not exist for airdrops yet.

This matches the recommended direction for not blocking secondary transfers.

Decision needed:

- Whether NFT airdrops should be blocked while mint pause is active or controlled separately.

## 15. Ownership Behavior

Two-step ownership is inherited:

- `transferOwnership(newOwner)`
- `acceptOwnership()`
- `cancelOwnershipTransfer()`

Risk:

- `renounceOwnership()` is inherited and currently callable by the owner. For this project, renouncing ownership would break mutable metadata, phase configuration, treasury, SeaDrop authorization, and emergency controls.

Recommendation:

- Override `renounceOwnership()` to revert.
- Use a multisig owner for mainnet.

## 16. Potential Vulnerabilities Found

### Critical

1. Production supply mismatch. Resolved in this branch.
   - Contract now hard-locks `3,333`.
   - Existing deployed testnet bytecode predates this change and must be replaced for validation.

2. Production identity mismatch. Resolved in this branch.
   - Deploy script/tests now use collection name `D.Y.O.O.R` and symbol `DYOOR`.

3. Missing required Ascension whitelist phase. Resolved in this branch.
   - `Ascension` was added between Team and regular Whitelist.

4. Missing NFT airdrop route and admin manager. Resolved in this branch.
   - Owner batch airdrop and `/admin/airdrop` tooling were added.

### High

5. SeaDrop per-stage and per-wallet limits are not contract-enforced for SeaDrop mints.
   - Global supply and authorized caller are enforced.
   - Stage timing/pricing/allocations depend on external SeaDrop configuration.

6. Metadata archive is not launch-clean locally.
   - Local metadata uses `ipfs://REPLACE_ME/{tokenId}.png` in all sampled and checked files.
   - Production image CID is not reflected in local archive.

7. Mainnet deployment script lacks explicit mainnet safety.
   - No chain ID guard in `script/DeployDYOORSeason2SeaDrop.s.sol`.
   - No `MAINNET_DEPLOY_CONFIRMATION=I_UNDERSTAND_THIS_IS_FINAL` guard.
   - Existing package script broadcasts testnet with verification.

8. `renounceOwnership()` remains available through inheritance.

### Medium

9. No single-token ERC-4906 emit helper.
10. No validation on emitted metadata update ranges.
11. No max transaction quantity for public mint.
12. Phase configs can be changed after a phase begins.
13. Allowlist leaf is address-only; it does not encode allowance.
14. Admin authorization messages do not include chain ID or contract address.
15. Pinata upload manifests are not present in the repo.
16. `.env.example` and dynamic metadata defaults point to older CIDs.

### Low

17. Existing docs were stale and still said 5,555, `DYOOR2`, and old 333 MON pricing. Resolved in the touched Season 2 docs in this branch.
18. Public metadata helper required traits do not include `Accessories 2`, `Conditions`, or `Stickers/Body art`, even though local metadata has them.
19. `setExternalSystem` allows arbitrary system IDs and zero values; this is not currently dangerous but should be documented or tightened.

### Informational

20. Baseline SeaDrop tests pass: `20 passed; 0 failed`.
21. Existing tests pass against stale assumptions, so they need to be rewritten for production requirements.

## 17. Changes Made

Initial review phase only:

- Added this production-readiness report.
- Added owner decision placeholder document.

No contract, deployment, frontend, admin, or production environment behavior has been changed yet.

## 18. Changes Intentionally Not Made Yet

- No mainnet deployment.
- No testnet deployment.
- No irreversible transactions.
- No `freezeMetadata`.
- No ownership changes.
- No production env updates.
- No Merkle leaf format changes.
- No token numbering changes.
- No metadata filename changes.

## 19. Remaining Risks

- Monad/OpenSea custom SeaDrop onboarding is not confirmed.
- Final SeaDrop address for Monad is unknown.
- Final phase timestamps and roots are unknown.
- Final Ascension WL wallet limit is unknown.
- Production metadata CID must be verified against the actual uploaded files.
- Production image CID must be verified against every token metadata image field.
- No coverage report has been generated for production tests yet.
- Existing branch is `s2-trait-lab-live-test`; production contract work should move to a dedicated branch before implementation.

## 20. Manual Verification Steps

Before mainnet:

1. Confirm final owner wallet.
2. Confirm treasury wallet.
3. Confirm royalty receiver and BPS.
4. Confirm final SeaDrop address on Monad, if any.
5. Confirm OpenSea custom contract onboarding path for Monad.
6. Confirm exact metadata CID file names and sample fetches.
7. Confirm `/api/metadata/{tokenId}` remains the desired mutable base URI, or explicitly choose static IPFS base URI.
8. Confirm final phase timestamps and Merkle roots.
9. Confirm airdrop pause behavior.
10. Confirm whether `renounceOwnership()` should be disabled.

## 21. Testnet Checklist

Fresh production-equivalent testnet deployment should validate:

- name `D.Y.O.O.R`
- symbol `DYOOR`
- max supply `3333`
- token ID sequence `1..3333`
- extensionless `tokenURI` output if static IPFS is used
- dynamic `https://dyoor.xyz/api/metadata/{tokenId}` output if dynamic API is used
- Team mint
- Ascension WL mint
- regular whitelist OpenSea/SeaDrop mint
- GTD mint
- Public mint
- exact pricing
- wallet limits
- Merkle proofs and wrong-proof failures
- pause and unpause
- airdrop success and failures
- authorized SeaDrop mint
- unauthorized SeaDrop mint failure
- direct plus SeaDrop wallet-limit behavior
- global supply overflow attempts
- ERC-4906 single and batch events
- royalties
- treasury withdrawals
- ownership transfer, accept, and cancel
- transfers while mint pause is active

## 22. Mainnet Checklist

Mainnet deployment is not approved during this task.

Required before mainnet:

- Production contract source finalized and committed.
- Testnet deployment uses same source and compiler settings.
- Full Foundry unit/fuzz/invariant tests pass.
- Frontend build passes.
- Coverage report generated and reviewed.
- MonadScan verification command tested on testnet.
- Owner decisions filled.
- Team/Ascension/GTD Merkle outputs generated from final CSVs and checksummed.
- Regular whitelist upload/configuration records saved from OpenSea/SeaDrop.
- Pinata metadata and image manifests saved.
- Mainnet dry-run report reviewed.
- Explicit owner approval received.

## 23. OpenSea Onboarding Unknowns

SeaDrop compatibility is technically preserved by inheriting `ERC721SeaDrop`.

Unconfirmed:

- Whether OpenSea supports SeaDrop/OpenSea Primary Drops on Monad mainnet.
- Whether a Monad SeaDrop 1.0 address exists and is supported.
- Whether OpenSea custom contract onboarding is available for this collection.
- Whether OpenSea will support the direct D.Y.O.O.R contract as a custom drop without deploying a new OpenSea-generated collection.

The contract must still work fully through dyoor.xyz if OpenSea onboarding is unavailable.

## 24. Scatter Compatibility Considerations

No Scatter-specific contract integration was found in this pass. The NFT remains ERC721/metadata compatible, but any Scatter-specific listing, refresh, or custom-chain behavior must be manually validated after testnet deployment.

## 25. Deployment Rollback Limitations

Smart contract deployments are not rollbackable. A bad mainnet deployment would require deploying a new contract and migrating social, marketplace, website, and holder expectations.

Mutable metadata can be corrected if ownership remains intact and metadata is not frozen.

The deployment scripts should save artifacts, constructor args, commit hash, chain ID, tx hash, compiler settings, and verification output to preserve a rollback/reference path for repository state.

## 26. Final Recommendation

Do not deploy the current `DYOORSeason2SeaDrop` contract to Monad mainnet.

Recommended path:

1. Create a dedicated production-readiness branch.
2. Update the SeaDrop-compatible contract to hard-lock 3,333 supply and `DYOOR` symbol defaults.
3. Add Ascension WL phase and NFT batch airdrop.
4. Use the regular whitelist window for OpenSea/SeaDrop-managed minting; keep Team/Ascension/GTD/Public as dyoor.xyz direct routes.
5. Override `renounceOwnership()` to revert.
6. Add ERC-4906 single-token helper and range checks.
7. Update deployment and verification scripts with mainnet guards and artifacts.
8. Build NFT airdrop manager that uses connected owner wallet transactions, not server private keys.
9. Update metadata CID/image CID templates and validate actual uploaded metadata.
10. Expand tests to cover required production behavior, fuzz cases, and invariants.

## Proposed Implementation Plan

Phase 4 contract changes:

- Change `MAX_SUPPLY` to `3_333`.
- Add `Ascension` mint phase between Team and Whitelist.
- Add phase-specific defaults: Team free/10, Ascension 333 MON with owner-provided wallet limit, regular WL 350 MON/3 through OpenSea/SeaDrop, GTD 450 MON/2, Public 550 MON/unlimited wallet cap but bounded tx quantity.
- Add NFT batch airdrop with event and total airdropped counter.
- Add single-token ERC-4906 emit helper and range validation.
- Override `renounceOwnership()` to revert.
- Add phase update protections for started phases unless intentionally bypassed by owner-only emergency method.
- Decide SeaDrop route cap model and implement tests.

Phase 5 tests:

- Rewrite current SeaDrop tests around 3,333 and `DYOOR`.
- Add Ascension, airdrop, pause, ownership, royalty, metadata, supply-combination, fuzz, and invariant coverage.

Phase 6 scripts:

- Replace deploy script with chain guards, dry-run, mainnet confirmation, artifact output, verification args, and metadata defaults.
- Add MonadScan verification helper.
- Add testnet validation script.
- Add Merkle generators for Team/Ascension/GTD as needed; keep the regular WL source/export for OpenSea/SeaDrop configuration.
- Add metadata validation for extensionless and `.json` modes.

Phase 7 admin UI:

- Add `/admin/airdrop` with owner gate, CSV validation, deterministic batches, simulation, connected-wallet execution, resume state, and export.
- Extend admin message format for scoped airdrop authorization including action, chain ID, contract address, issued-at, expiration, and nonce.

Phase 8 verification:

- Run formatting, compile, unit tests, fuzz/invariants, coverage, lint/typecheck/build.

Phase 10 deployment:

- Stop before deployment unless the owner explicitly approves a fresh Monad testnet transaction.
