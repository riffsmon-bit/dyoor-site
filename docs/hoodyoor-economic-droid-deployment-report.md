# HoodYØØR Economic Droid Deployment Report

Date: 2026-08-11

Decision: **hold production deployment**. The implementation is staged for review, but no transaction has been signed, broadcast, or simulated with an authorized production signer. Rewards and strategies remain disabled.

## Existing production contracts that remain untouched

Robinhood Chain mainnet, chain ID 4663:

| Component | Existing address | Action |
| --- | --- | --- |
| HoodYØØR NFT | `0x8277F8126722B11D7b44C5C453bcF62A78AAFa25` | No change or redeployment |
| Energy Bank | `0x9bA9aa6c6A1CB04bc0477E90f4D93214c6b1D7c3` | No change or economic conversion |
| Reroll V2 | `0x6cf24a0119b7286ad88855Baa9CB220DF628FD11` | No change; rerolls remain compatible |
| Droid Account implementation V1 | `0x0FFDc6ACb41D39ee7b535026202AA8fe0054F52A` | No change |
| HoodYØØR account resolver/facade V1 | `0x190602Aa70199ec3623ad3bc97a10B534b26fE48` | Register as immutable version 1 in new registry |
| Canonical ERC-6551 registry | `0x000000006551c19487814612e58FE06813775758` | No change |

No existing contract needs a proxy upgrade, redeployment, migration, remint, or storage mutation. Existing token IDs, ownership, artwork/metadata, Energy, trait rerolls, staking, holder verification, and Droid Account control semantics are preserved.

Monad chain ID 143 also receives no transaction in this release. Its native D.Y.O.O.R collections and Energy/staking systems remain untouched. Monad Droid-wallet enablement is deferred until a separate chain-local ERC-6551 account implementation and resolver pass review.

## New Robinhood deployments required for economic V1

Six independent, non-proxy companion contracts are required:

1. `HoodYoorDroidRegistry(initialAdminSafe)`
2. `HoodYoorAssetRegistry(initialAdminSafe)`
3. `HoodYoorRewardsDistributor(initialAdminSafe, droidRegistry, assetRegistry)`
4. `HoodYoorRevenueVault(initialAdminSafe, assetRegistry, treasurySafe, rewardsDistributor, otherAllocationSafe, treasuryBps, rewardBps, otherBps)`
5. `HoodYoorStrategyRegistry(initialAdminSafe, droidRegistry, assetRegistry)`
6. `HoodYoorAchievementRegistry(initialAdminSafe, droidRegistry)`

They are additive because the deployed account facade already supplies the deterministic address, activation state, controlling collection, and local chain ID needed by the new economic registry.

No asset router, DEX adapter, Robinhood asset adapter, Monad adapter, bridge, session key, or agent gateway is deployed in V1.

## Required decisions before a deployment can be authorized

The repository intentionally does not guess these production values:

- initial delayed-admin Safe address and threshold;
- treasury Safe address and threshold;
- project-treasury/reward/other-approved allocation in basis points, totaling exactly 10,000;
- distinct role holders for collection, asset, strategy, achievement, source, allocation, release, destination, epoch, and pause operations;
- first approved revenue-source contracts/wallets;
- first approved settlement assets after address/decimals/behavior review;
- first strategy metadata and allocation policy;
- public reward-weight policy, input blocks, caps, exclusions, and dispute window;
- independent auditor/reviewer sign-off;
- maximum first canary funding amount.

Until those values are approved, constructor calldata and a trustworthy ETH requirement cannot be finalized.

## Exact migration and configuration sequence

