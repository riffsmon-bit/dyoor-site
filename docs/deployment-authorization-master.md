# HoodYØØR dual-chain deployment authorization master

Release state: **BLOCKED**
Source state: **dirty / no clean release commit**
Artifact state: **ARTIFACT FREEZE BROKEN**
Independent audit: **NOT STARTED**
Deployment, configuration, and activation: **NOT AUTHORIZED**

This is the owner-facing control plane for Monad D.Y.O.O.R and Robinhood Chain HoodYØØR. It records what a later authorization would cover, but it deliberately cannot authorize or broadcast a transaction.

## Why the package stopped

The full Foundry candidate set was rebuilt from the current worktree. Every candidate source hash, creation-bytecode hash, and runtime-template hash matched the prior freeze. Six whole artifact JSON SHA-256 values did not. The pre-existing freeze verifier failed on `DroidAccountV1` as designed.

The worktree is also not clean: at capture it had 22 modified, 8 deleted, and 113 untracked entries, including production Droid contracts and application code. Finally, the legacy Robinhood SeaDrop preflight unexpectedly loaded local deployer key material and instantiated an unconnected ethers `Wallet` to derive an address. It did not print the key, sign, or broadcast, but the access itself violated this task’s boundary. The preflight has since been made keyless and the package verifier enforces that boundary; the historical incident remains recorded.

Under the owner’s absolute release rule, these facts require `ARTIFACT FREEZE BROKEN` and prevent production authorization preparation. The detailed evidence is in `docs/release-source-snapshot.md` and `deployments/authorization/release-source-snapshot.json`.

## Four independent actions

| Stage | Meaning | Current state |
| --- | --- | --- |
| A | Code and exact artifact approval | Blocked |
| B | Contract deployment | Not approved |
| C | Economic/governance configuration | Not approved |
| D | Feature activation | Not approved |

Approval never cascades. Stage A does not authorize B; B does not authorize C; C does not authorize D.

## Monad

Network: Monad Mainnet, chain 143. Existing collection: `0x349D8eb480c92cF75371fbA5C6344A4d11b9103A`. The NFT, token IDs, metadata, Energy, staking, rerolls, and layers remain untouched.

| Proposed transaction | Frozen/rebuilt evidence | State |
| --- | --- | --- |
| Canonical ERC-6551 Registry | reviewed payload `e3d6a2f9…d41a`; expected runtime `da1d5b06…6735` | Audit required |
| Immutable `DroidAccountV1` | creation `2a34579d…41ae1`; runtime template `b94e6bca…19b0`; artifact JSON drifted | Audit required |
| Immutable collection registry | creation `92507398…0215`; runtime template `80c3d640…6070`; artifact JSON drifted | Audit required |

Read-only checkpoint at block 95,373,384:

- estimated gas: 1,910,306;
- observed gas price: 202 gwei;
- estimate: 0.385881812 MON;
- planning-only 3× reserve: 1.157645436 MON;
- canary funding excluded.

These are refreshed estimates, not guaranteed fees or an approved budget. Refresh again immediately before any future approval.

The exact proposed sequence and human-readable previews are in `deployments/authorization/monad-transactions.json`. `FROM`, implementation/facade CREATE addresses, maximum authorized gas, and owner approvals remain unset. Stop after the three infrastructure deployments and all post-deploy assertions; account activation is a separate action.

Recommended activation is lazy, with hybrid sponsorship only for capped campaigns. The canary token, two controlled wallets, MON cap, and test asset remain unset. The complete no-execution procedure is in `docs/monad-canary-runbook.md`.

## Robinhood Chain

Network: Robinhood Chain, chain 4663. The full HoodYØØR address is `0x8277F8126722B11D7b44C5C453bcF62A78AAFa25`.

The latest keyless economic checkpoint found the expected runtime, zero supply, no reserve mint, reveal off, secondary trading off, and existing Account V1 wiring intact. The collection owner, treasury, and royalty receiver are the same EOA (`0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6`), not a Safe. No mint or configuration changed in this task.

Six modules remain undeployed:

| Module | Creation hash | Runtime template hash | State |
| --- | --- | --- | --- |
| Droid Registry | `95a023ee…a924` | `0fbaaa97…e9e6` | Audit required |
| Asset Registry | `97bcb5d3…f7f` | `0ca3ab50…596e` | Audit required |
| Funded Reward Distributor | `5f1d55f7…17697` | `04af2b85…37f8d` | Artifact drift; audit required |
| Updated Revenue Vault | `c5ff05ca…e431` | `5142e148…c8f` | Artifact drift; audit required |
| Strategy Registry | `6d49ec96…4ce5` | `393a7bf6…b261` | Artifact drift; audit required |
| Achievement Registry | `1c0f870a…ca2b` | `a1ffcf88…5036` | Artifact drift; audit required |

The current constructor gas benchmark totals 12,665,676. At the keyless read-only max-fee checkpoint of 102,296,000 wei, that is approximately 0.001295647992096 ETH; a planning-only 3× constructor reserve is 0.003886943976288 ETH. Safe overhead, configuration transactions, and final constructor calldata are excluded. No ETH budget is approved.

Every Safe, role, address, source, asset, reward parameter, strategy, adapter, and gas maximum remains unset/unapproved. The updated Revenue Vault must pass independent review before deployment. See `deployments/authorization/robinhood-transactions.json` and `docs/robinhood-economic-activation-plan.md`.

## Governance proposal

