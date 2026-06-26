# Deploy DYOOREnergyBank

## Required Env Vars

Create or update `.env`:

```env
MONAD_RPC_URL=https://rpc.monad.xyz
DEPLOYER_PRIVATE_KEY=
ENERGY_ADMIN_ADDRESS=
ASCENSION_STAKING_ADDRESS=0xf9611226c1CcCcCa37951938d6f358D3d5106549
ENERGY_CREDIT_SIGNER_ADDRESS=
ENERGY_CREDIT_SIGNER_PRIVATE_KEY=
AIRDROP_WALLET_FILE=/Users/brandonduke/Library/Mobile Documents/com~apple~CloudDocs/Coo codex/dyoor_wallet_addresses.txt
```

`ENERGY_ADMIN_ADDRESS` is optional. If it is empty, the deployer address becomes admin.

`ENERGY_CREDIT_SIGNER_ADDRESS` is optional. If set, the deploy script calls:

```solidity
setCreditSigner(ENERGY_CREDIT_SIGNER_ADDRESS, true)
```

Do not use a personal or main wallet as `ENERGY_CREDIT_SIGNER_PRIVATE_KEY`.
Use a dedicated signer wallet.

`ENERGY_CREDIT_SIGNER_PRIVATE_KEY` is required only for the Netlify function that signs
harvest credits into the on-chain Energy Bank. The signer address must have
`CREDIT_SIGNER_ROLE` on `DYOOREnergyBank`.

## Install

```bash
npm install
```

## Compile

```bash
npm run compile:contracts
```

## Deploy To Monad

Only deploy after `.env` is ready and the deployer wallet has enough MON for gas:

```bash
npm run deploy:energy-bank
```

The deploy script prints:

- `DYOOREnergyBank address`
- `admin address`
- `ascension staking address`
- `chain id`
- credit signer confirmation, if configured

## Site Env After Deployment

Copy the deployed contract address into the site/runtime env:

```env
ENERGY_BANK_ADDRESS=<deployed contract address>
```

## Backfill Existing Harvested Energy

Dry-run first:

```bash
npm run backfill:energy-bank
```

Execute only after reviewing the dry-run output:

```bash
npm run backfill:energy-bank:execute
```

The script reads `data/harvested-energy.json`, checks whether each claim has
already been credited on-chain, and calls `creditEnergy` only for missing
historical credits. Valid historical harvest transaction hashes are used as-is.
Seeded or synthetic ledger entries are mapped to deterministic `bytes32` ids.

## DYOOR Stake-By-June-9-2026 Energy Airdrop

The Energy airdrop uses the deployed `DYOOREnergyBank`; do not deploy a new
staking or Energy Bank contract for this campaign.

The script:

- reads one wallet per line from `AIRDROP_WALLET_FILE`
- rejects invalid wallet addresses
- dedupes duplicate wallet addresses before calling the contract
- checks that the caller has `DEFAULT_ADMIN_ROLE`
- checks that the campaign has not already been used on-chain when the upgraded bank is deployed
- falls back to the legacy `correctEnergy` admin path on the live mainnet bank
- simulates the chosen path before any broadcast
- credits `25000 ether` per recipient
- uses `keccak256("DYOOR_STAKE_BY_JUNE_9_2026_25000_ENERGY")` as the campaign id

### Local Test

```bash
npm install
npm run compile:contracts
npm run test:contracts
```

### Monad Testnet Dry Run

```bash
export MONAD_TESTNET_RPC_URL=<monad testnet rpc url>
export DEPLOYER_PRIVATE_KEY=<admin private key>
export ENERGY_BANK_ADDRESS=<testnet DYOOREnergyBank address>
export HARDHAT_NETWORK=monadTestnet
export AIRDROP_WALLET_FILE=/Users/brandonduke/Desktop/dyoor_wallet_addresses.txt
export EXPECTED_CHAIN_ID=10143

npm run airdrop:energy:dry-run
```

### Monad Mainnet Broadcast

Run a mainnet dry run first:

```bash
export MONAD_RPC_URL=https://rpc.monad.xyz
export DEPLOYER_PRIVATE_KEY=<admin private key>
export ENERGY_BANK_ADDRESS=<mainnet DYOOREnergyBank address>
export HARDHAT_NETWORK=monad
export AIRDROP_WALLET_FILE=/Users/brandonduke/Desktop/dyoor_wallet_addresses.txt
export EXPECTED_CHAIN_ID=143

npm run airdrop:energy:dry-run
```

Broadcast only after the dry run prints the expected recipient count and total:

```bash
npm run airdrop:energy:broadcast
```

The broadcast output includes recipient count, total Energy distributed,
transaction hash, and before/after spot checks for the first three wallets.
