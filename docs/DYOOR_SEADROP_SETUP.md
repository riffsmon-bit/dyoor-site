# D.Y.O.O.R Season 2 SeaDrop Setup

This document covers the current SeaDrop-first Season 2 architecture.

Internal production-readiness documentation. This is not a formal audit.

## Contract

- Source: `contracts/DYOORSeason2SeaDrop.sol`
- Name: `D.Y.O.O.R`
- Symbol: `DYOOR`
- Max supply: `3333`
- Reserved airdrop allocation: `610`
- Maximum SeaDrop paid-mint allocation: `2723`
- Temporary deploy metadata base URI: `ipfs://bafybeidz7htb3digthznwvl4ytdpckq2q3d2ytgxtsie5bcp7a4lgtb2sq/`
- Long-term dynamic metadata base URI: `https://dyoor.xyz/api/metadata/`

## Current Mint Model

Paid mints are intended to be configured through OpenSea/SeaDrop:

- Presale wallet lists
- Presale prices
- Presale start/end times
- Per-wallet limits
- Public-sale configuration
- SeaDrop payout/fee recipient settings where supported

The D.Y.O.O.R NFT contract only exposes these mint routes:

- Authorized SeaDrop mint: `mintSeaDrop(address minter, uint256 quantity)`
- Owner airdrop: `airdrop(address[] recipients, uint256[] quantities, bytes32 batchId)`
- Owner batch airdrop helper: `airdropBatch(bytes32 batchId, uint256 batchIndex, address[] recipients, uint256[] quantities)`

The old D.Y.O.O.R direct paid mint phase functions are removed:

- `teamMint`
- `ascensionMint`
- `whitelistMint`
- `gtdMint`
- `publicMint`
- `mintDirect`
- custom Merkle root setters
- custom phase timestamp/price setters

SeaDrop's own `updateAllowList` support remains inherited from OpenSea's SeaDrop-compatible interface.

## Reserve Protection

The contract enforces:

```text
MAX_SUPPLY = 3333
AIRDROP_RESERVE = 610
SEADROP_MAX_SUPPLY = 2723
```

SeaDrop cannot mint more than `2723` from this NFT contract, even if OpenSea UI configuration is incorrect.

The owner airdrop route cannot mint more than `610` total airdropped NFTs.

## Dependency Notes

- Vendored SeaDrop package: `lib/seadrop`, version `1.0.0`
- Vendored SeaDrop commit: `8b4792f7067c8d99d2d20026eeac9f80f5c5dfeb`
- Solidity compiler: `0.8.17`
- Foundry optimizer: enabled, runs `1`
- Solidity OpenZeppelin dependency used by Foundry remapping: `4.7.0`
- Root npm OpenZeppelin package: `5.6.1` for site/Hardhat package context, not the Foundry SeaDrop compile path

Do not mix OpenZeppelin v5 assumptions into this SeaDrop v1 Solidity inheritance tree.

## Build And Test

```bash
npm run build:seadrop
npm run test:seadrop
npm run gas:seadrop
npm run coverage:seadrop
```

Equivalent raw commands:

```bash
forge build
forge test --offline
forge test --offline --gas-report
forge coverage --report summary
```

## Monad Testnet Deployment

The deployment script is testnet-only and refuses Monad mainnet.

Required:

- `PRIVATE_KEY` or `DEPLOYER_PRIVATE_KEY`
- `MONAD_TESTNET_RPC_URL`
- `MONAD_TESTNET_DEPLOY_CONFIRMATION=DEPLOY_DYOOR_TESTNET_ONLY`
- `SEADROP_ADDRESS`

The configured `SEADROP_ADDRESS` must have deployed bytecode on Monad testnet. Do not guess or copy a SeaDrop address from another chain.

Command:

```bash
MONAD_TESTNET_DEPLOY_CONFIRMATION=DEPLOY_DYOOR_TESTNET_ONLY \
PRIVATE_KEY=... \
MONAD_TESTNET_RPC_URL=... \
SEADROP_ADDRESS=... \
DYOOR_TREASURY_ADDRESS=... \
DYOOR_ROYALTY_RECEIVER=... \
DYOOR_ROYALTY_BPS=... \
DYOOR_BASE_URI=ipfs://bafybeidz7htb3digthznwvl4ytdpckq2q3d2ytgxtsie5bcp7a4lgtb2sq/ \
DYOOR_CONTRACT_URI=... \
npm run deploy:dyoor-s2-seadrop:testnet
```

The script writes:

```text
deployments/dyoor-s2-seadrop.latest.json
```

## MonadScan Verification

Dry run:

```bash
DYOOR_S2_CONTRACT_ADDRESS=... \
SEADROP_ADDRESS=... \
MONAD_TESTNET_RPC_URL=... \
MONADSCAN_API_KEY=... \
CHAIN_ID=10143 \
npm run verify:dyoor-s2
```

Execute:

```bash
DYOOR_S2_CONTRACT_ADDRESS=... \
SEADROP_ADDRESS=... \
MONAD_TESTNET_RPC_URL=... \
MONADSCAN_API_KEY=... \
CHAIN_ID=10143 \
EXECUTE_VERIFY=1 \
npm run verify:dyoor-s2
```

## Post-Deployment Validation

```bash
DYOOR_S2_CONTRACT_ADDRESS=... \
MONAD_TESTNET_RPC_URL=... \
npm run validate:s2-testnet
```

This validates:

- Name and symbol
- Owner and pending owner
- Supply constants
- SeaDrop cap
- Airdrop reserve
- Authorized SeaDrop addresses
- Pause state
- Metadata URIs
- Royalties
- Absence of removed direct mint routes

## Controlled SeaDrop Test Mint

The helper defaults to dry-run/prepare mode.

```bash
DYOOR_S2_CONTRACT_ADDRESS=... \
SEADROP_ADDRESS=... \
SEADROP_FEE_RECIPIENT=... \
MONAD_TESTNET_RPC_URL=... \
TEST_MINTER_PRIVATE_KEY=... \
TEST_MINT_QUANTITY=1 \
TEST_MINT_VALUE_WEI=0 \
npm run test:s2-seadrop-mint
```

To send one controlled testnet transaction only after owner approval:

```bash
EXECUTE_TEST_MINT=1 \
TEST_MINT_CONFIRMATION=MINT_ONE_DYOOR_TESTNET \
...same env as above... \
npm run test:s2-seadrop-mint
```

Do not use this script on Monad mainnet.

## Monad Mainnet Deployment Experiment

The mainnet path exists only for the controlled OpenSea attachment experiment. It is irreversible and should not be used as a casual test.

The local SeaDrop 1.0 docs list the canonical SeaDrop address:

```text
0x00005EA00Ac477B1030CE78506496e8C2dE24bf5
```

Monad is not listed in that SeaDrop support table. On 2026-07-14, `eth_getCode` against `https://rpc.monad.xyz` confirmed that this canonical address has deployed bytecode on Monad mainnet chain `143`. That means it is technically usable as the authorized SeaDrop address for deployment, but OpenSea Studio Drop attachment/configuration still must be verified manually.

The mainnet deploy script enforces bytecode presence and refuses all chains except Monad mainnet.

Recommended temporary base URI while the D.Y.O.O.R dynamic API is not ready:

```text
ipfs://bafybeidz7htb3digthznwvl4ytdpckq2q3d2ytgxtsie5bcp7a4lgtb2sq/
```

This resolves as extensionless token metadata, for example token `1` resolves to:

```text
ipfs://bafybeidz7htb3digthznwvl4ytdpckq2q3d2ytgxtsie5bcp7a4lgtb2sq/1
```

Dry run first:

```bash
MONAD_MAINNET_DEPLOY_CONFIRMATION=DEPLOY_DYOOR_MAINNET_OPENSEA_EXPERIMENT \
PRIVATE_KEY=... \
MONAD_MAINNET_RPC_URL=https://rpc.monad.xyz \
SEADROP_ADDRESS=... \
DYOOR_TREASURY_ADDRESS=0x4d540f7d0eb841c839334655c9f88313d750c6d5 \
DYOOR_ROYALTY_RECEIVER=... \
DYOOR_ROYALTY_BPS=... \
DYOOR_BASE_URI=ipfs://bafybeidz7htb3digthznwvl4ytdpckq2q3d2ytgxtsie5bcp7a4lgtb2sq/ \
DYOOR_CONTRACT_URI=... \
npm run simulate:dyoor-s2-seadrop:mainnet
```

Broadcast only after reviewing the dry-run output:

```bash
MONAD_MAINNET_DEPLOY_CONFIRMATION=DEPLOY_DYOOR_MAINNET_OPENSEA_EXPERIMENT \
PRIVATE_KEY=... \
MONAD_MAINNET_RPC_URL=https://rpc.monad.xyz \
SEADROP_ADDRESS=... \
DYOOR_TREASURY_ADDRESS=0x4d540f7d0eb841c839334655c9f88313d750c6d5 \
DYOOR_ROYALTY_RECEIVER=... \
DYOOR_ROYALTY_BPS=... \
DYOOR_BASE_URI=ipfs://bafybeidz7htb3digthznwvl4ytdpckq2q3d2ytgxtsie5bcp7a4lgtb2sq/ \
DYOOR_CONTRACT_URI=... \
npm run deploy:dyoor-s2-seadrop:mainnet
```

Do not call `freezeMetadata`. The owner can switch to `https://dyoor.xyz/api/metadata/` later with `setBaseURI` after the dynamic metadata API is ready.

## OpenSea Attachment Status

The OpenSea custom-contract / manually deployed SeaDrop-compatible path on Monad must be tested after a fresh testnet deployment.

Until the owner confirms the Drop URL, the website should show:

```text
OpenSea Drop configuration pending
```

Do not claim OpenSea Drop configuration works merely because the collection indexes for secondary trading.

