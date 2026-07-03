# D.Y.O.O.R Season 2 SeaDrop Setup

This document covers the D.Y.O.O.R Season 2 NFT contract:

- Contract: `contracts/DYOORSeason2SeaDrop.sol`
- Name: `D.Y.O.O.R`
- Meaning: `Directive: Yield Opportunity Optimization Robots`
- Symbol: `DYOOR2`
- Max supply: `5555`
- Target chain: Monad
- Mint paths: `dyoor.xyz` direct mint and OpenSea Primary Drops through SeaDrop

## Architecture

`DYOORSeason2SeaDrop` extends OpenSea's `ERC721SeaDrop`. The contract keeps the SeaDrop mint entrypoint and SeaDrop accounting intact:

- `mintSeaDrop(address minter, uint256 quantity)` is restricted to allowed SeaDrop addresses.
- `getMintStats(address minter)` continues to return ERC721A `_numberMinted`, total minted, and max supply.
- Direct dyoor.xyz mints and SeaDrop mints share the same ERC721A minted count, same total supply, same metadata, and same contract.

Direct mint phases are built into the DYOOR contract for dyoor.xyz. SeaDrop phases must still be configured on the SeaDrop contract/OpenSea side with matching launch settings.

## Local Setup

Install Node dependencies if needed:

```bash
npm install
```

Install Foundry if it is not already installed:

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

Build and test:

```bash
npm run build:seadrop
npm run test:seadrop
npm run gas:seadrop
```

Equivalent raw commands:

```bash
forge build
forge test --offline
forge test --offline --gas-report
```

`--offline` is used for tests after compiler installation to avoid network-backed signature decoding issues during local runs.

## Dependencies

SeaDrop is vendored under:

```text
lib/seadrop
```

The local SeaDrop README documents SeaDrop 1.0 at:

```text
0x00005EA00Ac477B1030CE78506496e8C2dE24bf5
```

The local SeaDrop network table lists Ethereum, Sepolia, Polygon, Arbitrum, Avalanche, Optimism, Base, and other EVM networks. Monad must be verified separately before launch. Do not assume OpenSea Primary Drops on Monad are available until OpenSea/Monad confirms a supported SeaDrop deployment.

## Contract Controls

Owner controls:

- Pause and unpause all mint paths.
- Update treasury.
- Update direct mint prices.
- Update direct mint Merkle roots.
- Update phase start timestamps.
- Update base URI.
- Update contract URI.
- Emit ERC-4906 metadata update events.
- Freeze metadata.
- Withdraw direct mint proceeds to treasury.
- Update royalty receiver.
- Update royalty basis points.
- Register future external system contract addresses.
- Configure SeaDrop through inherited SeaDrop configuration methods.

Max supply is locked to `5555`. The inherited SeaDrop `setMaxSupply` method is overridden so attempts to change supply to any other value revert.

## Direct Mint Phases

The owner sets four timestamps:

- Team Start
- Whitelist Start
- GTD Start
- Public Start

The active phase is calculated automatically from timestamps:

```text
Team      active from Team Start until Whitelist Start
Whitelist active from Whitelist Start until GTD Start
GTD       active from GTD Start until Public Start
Public    active from Public Start onward
```

Direct dyoor.xyz phase defaults:

| Phase | Price | Wallet Limit | Access |
| --- | ---: | ---: | --- |
| Team | 0 MON | 10 | Merkle allowlist |
| Whitelist | 333 MON | 3 | Merkle allowlist |
| GTD | 333 MON | 2 | Merkle allowlist |
| Public | 333 MON | Remaining supply | Public |

Direct allowlist leaf format:

```solidity
keccak256(abi.encodePacked(wallet))
```

Generate roots from normalized wallet addresses. Onchain address comparison is binary; lowercase is recommended for tooling consistency.

Important: direct mint wallet limits use ERC721A `_numberMinted(wallet)`, so SeaDrop mints and direct mints count together. This prevents minting through OpenSea and then bypassing limits on dyoor.xyz.

## SeaDrop Configuration

The constructor accepts allowed SeaDrop addresses. The deployment script defaults to OpenSea's documented SeaDrop 1.0 address:

```text
0x00005EA00Ac477B1030CE78506496e8C2dE24bf5
```

Before deploying to Monad, verify whether Monad testnet/mainnet has an OpenSea-supported SeaDrop deployment. If Monad uses a different SeaDrop address, set:

```bash
export SEADROP_ADDRESS=<monad-supported-seadrop-address>
```

SeaDrop configuration is separate from direct mint configuration. Configure SeaDrop with matching launch settings:

- Creator payout address.
- Allowed fee recipient if fees are restricted.
- Drop URI.
- Allowlist root and allowlist URI.
- Public drop price/start/end/max wallet settings.

SeaDrop allowlist leaves are not the same as the direct DYOOR allowlist leaves. SeaDrop allowlist minting uses OpenSea's `MintParams` format. Generate SeaDrop allowlists with OpenSea-compatible tooling or the OpenSea drop configuration flow.

