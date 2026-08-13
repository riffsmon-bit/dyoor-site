# HoodYØØR independent audit package

Audit status: **NOT STARTED**

Frozen source: `d272a55e78219e993015a2df31facc0f153af827`

Deployment targets: Monad Mainnet (143) and Robinhood Chain (4663)

This is the auditor handoff. Internal Codex review and automated tests do not satisfy the independent-audit gate.

## Scope

Monad immutable deployment candidates:

- exact canonical ERC-6551 Registry deterministic payload;
- `contracts/hoodyoor/src/droid/DroidAccountV1.sol`;
- `contracts/hoodyoor/src/droid/DroidAccountRegistry.sol`.

Robinhood undeployed economic candidates:

- `HoodYoorDroidRegistry`;
- `HoodYoorAssetRegistry`;
- `HoodYoorRewardsDistributor`;
- `HoodYoorRevenueVault`;
- `HoodYoorStrategyRegistry`;
- `HoodYoorAchievementRegistry`.

The already-deployed Robinhood NFT, Account V1 implementation/resolver, Energy Bank, reroll system, SeaDrop, and existing Monad NFT/Energy/staking contracts are integration dependencies, not new deployments. Auditors should review their trust/interface assumptions and live wiring, but any source-level expansion must be agreed explicitly.

## Frozen compiled artifacts

| Contract | Canonical artifact | Creation bytecode | Runtime bytecode |
| --- | --- | --- | --- |
| `DroidAccountV1` | `0x4eba037f280e898398606e6bc1d87716efdb0c12fe71bc0ac29c015a64cbeefe` | `0x2a34579dfc6df3b5d6b2e305974c8c6eddecf2e4a93d643ff575ed2de3941ae1` | `0xb94e6bca188572015060c77b916cb21b28906ad88b62eeac8cddeb55ec6199b0` |
| `DroidAccountRegistry` | `0xf8bdc2fe235dff19f14e42d0b436992bf246c373aafa87743eb7c7369cd0eeb9` | `0x925073987b0491bf8f3a2adbba10776fcfac2fafb783bc29139b6913df8b0215` | `0x80c3d64099222fe1d1975a1b7f606949d55268fdbd287a608f2a02f9665c6070` |
| `HoodYoorDroidRegistry` | `0xc7afc9cc62967e78bb7e8fe7a2e7b25b55de6055d0b795454cfd93f79a861b84` | `0x95a023ee34b6d3884f3ab15d2fdd7b35c10b75d06872bf2481aa7ff9bfb6a924` | `0x0fbaaa973cc4f6f78e226beccc71bf11406376a25e9efe32eb7877f5de97e9e6` |
| `HoodYoorAssetRegistry` | `0xc3bc8a00d98e6d6a2b5fa2c116b545c43270c891ecbcf577455e34590358e32a` | `0x97bcb5d329437756089e72c42d0bf05f1862183c3471fea8fdd35b1bb968df7f` | `0x0ca3ab50658dbc135259107c7bd5ff4bbd2eee92ab13b6c539cec3ca9de9596e` |
| `HoodYoorRewardsDistributor` | `0xfa5e1eae5cfd9322b550afa18a262b96a1a65a7c0f3c87805f89211bfa974455` | `0x5f1d55f77b38c4af10ca4eb1097bfb0af5d19a1bb48edca3f7baa13bad017697` | `0x04af2b8595073237e605ac440033bb72a9db54c81851501ad99a024a5a637f8d` |
| `HoodYoorRevenueVault` | `0x2a4969124e9f6a0afdd25c401554e627e9db31022e9c53656778aac2badc248d` | `0xc5ff05ca738ee6c6356e899f158d17b59e7348f7261a600c87251aa5b83ae431` | `0x5142e1488d8e3ac797183d345ef541c6bcf48520fd2e159342b50bce24156c8f` |
| `HoodYoorStrategyRegistry` | `0x1ea27dce24bd725b66e0fb2b40e99f965613baac444f2f35cb6c0a12581132c3` | `0x6d49ec96ccdff2eb43b3ef9f68d66a300f9e7f61623e96220e567c6dabee4ce5` | `0x393a7bf6ada8a62392bc1b7f6f9e31d9b991486b15f331917086fc891ad9b261` |
| `HoodYoorAchievementRegistry` | `0xd82fa2170fb888dff0d2679cee55be60704d0c41dcb0abfcbfb536ddb8ef6b75` | `0x1c0f870a1e463ee7b098c4bd10ca19e886065e03cadaa0b14c12434ca9e6ca2b` | `0xa1ffcf88e66297ac2067eeb87400a4a6b802bfbfdfbbc3d2bc27b70239265036` |

Full source, whole-artifact, ABI, constructor-schema, storage-layout, link-reference, and immutable-reference hashes are in `deployments/release-freeze/contract-artifacts.json`.

The canonical ERC-6551 Registry is frozen as external deterministic deployment material rather than a locally compiled artifact:

- target address `0x000000006551c19487814612e58FE06813775758`;
- factory `0x4e59b44847b379578588920cA78FbF26c0B4956C`;
- payload hash `0xe3d6a2f96a1664247da7003f047a21fb2dfccd984ac985fbf4d1cae6ed0ad41a`;
- expected runtime hash `0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735`.

## Compiler and reproducibility

Solidity `0.8.24+commit.e11b9ed9`, optimizer 200, via-IR, EVM `paris`, IPFS metadata hash, Foundry release profile. Builds A/B and a separate clean-room build match in full and canonical hashes. See:

- `docs/artifact-drift-analysis.md`;
- `deployments/release-freeze/reproducibility.json`;
- `deployments/release-freeze/clean-room-check.json`.

Final internal validation passed: root Hardhat/Node 207/207; aggregate Foundry 94 passed with two fork-only skips; dedicated Monad and Robinhood live forks 1/1 each; game 45/45; Discord 50/50; TypeScript, ESLint, and all three production builds. Both offline release verifiers returned `PASS_AUDIT_REQUIRED`. These results are evidence for audit, not a substitute for independent review; full details are in `docs/release-validation-report.md`.

## Architecture and authority

Monad Account V1 is immutable and resolves authority from current ERC-721 `ownerOf`. It has no project-admin withdrawal path and no agent/session-key path. The collection-specific immutable registry binds canonical registry, implementation, chain 143, collection, and zero salt. Review arbitrary owner execution, ERC-1271, receiver callbacks, reentrancy, nested/circular ownership rejection, replay/state nonce behavior, and transfer-time authority.

Robinhood economic modules use role-based administration. Review role grant/revoke/default-admin transfer, pause semantics, chain-qualified Droid identity, immutable resolver versions, asset validation, strategy future-only semantics, reward Merkle/epoch accounting, double-claim protection, live funding caps, expiration/release accounting, malicious/fee-on-transfer/reentrant tokens, and vault liabilities/recovery.

The Revenue Vault deserves priority review. It keeps Project Treasury, Droid Rewards, and Other Approved liabilities/releases separate, checks exact received amounts, retains rounding dust in Project Treasury, uses delayed atomic destination changes, and requires `treasuryBps + rewardBps + otherBps == 10,000`. Policy ranges are not enforced on-chain.

## Privileged roles and trust assumptions

Production role addresses are UNSET. Proposed model: 3-of-5 Governance Safe, 3-of-5 Treasury Safe, optional 2-of-3 restricted Operations Safe, and narrow emergency pauser. Constructors initially grant roles to the approved initial admin, so deployment/role handoff ordering is audit-relevant.

Admins must never gain Droid Account withdrawal authority. PAUSER must not seize assets. Rewards must be funded, chain-local, and capped by available balance. Energy is non-financial progression and cannot mint a financial claim. Agents and bridges are disabled.

The Robinhood collection currently concentrates collection owner, treasury, and royalties in one EOA. The migration is deferred and documented in `docs/robinhood-eoa-safe-migration.md`.

## Threat model and known issues

Use `docs/dual-chain-security-model.md`, `docs/droid-account-security.md`, and chain-specific security reports. Focus on access control, stale ownership, transfer invalidation, recursive ownership, reentrancy/callbacks, malicious assets, replay/chain confusion, reward manipulation/double claim, decimal/rounding errors, DoS, admin compromise, router/oracle risk, frontend/indexer spoofing, and immutable deployment mistakes.

Known release facts:

- independent audit has not started;
- no critical/high findings are currently claimed resolved by an independent party;
- the old artifact freeze is invalidated;
- prior release-candidate artifact drift was debug/AST metadata only and is exactly reconstructed;
- historical launch metadata drift from an added remapping is isolated by exact compiler profiles, with unchanged executable sections and exact whole-artifact reproduction;
- a prior preflight secret-loading incident was remediated and regression-tested;
- Robinhood Safe/role/assets/sources/strategies/split remain undecided;
- Monad deployer/canary/gas authorization remain undecided.

Any bytecode-changing fix creates a new candidate, new hashes, full retest, and new independent retest. Do not carry approval across artifact changes.

## Evidence index

- architecture: `docs/droid-os-core-spec.md`, `docs/droid-accounts.md`;
- threat model: `docs/dual-chain-security-model.md`, `docs/droid-account-security.md`;
- source snapshot: `docs/release-source-snapshot.md`;
- environment isolation: `docs/release-environment-separation.md`;
- validation: `docs/release-validation-report.md`;
- Monad candidate/canary: `deployments/monad/release-candidate-143.json`, `docs/monad-canary-runbook.md`;
- Robinhood candidate: `deployments/robinhood/pre-mint-release-plan.json`;
- exact proposed transactions: `deployments/authorization/*.json`;
- emergency plan: `docs/emergency-runbook.md`.