1. Freeze a reviewed source snapshot and reproduce the release artifacts with the Foundry release pipeline: Solidity 0.8.24, optimizer 200 runs, `via_ir=true`, and Paris EVM target. The checksums in `deployments/robinhood/pre-mint-release-plan.json` are authoritative for this candidate.
2. Run the read-only preflight against Robinhood chain ID 4663. Compare all existing dependency code hashes with the reviewed checkpoint.
3. Run fork/fork-equivalent simulations using the final Safe addresses, split, assets, and roles. Record per-transaction gas used and set a conservative ETH budget from current fee data.
4. Deploy the Droid registry and asset registry from the approved deployer/Safe workflow.
5. Deploy the rewards distributor against those immutable registry addresses.
6. Deploy the revenue vault against the asset registry, treasury Safe, distributor, and approved split.
7. Permanently call `rewardsDistributor.configureFundingVault(revenueVault)` once.
8. Deploy the strategy and achievement registries.
9. Register HoodYØØR collection `0x8277…Fa25`, then register account resolver V1 `0x1906…fE48` as immutable account version 1.
10. Configure only reviewed native/ERC-20 assets. Never identify an asset by ticker alone.
11. Configure reviewed revenue sources and generic strategy version(s). Do not enable an execution adapter.
12. Grant role-specific Safe addresses, verify each role on-chain, and renounce/revoke every unnecessary deployer role. Initiate/accept delayed default-admin transfer where applicable.
13. Verify source for every module and compare deployed runtime bytecode with the frozen artifact.
14. Apply the additive database migration and configure contract addresses, leaving reward/strategy feature flags false.
15. Deposit a capped canary amount, verify the vault split, release only that reward share, and publish one small reviewed canary epoch.
16. Test claim-to-Droid, duplicate-claim rejection, wrong-owner rejection, and NFT-transfer-before-claim behavior with a test-owned production NFT.
17. Reconcile contract balances, reservations, events, manifests, and the Droid Account receipt.
18. Enable rewards and strategies in a separate, explicit website release only after sign-off. Keep bridge, agent, Monad Droids, and shared treasury disabled.

## Roles and trust configuration

Every new module uses `AccessControlDefaultAdminRules` with a two-day default-admin transfer delay. The vault also imposes a two-day destination-change delay. Recommended separation:

| Role group | Recommended holder |
| --- | --- |
| Default admin | high-threshold protocol Safe |
| Pause roles | security Safe with a documented incident process |
| Collection/asset/strategy/achievement managers | configuration Safe |
| Achievement issuer | constrained campaign Safe or reviewed issuer service |
| Source/allocation/destination managers | treasury governance Safe |
| Release manager | treasury operations Safe with transaction limits/process |
| Epoch manager | rewards operations Safe after independent manifest review |
| Treasury destination | treasury Safe, never an EOA |

The deployer must not remain a privileged personal EOA. No role can execute from a Droid Account; the epoch manager can deny or misallocate future rewards through a bad root but cannot withdraw distributor funds.

## Environment and data changes

Contract addresses remain blank until verified deployments exist:

```text
HOODYOOR_ECONOMY_DROID_REGISTRY_ADDRESS=
HOODYOOR_ASSET_REGISTRY_ADDRESS=
HOODYOOR_STRATEGY_REGISTRY_ADDRESS=
HOODYOOR_REVENUE_VAULT_ADDRESS=
HOODYOOR_REWARDS_DISTRIBUTOR_ADDRESS=
HOODYOOR_ACHIEVEMENT_REGISTRY_ADDRESS=
```

Server and public reward/strategy flags both remain false. `CROSS_CHAIN_BRIDGE_ENABLED` and `DROID_AGENT_ENABLED` remain false and are additionally code-locked. No secret, deployer key, seed phrase, or private RPC credential belongs in source control.

Apply `supabase/migrations/202608110001_hoodyoor_economic_droids.sql` only after reviewing it against the target database. It is additive and enables row-level security; it never makes database balances authoritative.

## Test and verification status

Completed locally:

- Solidity economic suite: 15 passing tests, including current-owner transfer behavior, claim replay, malformed allocation bounds, inactive account, safe native/ERC-20 accounting, fee-on-transfer rejection, malicious callbacks, pause behavior, strategy versioning, capped achievements, and excess-only recovery.
- JavaScript Droid suites: 13 passing checks covering existing Account V1 deployment safety, deterministic identity, reward leaf binding, no-broadcast tooling, feature locks, UI warnings, Energy separation, and documentation hold points.
- Repository-wide Hardhat/Node regression: 189 passing, 0 failing. The six economic sources use scoped `viaIR` Hardhat overrides; legacy compiler profiles are unchanged.
- Strict TypeScript: passing.
- Full HoodYØØR Foundry regression: 87 passing, 0 failing, with one opt-in live-fork test skipped because no fork URL was supplied.
- Full application ESLint: passing with no warnings or errors.
- Next.js production build: passing, including the new Droid economy profile, admin, API, and multi-chain dashboard routes.

The independent audit and final constructor-input simulation remain release gates.

## Read-only mainnet preflight

`scripts/preflight-hoodyoor-economic-droids.js` has no signer, private-key read, transaction construction, or broadcast mode. It refuses to run if deployment execution, bridge, or agent gates are enabled. It verifies:

- chain ID and latest block;
- bytecode and runtime hashes at every existing dependency;
- final compiler/runtime artifacts and the EIP-170 size limit;
- that new address variables are still unset;
- current gas fee data for budgeting.

The final machine-readable checkpoint is `deployments/robinhood/hoodyoor-economic-droid-preflight-4663.json`. The read-only run passed at Robinhood block `34,194,538` (UTC `2026-08-12T03:13:49.000Z`):

- all six existing dependency code hashes matched the audited checkpoint;
- all six new address variables were blank (`not-deployed`);
- rewards, strategies, shared treasury, bridge, and agent locks were confirmed disabled;
- no private key was read and no broadcast was attempted;
- final runtimes ranged from 6,855 to 10,232 bytes, all below the 24,576-byte EIP-170 limit;
- refreshed observed gas price was 51,052,000 wei and `maxFeePerGas` was 101,264,000 wei at block 34,602,847.

Fee data is observational and must be refreshed immediately before any later approved execution.

## ETH budget

No ETH has been spent. The replacement-artifact Foundry gas report estimates `12,665,676` gas for the six constructors combined. At the refreshed preflight `maxFeePerGas` of `101,264,000` wei, constructor execution alone would be approximately `0.001282577014464 ETH`; a mechanical 3× constructor reserve is `0.003847731043392 ETH`.

That is not the complete production budget. The exact requirement is:

```text
sum(simulated gasUsed for 6 deployments + required Safe configuration calls)
× reviewed maxFeePerGas
+ Safe multisig execution overhead
+ capped canary deposit
+ contingency buffer
```

At the observed fee level, a provisional `0.003–0.005 ETH` gas-only operating balance should cover the six deployments, reviewed configuration calls, Safe overhead, and a substantial buffer. It excludes the separately approved canary reward deposit and is not a request to fund or deploy now.

Gas prices can change and final Safe/configuration gas depends on approved inputs. Refresh the simulation immediately before execution. Fund only the approved Safe/deployer on Robinhood Chain after the report is signed; never reuse the Droid reward pool as gas funding.

## Rollback and incident posture

Before feature enablement, rollback is simply leaving all flags off. After deployment but before funding, disable collections/assets/strategies and revoke sources. After funding, pause affected operations and reconcile; do not add a rescue path into Droid Accounts or silently replace an epoch root.

Because modules are immutable, a defect is handled by deploying a reviewed version and redirecting only future revenue after the timelock. Existing NFTs, Account V1 instances, rerolls, Energy, and owner withdrawals continue independently.

## Release hold point

Production deployment is blocked pending:

- named Safe addresses and role map;
- approved split/assets/sources/strategy policy;
- reviewed full-suite/build results and bytecode checkpoint;
- fork/fork-equivalent transaction simulations and ETH budget;
- independent security review;
- explicit user authorization after reviewing this report.

This document is a deployment plan, not deployment authorization.