SeaDrop public mint has `maxTotalMintableByWallet` as a `uint16`. For "unlimited" public mint on a `5555` supply collection, set this to `5555` or another launch-approved cap.

## Environment Variables

Required for testnet deployment:

```bash
export DEPLOYER_PRIVATE_KEY=0x...
export MONAD_TESTNET_RPC_URL=https://...
```

Recommended:

```bash
export SEADROP_ADDRESS=0x00005EA00Ac477B1030CE78506496e8C2dE24bf5
export DYOOR_TREASURY_ADDRESS=0x...
export DYOOR_ROYALTY_RECEIVER=0x...
export DYOOR_ROYALTY_BPS=500
export DYOOR_BASE_URI=ipfs://CID/
export DYOOR_CONTRACT_URI=ipfs://CID/contract.json
```

Optional direct phase config:

```bash
export DYOOR_TEAM_START=1780000000
export DYOOR_WL_START=1780003600
export DYOOR_GTD_START=1780007200
export DYOOR_PUBLIC_START=1780010800
export DYOOR_TEAM_ROOT=0x...
export DYOOR_WL_ROOT=0x...
export DYOOR_GTD_ROOT=0x...
```

Hidden dyoor.xyz mint test page:

```bash
NEXT_PUBLIC_ENABLE_S2_MINT_TEST=true
NEXT_PUBLIC_DYOOR_S2_CONTRACT_ADDRESS=0x...
NEXT_PUBLIC_DYOOR_S2_CHAIN_ID=10143
NEXT_PUBLIC_DYOOR_S2_CHAIN_NAME="Monad Testnet"
NEXT_PUBLIC_DYOOR_S2_RPC_URL=https://testnet-rpc.monad.xyz
NEXT_PUBLIC_DYOOR_S2_EXPLORER_URL=https://testnet.monadscan.com
NEXT_PUBLIC_DYOOR_S2_START_BLOCK=<deployment-block>
NEXT_PUBLIC_DYOOR_S2_LOG_CHUNK_SIZE=2500
```

Current Monad testnet deployment:

```text
Contract: 0xce586aa467f6351bf819dbf134bc69947125cd92
Transaction: 0xdf99dbd4aca6376d1be2d1cf7e1aee12d1f01d01d94f7aeb42f61bda3c10da09
Chain ID: 10143
Deployment block: 42188639
Explorer: https://testnet.monadscan.com/address/0xce586aa467f6351bf819dbf134bc69947125cd92
```

Use `42188639` for `NEXT_PUBLIC_DYOOR_S2_START_BLOCK` on the hidden mint
test page for this deployment.

Keep `NEXT_PUBLIC_ENABLE_S2_MINT_TEST=false` unless the internal `/s2-mint-test` route is intentionally being used. The route is not linked from navigation. The page tests the direct dyoor.xyz mint functions. OpenSea Primary Drops must still be tested through OpenSea/SeaDrop.

Never commit private keys or secret RPC credentials.

## Deploy To Monad Testnet

Dry run:

```bash
forge script script/DeployDYOORSeason2SeaDrop.s.sol --rpc-url $MONAD_TESTNET_RPC_URL -vvvv
```

Broadcast:

```bash
npm run deploy:dyoor-s2-seadrop:testnet
```

If the explorer does not support automatic verification with the default Foundry verifier, use the explorer's recommended command. A typical Blockscout-style command is:

```bash
forge verify-contract \
  --chain-id <monad-testnet-chain-id> \
  --verifier blockscout \
  --verifier-url <explorer-api-url> \
  <deployed-contract-address> \
  contracts/DYOORSeason2SeaDrop.sol:DYOORSeason2SeaDrop
```

Use the exact chain ID and verifier URL from current Monad documentation.

## Configure Metadata

Base URI:

```solidity
setBaseURI("ipfs://CID/")
```

With a trailing slash, token `1` resolves as:

```text
ipfs://CID/1
```

Without a trailing slash, every token returns the same URI. This is useful for unrevealed metadata.

Contract URI:

```solidity
setContractURI("ipfs://CID/contract.json")
```

Contract metadata should include OpenSea-compatible fields such as:

```json
{
  "name": "D.Y.O.O.R",
  "description": "Directive: Yield Opportunity Optimization Robots",
  "image": "ipfs://CID/collection.png",
  "external_link": "https://dyoor.xyz",
  "seller_fee_basis_points": 500,
  "fee_recipient": "0x..."
}
```

Emit metadata refresh events:

```solidity
emitBatchMetadataUpdate(1, 5555)
```

Freeze metadata only after final URIs are confirmed:

```solidity
freezeMetadata()
```

After freezing, `setBaseURI`, `setContractURI`, and `setProvenanceHash` revert.

## Hidden Mint Test Page

Route:

```text
/s2-mint-test
```

The route returns 404 unless:

