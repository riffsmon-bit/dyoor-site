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
