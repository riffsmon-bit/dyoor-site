# Robinhood economic activation plan

Status: **PRE-MINT / AUDIT REQUIRED / NOT AUTHORIZED**

Robinhood Chain is chain 4663. The deployed HoodYØØR collection is `0x8277F8126722B11D7b44C5C453bcF62A78AAFa25`. The refreshed read-only checkpoint confirms zero supply, mint not started, the expected collection bytecode, and existing Account V1 wiring. This plan does not mint, deploy, configure, fund, or activate anything.

## Frozen modules

The reproducible freeze at commit `b7c22ce11a9da833c2900c68937d20c547bf5f8a` contains:

1. `HoodYoorDroidRegistry`
2. `HoodYoorAssetRegistry`
3. `HoodYoorRewardsDistributor`
4. `HoodYoorRevenueVault`
5. `HoodYoorStrategyRegistry`
6. `HoodYoorAchievementRegistry`

Every module is undeployed, unconfigured, unaudited by an independent party, and not owner-approved. Exact source/ABI/constructor/bytecode/storage/link/immutable hashes are in `deployments/release-freeze/contract-artifacts.json`.

The Revenue Vault separates Project Treasury, Droid Rewards, and Other Approved Allocation. Its constructor and every later allocation update must total exactly 10,000 bps. Its canonical artifact hash is `0x2a4969124e9f6a0afdd25c401554e627e9db31022e9c53656778aac2badc248d`; it requires priority independent review.

## Current authority risk

Collection owner, treasury, and royalty receiver are the same EOA: `0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6`. No transfer or fund movement occurred. Before material mint/revenue operations, evaluate the separate Safe migrations in `docs/robinhood-eoa-safe-migration.md`.

Recommended, not approved:

- Governance Safe: 3-of-5;
- Treasury Safe: 3-of-5;
- optional restricted Operations Safe: 2-of-3;
- narrow pauser with no withdrawal/seizure authority.

## Before NFT mint

- complete independent audit and resolve/retest every critical/high finding;
- approve the collection administration, treasury, royalty, and economic role model;
- approve Safe signers, thresholds, backups, and recovery;
- keep the six economic modules undeployed unless separately justified and authorized;
- keep rewards, strategies, shared treasury, agents, and bridges off;
- keep approved assets, sources, and strategies empty;
- authorize mint through its own release process only.

## At mint

- reverify full collection address, bytecode, owner, treasury, royalties, SeaDrop/sale state, and Account V1 wiring;
- verify first token ownership, metadata/artwork, Energy, transfer, reroll, and account derivation;
- confirm identity uses `4663 + collection + tokenId` and cannot collide with Monad;
- do not automatically deploy or fund economic modules.

## Before economic deployment

Owner must separately approve:

- exact six artifact hashes and independent audit report;
- constructor values and dependency addresses;
- Governance/Treasury/Operations/Emergency Safes and least-privilege roles;
- gas ceilings and funding source;
- treasury split and destinations;
- assets, revenue sources, reward policy, strategies, routers/adapters, and canary caps;
- post-deploy verification and pause procedures;
- explicit deployment authorization.

The recommended launch split is 6,000 / 3,000 / 1,000 bps, but all three values and destinations remain UNSET. Assets, sources, strategies, and Safe addresses remain empty/UNSET.

## Separately gated rollout

1. Deploy and verify account/economic infrastructure under a distinct approval.
2. Run one controlled Droid canary.
3. Enable general Droid activation separately.
4. Enable portfolio display.
5. Fund a capped reward pool.
6. Enable a weekly/biweekly reward epoch.
7. Pilot one reviewed strategy.
8. Expand strategies only after observation/reconciliation.
9. Consider bounded agents only in a future audited release.

Deployment does not authorize role configuration, funding, claims, strategies, mint, agents, or bridges. Production deployment commands remain absent from the authorization manifests.