Prefer a 3-of-5 governance/treasury Safe. A 2-of-3 restricted operations Safe is an early-launch alternative. Never assign unrestricted treasury authority to a 1-of-1 wallet or backend hot wallet.

Suggested separation:

- `DEFAULT_ADMIN`: governance Safe;
- treasury authority: Treasury Safe;
- reward, strategy, and asset configuration: governance or restricted configuration Safe;
- achievement issuance: lower-risk restricted Safe only under approved policy;
- `PAUSER`: emergency Safe, optionally plus a separately approved restricted emergency signer.

The actual contracts expose more granular roles: `COLLECTION_MANAGER_ROLE`, `ASSET_MANAGER_ROLE`, `EPOCH_MANAGER_ROLE`, Revenue Vault source/allocation/release/destination managers, `STRATEGY_MANAGER_ROLE`, achievement manager/issuer, and module `PAUSER_ROLE`. Every holder remains UNSET. The constructor initially grants operational roles to `initialAdmin`; a future deployment plan must atomically or sequentially grant the approved least-privilege holders and revoke temporary deployer/initial-admin operational roles after verification.

Emergency pause is immediate and grants no withdrawal or seizure authority. Sensitive non-emergency changes should normally wait 24–72 hours. The candidate contracts enforce a 48-hour default-admin transfer delay; the vault enforces a 48-hour atomic destination delay. Its allocation changes are not timelocked, so proposed per-bucket bounds and delay remain governance policy only.

## Treasury proposal

Recommended launch split, not approved:

- 6,000 bps Project Treasury;
- 3,000 bps Droid Rewards;
- 1,000 bps Other Approved Allocation.

Potential 60–90-day target, not automatic: 5,500 / 3,500 / 1,000 bps. The exact total must always be 10,000 bps. Rewards are explicitly funded; Energy remains non-financial progression. See `docs/treasury-policy.md`.

## Safe commands

These commands do not contain a broadcast flag and do not need a private key:

```sh
cd contracts/hoodyoor && forge build --force --offline
npm run preflight:droid-os:freeze
npm run test:monad:droid-accounts
npm run test:hoodyoor:economy
npm run test:monad:droid-accounts:fork
npm run test:robinhood:droid-accounts:fork
npm run preflight:monad:droid-accounts
npm run preflight:hoodyoor:economy
npm run preflight:deployment-authorization
```

The legacy `npm run preflight:robinhood:seadrop-v2` has now been made keyless, but it intentionally cannot satisfy credential/reveal-secret launch gates and is not needed for this economic authorization package. Production deployment commands are withheld while the freeze is broken. This is stricter than merely making broadcast opt-in and follows the explicit stop rule.

General `npm test` and `npm run build` are not labeled keyless in this repository: Hardhat imports `dotenv/config`, and Next automatically reported loading `.env.local`/`.env`. They were used for regression validation and did not print, sign, or broadcast, but the environment-access incident is recorded. Future release validation should use a deliberately secret-free environment or first move deployment credentials out of application-root env files through a separately reviewed operational change.

Explorer verification templates are stored with each transaction plan, but their address and ABI-encoded constructor placeholders must be owner-reviewed after addresses are final. Verification is not deployment authorization.

## Audit gate

Every artifact starts at `NOT STARTED`. The allowed audit states are `NOT STARTED`, `IN PROGRESS`, `PASSED`, `PASSED WITH FINDINGS`, and `FAILED`. Findings must record ID, severity, contract, description, fix status, whether the artifact changed, and whether independent retest completed.

Any critical/high finding blocks production. Any code or bytecode fix invalidates the old hash and approval. The already recorded unaudited-risk waiver for earlier Robinhood work does not satisfy this package’s independent-audit gate.

## Feature state

All deployment approval booleans are false. Monad/Robinhood rewards and strategies are off. Shared treasury display is not approved. Agents and bridges are disabled. No reward vault was funded and no funds moved.

| Component | Release state |
| --- | --- |
| Monad registry / Account V1 / collection registry | `AUDIT REQUIRED` |
| Monad canary | `OWNER DECISION REQUIRED` |
| Monad rewards / strategies | `BLOCKED`, inactive |
| Robinhood NFT | deployed, pre-mint |
| Six Robinhood economic modules | `AUDIT REQUIRED` |
| Robinhood rewards / strategies | `BLOCKED`, inactive |
| Agent | disabled |
| Bridge | disabled |

## Validation

- Forced Foundry rebuild: passed compilation of 86 files; artifact freeze failed on whole-file drift as described above.
- Solidity: 94 passed, 0 failed, 2 live-fork tests skipped in the offline aggregate.
- Live forks: Monad 1/1 passed after one transient public-RPC DNS failure; Robinhood 1/1 passed.
- Root Node suite: 201/203 passed. The two failures are the old launch-manifest and SeaDrop-v2 artifact sentinels rejecting the rebuilt artifact-file hashes. They were deliberately not weakened or bypassed.
- Root TypeScript, ESLint, and production build: passed.
- Game: 45/45 tests plus typecheck/lint/build passed; Vite retained its existing large-chunk warning.
- Discord: 50/50 tests plus typecheck/lint/build passed.
- Authorization package: 3/3 tests and offline verifier passed in `PASS_BLOCKED` state.
- Keyless Monad and Robinhood live preflights: passed. Keyless SeaDrop offline preflight remained blocked as designed.

## Exact next action

Review and create a clean release commit, rebuild twice with the pinned toolchain, explain the artifact-container hash changes, freeze a new manifest, and submit those exact hashes for independent audit. Do not deploy, configure, fund, mint, or activate anything.