## Controlled Monad Mainnet Deployment

Deployment date: 2026-07-14

This deployment was executed as a controlled OpenSea attachment experiment, not as confirmation that the public mint is live.

```text
Contract: 0x349D8eb480c92cF75371fbA5C6344A4d11b9103A
Deployer / owner: 0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6
SeaDrop: 0x00005EA00Ac477B1030CE78506496e8C2dE24bf5
Treasury: 0x4D540f7D0Eb841c839334655C9f88313D750c6d5
Royalty receiver: 0x4D540f7D0Eb841c839334655C9f88313D750c6d5
Royalty bps: 500
Base URI: ipfs://bafybeidz7htb3digthznwvl4ytdpckq2q3d2ytgxtsie5bcp7a4lgtb2sq/
Contract URI: not set
```

Transactions:

```text
Deploy: 0x4bf48a20f598ffeb3e5bbd655ace2660129f0bc6624d4e685cc4623daead6d79
setTreasury: 0xabd2b53649406a621dfeafbad1f975e0e51e8f297f8e434b48c19f0209525d24
setRoyaltyInfo: 0x63c8c120a17c146a912572de77ed7da4cb4eea9e1d7c3079c80e7a0c3e6ae57c
setBaseURI: 0xc806cff5c724d14c8916dcb1d17b62a5138920f32f85cf19e0d5ac0dcbfa21ec
```

Read-only validation after deployment confirmed:

- chain ID `143`
- name `D.Y.O.O.R`
- symbol `DYOOR`
- max supply `3333`
- airdrop reserve `610`
- SeaDrop cap `2723`
- total supply `0`
- authorized SeaDrop has bytecode and is allowed
- Pinata base URI is set
- mint pause and airdrop pause are both false

Remaining steps:

- Verify source on MonadScan.
- Set contract URI if collection-level metadata is ready.
- Open OpenSea Studio with the owner wallet and test whether this manually deployed contract can be configured as a Drop.
- Do not publish a real sale schedule until OpenSea Drop controls are confirmed.

## Can Users Mint Directly On OpenSea?

That is the intended production path for paid mints after this refactor, but it is not confirmed until the controlled Monad testnet experiment is complete.

OpenSea documentation says SeaDrop is the protocol for primary drops, including public drops and presales/allowlists, and says custom contracts can extend `ERC721SeaDrop` when project-specific functionality is required. The same documentation warns not to modify minting functionality if the goal is a seamless OpenSea minting experience.

D.Y.O.O.R now follows that model as closely as possible:

- OpenSea/SeaDrop should manage public sale, presale wallet lists, pricing, schedules, per-wallet limits, and payout settings where supported.
- The D.Y.O.O.R contract keeps only a minimal `mintSeaDrop(address,uint256)` override for local pause, authorized-SeaDrop, max-supply, and 610-token reserve enforcement.
- D.Y.O.O.R custom Merkle roots and direct paid mint routes are removed from the runtime NFT contract and website.

The unresolved question is operational, not architectural: we still need to verify whether OpenSea Studio on Monad exposes controls for attaching/configuring this manually deployed custom SeaDrop-compatible contract as a Drop. Treat the possible outcomes as:

- custom contract can be fully attached and configured through OpenSea UI
- contract indexes as a collection but cannot be configured as a Drop
- OpenSea requires manual creator-support onboarding
- Monad custom SeaDrop contracts are not currently supported
- result is inconclusive

References:

- `https://docs.opensea.io/docs/seadrop`
- `https://docs.opensea.io/docs/deploying-a-seadrop-compatible-contract`
- `https://docs.opensea.io/docs/create-a-drop`

## Wallet List Exports

Historical wallet source files remain off-chain. The current helper exports OpenSea-compatible CSV options:

```bash
npm run export:opensea-wallet-list -- --input DYOOR_WL_Comma_Separated_Merged_Deduped_v3.txt --stage regular-wl --limit 3
```

Outputs:

```text
wallet-list-exports/opensea/regular-wl-addresses.csv
wallet-list-exports/opensea/regular-wl-with-limit.csv
wallet-list-exports/opensea/regular-wl-manifest.json
wallet-list-exports/opensea/regular-wl-validation.json
```

OpenSea's exact upload column expectations must be confirmed manually before final upload.

## Airdrop

Do not execute the real 610-NFT airdrop during testnet setup.

Dry run:

```bash
npm run dry-run:s2-airdrop -- --input dyoor-s2-ascended-airdrop-with-treasury.csv --batch-size 25
```

Admin UI:

```text
/admin/airdrop
```

The connected owner wallet signs transactions. No owner private key is stored in the site or Netlify.

## Hard Stops

- Do not deploy to Monad mainnet from this task.
- Do not execute the real 610-NFT airdrop.
- Do not call `freezeMetadata`.
- Do not call `renounceOwnership`.
- Do not guess SeaDrop addresses.
- Do not re-enable D.Y.O.O.R custom Merkle/direct paid mint routes.