```bash
NEXT_PUBLIC_ENABLE_S2_MINT_TEST=true
```

Use it after deploying the contract to Monad testnet:

1. Set `NEXT_PUBLIC_DYOOR_S2_CONTRACT_ADDRESS` to the deployed testnet contract.
2. Set `NEXT_PUBLIC_DYOOR_S2_START_BLOCK` to the deployment block so NFT previews do not scan unnecessary logs.
3. Redeploy Netlify or restart the local dev server.
4. Connect a wallet.
5. Switch to Monad testnet from the page prompt.
6. Verify active phase, mint price, wallet minted count, total minted, and remaining supply.
7. Paste Team/WL/GTD Merkle proofs when testing allowlist phases.
8. Mint through Team, Whitelist, GTD, and Public direct paths as each phase becomes active.
9. Confirm transaction hash links open on the configured explorer.
10. Refresh NFT preview and confirm token image, token ID, and attributes load from `tokenURI`.

For direct Team/WL/GTD allowlist testing, proof entries can be pasted one per line, comma-separated, or as a JSON array of `bytes32` strings. The page displays the connected wallet leaf using the contract's direct allowlist format:

```solidity
keccak256(abi.encodePacked(wallet))
```

The NFT preview reconstructs wallet ownership from `Transfer` logs because ERC721A/SeaDrop does not expose enumerable wallet token lists by default. Use the deployment block for `NEXT_PUBLIC_DYOOR_S2_START_BLOCK` to keep this accurate and fast.

## Testnet Checklist

Before mainnet, complete this checklist on Monad testnet:

- Deploy contract with one allowed SeaDrop address.
- Confirm `name`, `symbol`, and `maxSupply`.
- Confirm owner wallet.
- Configure treasury.
- Configure royalties.
- Configure base URI and contract URI.
- Configure direct phase timestamps.
- Configure direct Merkle roots.
- Configure SeaDrop/OpenSea drop settings with matching prices and limits.
- Team direct mint succeeds for allowlisted wallet and fails for non-allowlisted wallet.
- Whitelist direct mint costs `333 MON` and limit is `3`.
- GTD direct mint costs `333 MON` and limit is `2`.
- Public direct mint costs `333 MON`.
- SeaDrop mint succeeds from allowed SeaDrop and fails from any other address.
- Direct mint and SeaDrop mint increase the same total supply.
- `getMintStats(wallet)` reflects both mint paths.
- `/s2-mint-test` is enabled only on an internal test deploy.
- `/s2-mint-test` wallet connect, wrong-network state, direct mint submission, failed mint errors, explorer links, and NFT metadata preview all work.
- Pause blocks direct mint and SeaDrop mint.
- Withdraw sends direct mint proceeds to treasury.
- Royalty info returns expected receiver and amount.
- Token metadata renders in wallets/OpenSea.
- OpenSea indexes the same contract and same collection.
- Metadata refresh works.
- Metadata is frozen only after final review.

## Monad Mainnet Checklist

Do not deploy mainnet until testnet passes.

Mainnet readiness:

- Confirm the exact OpenSea-supported SeaDrop address on Monad mainnet.
- Confirm chain ID, RPC URL, explorer verifier, and gas settings.
- Confirm treasury is a secure wallet or multisig.
- Confirm owner wallet operational security.
- Confirm all allowlist roots from final wallet lists.
- Confirm public start time and supply plan.
- Confirm metadata/IPFS pinning.
- Confirm royalty receiver and basis points.
- Run `forge test --offline`.
- Run `forge test --offline --gas-report`.
- Run a dry-run deployment script.
- Save deployment artifact, constructor args, and transaction hash.

## Known SeaDrop Limitations

- OpenSea Primary Drops require an OpenSea-supported SeaDrop deployment on the target chain.
- The documented SeaDrop 1.0 address is listed by OpenSea for several EVM networks, but Monad support must be verified before launch.
- SeaDrop handles payment and payout for SeaDrop mints. Direct dyoor.xyz mints send native MON to this NFT contract and are withdrawn through `withdrawTreasury`.
- Direct allowlist leaves and SeaDrop allowlist leaves use different formats.
- "Unlimited" public mint in SeaDrop should be represented by a practical cap such as total max supply.

## Recommended Launch Sequence

1. Finalize metadata and contract URI.
2. Generate direct Team/WL/GTD Merkle roots.
3. Generate SeaDrop/OpenSea allowlist configuration.
4. Deploy to Monad testnet.
5. Run all direct mint tests with real wallets.
6. Configure OpenSea Primary Drop on the test deployment if available.
7. Verify OpenSea mints and dyoor.xyz mints share total supply.
8. Verify wallet limits cannot be bypassed across mint paths.
9. Verify treasury withdrawal.
10. Verify royalties.
11. Deploy to Monad mainnet only after testnet and manual checks pass.
12. Configure OpenSea Primary Drop on mainnet.
13. Run a small owner-supervised smoke test before public launch.
