# D.Y.O.O.R Season 2 Mainnet Deployment Checklist

This is an internal deployment checklist, not an audit certificate.

## Hard Stops

- Do not deploy to Monad mainnet without explicit owner approval.
- Do not use an everyday wallet as the final owner without documenting the risk.
- Do not set placeholder treasury, royalty, SeaDrop, or OpenSea stage values.
- Do not call `freezeMetadata`.
- Do not call `renounceOwnership`; the production contract overrides it to revert.
- Do not overwrite production Netlify environment variables from this repo task.

## Required Owner Decisions

See `docs/OWNER_DECISIONS_REQUIRED.md`.

Mainnet deployment is blocked until these values are final:

- owner wallet or multisig
- treasury wallet
- royalty receiver and royalty basis points
- OpenSea/SeaDrop stage windows, prices, wallet limits, and allocations
- Ascension, regular WL, GTD, and any team wallet-list uploads prepared for OpenSea/SeaDrop configuration
- final SeaDrop address for Monad
- contract URI / collection metadata URI
- base URI strategy: dynamic `https://dyoor.xyz/api/metadata/` or static IPFS metadata CID

## Preflight

1. Confirm branch, git commit, and no uncommitted secrets.
2. Run `forge build`.
3. Run `forge test --offline`.
4. Run `forge coverage` if available in the local Foundry install.
5. Run `npm run typecheck`.
6. Run `npm run lint`.
7. Run `npm run build`.
8. Validate metadata archive:
   `node scripts/validate-s2-metadata-archive.js --dir "<metadata-dir>" --image-cid bafybeifz4gwsvqbypeki3wwwmmvng2z2lusqjndevfqemzibisk266vepq`
9. Export OpenSea-compatible wallet-list files with `npm run export:opensea-wallet-list -- --input <source> --stage <stage> --limit <limit>`.
10. Validate/upload wallet lists in OpenSea/SeaDrop where supported.
11. Store source checksums and OpenSea wallet-list upload records in the deployment notes.

## Testnet Deployment

Use Monad testnet first.

```bash
DEPLOYER_PRIVATE_KEY=... \
MONAD_TESTNET_RPC_URL=... \
MONAD_TESTNET_DEPLOY_CONFIRMATION=DEPLOY_DYOOR_TESTNET_ONLY \
SEADROP_ADDRESS=... \
DYOOR_TREASURY_ADDRESS=... \
DYOOR_ROYALTY_RECEIVER=... \
DYOOR_ROYALTY_BPS=... \
DYOOR_BASE_URI=... \
DYOOR_CONTRACT_URI=... \
forge script script/DeployDYOORSeason2SeaDrop.s.sol --rpc-url "$MONAD_TESTNET_RPC_URL" --broadcast -vvvv
```

Then verify:

```bash
DYOOR_S2_CONTRACT_ADDRESS=... \
MONAD_TESTNET_RPC_URL=... \
MONADSCAN_API_KEY=... \
SEADROP_ADDRESS=... \
CHAIN_ID=10143 \
EXECUTE_VERIFY=1 \
node scripts/verify-dyoor-s2-monadscan.js
```

Then validate:

```bash
DYOOR_S2_CONTRACT_ADDRESS=... \
MONAD_TESTNET_RPC_URL=... \
node scripts/validate-dyoor-s2-testnet.js
```

Only set `EXECUTE_TESTNET_VALIDATION=1` for owner-approved testnet transactions.

## Mainnet Deployment

The mainnet deployment script is separate from the testnet script:

```text
script/DeployDYOORSeason2SeaDropMainnet.s.sol
```

It only runs on Monad mainnet chain ID `143`, requires
`MONAD_MAINNET_DEPLOY_CONFIRMATION=DEPLOY_DYOOR_MAINNET_OPENSEA_EXPERIMENT`,
requires a non-empty `DYOOR_BASE_URI`, and rejects any `SEADROP_ADDRESS` with no
deployed bytecode on Monad mainnet.

The local SeaDrop 1.0 support table does not list Monad. On 2026-07-14,
`eth_getCode` against `https://rpc.monad.xyz` confirmed bytecode at the canonical
SeaDrop 1.0 address:

```text
0x00005EA00Ac477B1030CE78506496e8C2dE24bf5
```

This confirms the address is deployed on Monad mainnet, but it does not prove
OpenSea Studio will expose Drop attachment/configuration for the manually
deployed D.Y.O.O.R contract. Treat the first mainnet deployment as a controlled
OpenSea attachment experiment.

Mainnet deployment remains blocked until:

- official Monad mainnet SeaDrop address is confirmed
- OpenSea custom-contract onboarding result is known
- owner wallet or multisig is final
- treasury and royalty values are final
- contract URI and base URI are final
- independent review is complete
- owner explicitly approves mainnet deployment

Dry run:

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

Broadcast:

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

Mainnet verification can use `scripts/verify-dyoor-s2-monadscan.js` with
`CHAIN_ID=143` only after deployment and with
`MAINNET_VERIFY_CONFIRMATION=VERIFY_DYOOR_MAINNET`.

## Post Deploy

- Save deployment artifact from `broadcast/` and `deployments/dyoor-s2-seadrop.latest.json`.
- Confirm `owner`, `pendingOwner`, `treasury`, royalty settings, base URI, contract URI, and allowed SeaDrop addresses.
- Confirm `maxSupply()` returns `3333`.
- Confirm `AIRDROP_RESERVE()` returns `610`.
- Confirm `SEADROP_MAX_SUPPLY()` returns `2723`.
- Confirm `/admin/airdrop` reads the contract status with the owner wallet.
- Confirm mint website shows OpenSea pending or the verified OpenSea Drop URL.
- Confirm OpenSea onboarding status manually before claiming OpenSea mint availability.
- Confirm the regular whitelist was configured in OpenSea/SeaDrop, not as a DYOOR contract root.
