# Monad D.Y.O.O.R Droid Deployment Report

Date: 2026-08-12

Decision: **hold production deployment**. The common integration, local simulations, live Monad fork test, and read-only mainnet preflight are complete. No private key was read and no transaction was signed or broadcast.

## Outcome

The existing Monad D.Y.O.O.R collection can receive deterministic Droid Accounts without changing the NFT contract:

```text
(143, 0x349D…103A, tokenId)
             |
             v
canonical ERC-6551 registry + immutable DroidAccountV1
             |
             v
deterministic account controlled by current ownerOf(tokenId)
```

Trait rerolls, layers, token IDs, metadata URLs, Energy balances, Season 1 staking, and Robinhood Droid Accounts remain unchanged. The account binds identity, not mutable traits, so rerolls continue to work.

## Existing contracts left untouched

| Component | Address | Result |
| --- | --- | --- |
| Monad D.Y.O.O.R Season 2 NFT | `0x349D8eb480c92cF75371fbA5C6344A4d11b9103A` | no upgrade, migration, remint, or configuration call |
| Monad Energy Bank | `0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767` | no ledger/economic change |
| Season 1 D.Y.O.O.R NFT | `0x2C79c9E233fEa4b4DcFE6561D9209dc292cD932f` | no change |
| Ascension staking | `0xf9611226c1CcCcCa37951938d6f358D3d5106549` | no change; remains Season 1-only custody |
| Robinhood Droid contracts | existing chain-4663 addresses | no change; deterministic addresses remain identical |

The live Season 2 collection is a direct ERC-721 deployment, not an EIP-1967 proxy. It had supply `1,038`, total minted `1,096`, and 58 burned tokens at refreshed preflight block `95,362,095`.

## New Monad deployments required

Three additive contracts/transactions are required for account V1:

1. the exact canonical ERC-6551 registry transaction through Nick's deterministic factory, producing `0x000000006551c19487814612e58FE06813775758`;
2. immutable, adminless `DroidAccountV1`;
3. immutable, adminless `DroidAccountRegistry`, configured with the canonical registry, collection `0x349D…103A`, the new implementation, chain ID `143`, and zero salt.

The canonical registry is currently absent on Monad. Its expected runtime hash is `0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735` and must be verified before proceeding.

No parent NFT, Energy, staking, economic module, asset router, bridge, session-key module, or agent contract needs deployment in this release. Chain-local reward/strategy/treasury contracts remain deferred and disabled.

## Account implementation equivalence

Blockscout's verified Robinhood `DroidAccountV1` source and every imported local source match byte-for-byte, with Solidity 0.8.24, optimizer 200, `viaIR=true`, and Paris EVM target.

Raw deployed bytecode hashes differ because `_implementation` and `_deploymentChainId` are constructor-patched immutables and the compiler metadata digest is build-context dependent. After normalizing those immutable slots and stripping CBOR metadata, executable logic matches exactly:

- creation executable hash: `0x4c38f02a77dd8118223132168113d668fe237d8e49c7637e5d39d8aec6687740`;
- runtime template hash: `0x8a2bfc57a2bbb21d855650c13e70bfdb3e14cc2fb528f8578a070ae5d8b669fe`.

The Monad preflight now refuses to continue if either hash changes.

## Controller and staking decision

Season 2 authority is direct current `ownerOf(tokenId)`.

At preflight, Ascension held 503 Season 1 NFTs and zero Season 2 NFTs. Applying its `stakeInfo(tokenId)` records to Season 2 would be unsafe because identical token IDs can exist in both collections. No staking override is used.

If a future custody system accepts Season 2, support requires a new versioned resolver bound to the exact `(chainId, collection, stakingContract)` tuple. It must not silently alter V1 authority.

## Frontend and service migration

The website change is additive:

