# Monad D.Y.O.O.R Production Readiness

Date: 2026-08-12

Overall status: **READY FOR INDEPENDENT AUDIT; BLOCKED FOR DEPLOYMENT**. This report freezes preparation only. No signer, private key, transaction signature, or broadcast was used.

## Release scope

Existing native contracts remain untouched:

| Component | Address | Release action |
| --- | --- | --- |
| D.Y.O.O.R Season 2 | `0x349D8eb480c92cF75371fbA5C6344A4d11b9103A` | none |
| Monad Energy Bank | `0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767` | none |
| Season 1 D.Y.O.O.R | `0x2C79c9E233fEa4b4DcFE6561D9209dc292cD932f` | none |
| Ascension staking | `0xf9611226c1CcCcCa37951938d6f358D3d5106549` | none |

Only three additive account-layer deployments are in scope:

1. canonical ERC-6551 registry at `0x000000006551c19487814612e58FE06813775758`;
2. immutable `DroidAccountV1`;
3. immutable collection-specific `DroidAccountRegistry`.

No economic module, reward pool, strategy, bridge, agent, NFT change, metadata change, Energy change, staking change, or mass account activation is part of this release.

## Readiness audit

| Check | Result |
| --- | --- |
| Chain | Monad mainnet, chain ID 143 |
| Parent address/runtime | correct address; direct non-proxy runtime hash `0x2baa…15fd` |
| Supply checkpoint | 1,038 live / 1,096 minted / 58 burned at refreshed block 95,362,095 |
| Owner authority | direct current `ownerOf(tokenId)` |
| Staking boundary | Ascension held 503 Season 1 and zero Season 2 NFTs |
| Transfer authority | local and live-fork tests prove immediate old/new-owner transition |
| Determinism | canonical registry tuple plus immutable collection facade |
| Implementation | same reviewed executable logic as verified Robinhood V1 |
| Trait rerolls/layers | unchanged because identity excludes mutable traits |
| Parent burn | account fails closed; first-party burn is blocked for active/funded/incomplete reads |
| APIs | common chain-qualified `/api/droid-accounts` and `/api/droid-economy` |
| Wallet switching | generic client switches to chain 143 and verifies owner again before writes |
| Frontend | common profile/squad, real artwork, MON labels, partial-read and transfer/burn warnings |
| Independent audit | outstanding |

## Immutable artifact freeze

The machine-readable source of truth is [`deployments/monad/release-candidate-143.json`](../deployments/monad/release-candidate-143.json). Compiler: Solidity `0.8.24+commit.e11b9ed9`, optimizer 200, via-IR, Paris EVM, Foundry pipeline.

### Canonical registry

- deterministic factory: `0x4e59b44847b379578588920cA78FbF26c0B4956C`;
- expected address: `0x000000006551c19487814612e58FE06813775758`;
- exact deployment payload hash: `0xe3d6a2f96a1664247da7003f047a21fb2dfccd984ac985fbf4d1cae6ed0ad41a`;
- expected runtime hash: `0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735`;
- constructor arguments: none;
- persistent admin: none;
- address is deterministically knowable and must match before step 2.

### DroidAccountV1

- source: `contracts/hoodyoor/src/droid/DroidAccountV1.sol`;
- artifact SHA-256: `0x09328148e911aa9293953fbd25f5df66d704483e88991a7dc67c321a3804693e`;
- source SHA-256: `0x9fd1b2aff8c71502e19090ab93ef55fa2451f96db769640a2898e5359e2e64c2`;
- creation hash: `0x2a34579dfc6df3b5d6b2e305974c8c6eddecf2e4a93d643ff575ed2de3941ae1`;
- normalized creation executable hash: `0x4c38f02a77dd8118223132168113d668fe237d8e49c7637e5d39d8aec6687740`;
- normalized runtime template hash: `0x8a2bfc57a2bbb21d855650c13e70bfdb3e14cc2fb528f8578a070ae5d8b669fe`;
- constructor/verification arguments: none;
- persistent admin/upgrade path: none.

Its address is not predicted because the owner has not approved a deployer and nonce and this freeze does not introduce a CREATE2 implementation deployment.

### DroidAccountRegistry

- source: `contracts/hoodyoor/src/droid/DroidAccountRegistry.sol`;
- artifact SHA-256: `0x50876db00cd5b7f9a7e10f6a3ad6a5c42bee4d74343ab80e7e15557258cc5e6e`;
- source SHA-256: `0x0e04105fadcf3b0811e93120c921a94fa8e92e636a5678eed87ee75ff92d46ae`;
- creation hash: `0x925073987b0491bf8f3a2adbba10776fcfac2fafb783bc29139b6913df8b0215`;
- runtime template hash: `0x80c3d64099222fe1d1975a1b7f606949d55268fdbd287a608f2a02f9665c6070`;
- constructor: `(canonical, 0x349D…103A, deployedImplementation, 143, bytes32(0))`;
- persistent admin/upgrade path: none.

Its exact encoded verification arguments and CREATE address become knowable only after the implementation/deployer nonce is fixed. Claiming an address now would be fabrication.

### Source-control caveat

The current worktree contains existing and new uncommitted work. The Git commit alone cannot identify this release. Audit/release approval must bind the artifact/source hashes above and then approve a clean reproducible snapshot. This is a deployment blocker, not a reason to mutate or discard the user's worktree.

## Deployment ordering and assertions

Future authorized order:

1. rebuild from the frozen clean snapshot;
2. rerun offline tests and read-only Monad preflight;
3. send only the exact canonical-registry factory payload;
4. verify the exact canonical address/runtime hash;
5. deploy `DroidAccountV1` and verify source/code/constructor immutables;
6. deploy the facade with the exact manifest tuple;
7. verify every immutable getter and `IMPLEMENTATION_VERSION == 1`;
8. compare canonical and facade address derivation for token 1 and canary token;
9. configure server/public addresses while both Monad gates remain false;
10. execute the separately approved canary;
11. enable account activation only in a later release.

Post-deployment must fail if any chain, address, runtime hash, source setting, salt, owner result, account derivation, interface response, or activation result differs.

## Gas and reserve

Read-only checkpoint refreshed at block `95,362,095` on 2026-08-12:

| Transaction | Gas |
| --- | ---: |
| canonical ERC-6551 registry | 179,650 |
| `DroidAccountV1` | 1,188,142 |
| collection facade | 542,514 |
| total | 1,910,306 |

At the observed `202,000,000,000` wei gas price, estimated deployment cost was `0.385881812 MON`; the recorded 3× reserve was `1.157645436 MON`. This excludes canary funding and holder activation. The estimate is not a budget approval and must be refreshed immediately before any later signing ceremony.

## Activation-model decision

| Model | Gas/UX | Security/abuse | Operations | Decision |
| --- | --- | --- | --- | --- |
| Holder-paid | user pays once; clear ownership intent | lowest sponsorship abuse | simplest | safe baseline |
| HoodYØØR-sponsored | best first-use UX | bot/sybil and budget abuse unless tightly allowlisted | relayer/funding/monitoring needed | not V1 default |
| Lazy activation | no unused per-token deployment | requires active-account check before funding | already supported | required |
| Hybrid lazy sponsorship | holder default plus capped campaigns | manageable with campaign cap/allowlist | moderate | recommended future option |

Recommendation: lazy holder-paid activation for launch, with a separately approved capped sponsorship campaign later. Do not mass activate and do not let the first-party UI fund undeployed counterfactual accounts.

## Mainnet canary procedure — do not execute under this report

Use one owner-approved existing NFT and two owner-controlled wallets. Canary funds must be deliberately minimal and separately approved.

| Step | Action | Pass | Fail/stop |
| ---: | --- | --- | --- |
| 1 | Deploy and verify the three release items | all hashes/wiring match manifest | any mismatch or verification gap |
| 2 | Keep public/server activation flags false | no public activation path | any public write path appears |
| 3 | Derive canary account from canonical and facade | exact same address | address differs |
| 4 | Activate from current owner | one account-created event and code appears | revert, wrong event, or wrong code |
| 5 | Re-run activation | same address; no duplicate account | new/different account |
| 6 | Send the approved minimal MON amount | exact account balance increase | wrong destination or accounting |
| 7 | Owner executes a minimal return/test call | succeeds; state increments | unexpected revert/state |
| 8 | Non-owner executes same call | reverts `NotAuthorized` | any success |
| 9 | Deposit one minimal reviewed ERC-20 if approved | exact balance visible | unsupported/fee/metadata anomaly |
| 10 | Verify UI/API/indexing | correct chain, art, owner, account, balances, Energy | stale owner, fake price, partial state hidden |
| 11 | Confirm Trait Lab behavior | rerolls/layers operate; burn explicitly blocked | reroll regression or burn offered |
| 12 | Transfer parent between controlled wallets, only if separately authorized | NFT transfer succeeds and inventory stays | any unexpected transfer restriction/loss |
| 13 | Test old owner | all account execution/signature attempts fail | any stale authority |
| 14 | Test new owner | owner/execution/signature authority succeeds | new owner lacks control |
| 15 | Transfer back or retain under approved custody plan | final owner recorded and reconciled | ownership ambiguity |
| 16 | Reconcile events/balances and publish canary report | zero unexplained delta | pause release and investigate |

Any failed step stops the canary. Do not “try through” a mismatch with different calldata or artifacts.

## Pause and rollback posture

Before activation, rollback is leaving both Monad flags false. After contracts are deployed, they are immutable and cannot be rolled back; a defect means hiding new activation/funding surfaces, publishing the issue, preserving owner withdrawals, and introducing a separately reviewed version. There is intentionally no global pause that can trap owner funds.

## Status gates

### READY

- parent collection/chain/controller/staking facts established;
- immutable artifacts and constructor template frozen by checksum;
- lazy activation, UI, API, transfer, inventory, Energy, and burn protections implemented;
- local account/economic/cross-chain tests and live fork coverage exist;
- no existing contract requires redeployment.

### BLOCKED

- independent audit not completed;
- canonical registry/account/facade not deployed on Monad;
- worktree is not a clean approved source snapshot;
- deployer/Safe/canary wallets and NFT not approved;
- final gas estimate and budget not approved;
- no explicit deployment authorization.

### NEEDS OWNER DECISION

- approve immutable artifact hashes and clean source snapshot;
- approve independent reviewer/audit disposition;
- approve deployer and operational Safe procedure;
- approve holder-paid versus hybrid activation policy;
- approve gas reserve and canary amount/NFT/wallets;
- approve a later deployment instruction;
- approve reward/economic work only as a separate post-canary phase.

## Verification status

The final command results for this readiness pass are recorded in [dual-chain-production-readiness.md](./dual-chain-production-readiness.md). Existing detailed collection evidence remains in [monad-dyoor-droid-integration-plan.md](./monad-dyoor-droid-integration-plan.md), [monad-dyoor-droid-security.md](./monad-dyoor-droid-security.md), and the read-only checkpoint `deployments/monad/droid-accounts-preflight-143.json`.

## Hold point

This release candidate may proceed to independent audit and owner review. It may not proceed to signing or deployment without a new explicit authorization after all blockers are closed.