- common chain-qualified APIs at `/api/droid-accounts` and `/api/droid-economy`;
- Monad squad at `/monad/droids` and profile at `/monad/droids/[tokenId]`;
- existing shared Droid Account, portfolio, Inventory, Security, and economic UI components;
- actual NFT artwork from `/api/dyoor-world/pfp-image/{tokenId}`;
- MON, WMON, and USDC-aware presentation, with no fabricated fiat values;
- Energy displayed as 18-decimal progression utility, never money;
- transfer warning and explicit parent-burn lockout warning;
- official Trait Lab burn blocked when account reads are incomplete or the Droid Account is active/funded.

No database migration is required for account V1. Existing economic records are already keyed by `chainId + collectionAddress + tokenId`.

## Environment variables

Keep these blank until the three deployments are verified:

```text
MONAD_DROID_IMPLEMENTATION_ADDRESS=
MONAD_DROID_REGISTRY_ADDRESS=
NEXT_PUBLIC_MONAD_DROID_IMPLEMENTATION_ADDRESS=
NEXT_PUBLIC_MONAD_DROID_REGISTRY_ADDRESS=
```

Keep both account feature gates false until the canary succeeds:

```text
MONAD_DROIDS_ENABLED=false
NEXT_PUBLIC_MONAD_DROIDS_ENABLED=false
CROSS_CHAIN_BRIDGE_ENABLED=false
DROID_AGENT_ENABLED=false
```

Use a private server RPC only in `MONAD_DROID_RPC_URL`; do not expose it through public environment variables. No deployer private key belongs in `.env.example`, source control, or an application runtime.

## Roles and trust

The three account-layer contracts have no admin role. The canonical registry is ownerless; `DroidAccountV1` and the facade are immutable. The project cannot withdraw a user's Droid assets or replace the account implementation.

The deployer only pays deployment gas and receives no persistent privilege. A multisig-controlled deployment workflow is still recommended for operational review, even though no admin role remains afterward.

## Deployment sequence

1. Freeze and independently review the exact artifacts and this checkpoint.
2. Refresh `npm run preflight:monad:droid-accounts` immediately before execution.
3. Fund only the approved deployer with the reviewed gas budget.
4. Send the exact standard canonical-registry transaction through Nick's factory.
5. Require code at the canonical address and compare the runtime hash.
6. Deploy `DroidAccountV1`; record transaction, block, creation code, runtime code, compiler input, and address.
7. Deploy `DroidAccountRegistry(canonical, collection, implementation, 143, bytes32(0))`.
8. Verify source and read every immutable getter. Confirm `IMPLEMENTATION_VERSION() == 1`.
9. Confirm counterfactual account computation for token 1 from both canonical and facade reads.
10. Configure server/public addresses while both Monad flags remain false.
11. Use a project-controlled existing NFT for one activation canary; verify account binding and owner send/withdraw.
12. Re-run website, API, fork, ownership-transfer, artwork, Energy, and Trait Lab burn-safety tests.
13. Enable server and public Monad gates only in a separate approved release.

Do not fund a counterfactual account through the official UI before activation and code verification.

## Gas and MON requirement

The final read-only preflight used live Monad `eth_estimateGas` at block `95,362,095`:

| Transaction | Estimated gas |
| --- | ---: |
| canonical ERC-6551 registry | 179,650 |
| `DroidAccountV1` | 1,188,142 |
| immutable facade | 542,514 |
| total | 1,910,306 |

At the observed gas price of `202,000,000,000` wei, the three deployments estimate to `0.385881812 MON`. The preflight's conservative 3× buffer is `1.157645436 MON`.

Practical answer: budget about **1.16 MON for deployment gas**, then refresh immediately before signing. This excludes any optional canary funds deposited into a Droid Account. No MON has been spent by this work.

## Verification status

- focused JavaScript account/economy/Monad suites: 19 passed, 0 failed;
- strict TypeScript: passed;
- application ESLint: passed;
- local Solidity Account V1 suite: 21 passed, 0 failed;
- live Monad fork: 1 passed, 0 failed;
- read-only mainnet preflight: passed;
- independent audit: not completed.

The machine-readable checkpoint is `deployments/monad/droid-accounts-preflight-143.json`.

## Hold point

No deployment is authorized by this report. Production execution remains blocked pending independent security review, frozen artifact approval, refreshed fee simulation, approved deployer funding, and explicit post-report authorization.
