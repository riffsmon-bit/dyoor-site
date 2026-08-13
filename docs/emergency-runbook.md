# Droid OS emergency runbook

Status: **prepared, not activated**

This runbook covers the staged Monad Droid Account infrastructure and the undeployed Robinhood economic modules. It does not grant new authority. In particular, `PAUSER` cannot seize assets, withdraw from Droid Accounts, change NFT ownership, or bypass current-owner authorization.

## Operating principles

1. Protect holders first; do not improvise a custody migration during an incident.
2. Pause the smallest affected capability.
3. Preserve owner rescue/withdrawal through `ownerExecute` where the immutable account permits it.
4. Never publish keys, seed phrases, internal RPC credentials, unredacted signatures, or exploitable details.
5. Record every observation, decision, Safe proposal, signer, transaction hash, block number, and timestamp.
6. Treat each chain independently. A Monad incident does not justify moving Robinhood funds, or vice versa.

## First 15 minutes

- Open an incident record with UTC time, chain ID, affected addresses, reporter, evidence links, and severity.
- Confirm the issue through at least two independent read-only RPC/explorer sources when possible.
- Freeze deployment, configuration, funding, and feature-activation approvals.
- Notify the governance Safe signers, security lead, operations lead, frontend/indexer lead, and legal/compliance contact where relevant.
- Preserve logs, RPC responses, transaction traces, indexer checkpoints, release manifests, and UI screenshots. Hash exported evidence.
- Do not rotate or revoke anything until the affected role/address is verified; an incorrect emergency action can worsen the incident.

## Capability actions

| Incident | Immediate containment | Authority | Important limit |
| --- | --- | --- | --- |
| New account activation issue | set server and public Monad/Robinhood Droid activation flags false; disable activation UI/API | deployment/operator configuration approval | already deployed immutable accounts remain owner-controlled |
| Reward claim issue | call `pause()` on the affected RewardsDistributor | approved `PAUSER_ROLE` | does not transfer or seize reserved funds |
| Revenue intake/release issue | call `pause()` on the affected RevenueVault | approved `PAUSER_ROLE` | direct native transfers already fail; pause is not withdrawal authority |
| Strategy issue | call `pause()` or disable the specific strategy | approved pauser/strategy role | historical Droid assets remain untouched |
| Asset issue | disable the exact chain-qualified asset; pause if broader uncertainty exists | approved asset role/pauser | disabling automation does not confiscate existing tokens |
| Router/adapter issue | disable the strategy/asset and application route; revoke only the exact approval if one exists | approved strategy/asset governance | no router or adapter is authorized in this release |
| Revenue-source compromise | set that exact source inactive and pause the vault if deposits cannot be reconciled | source manager/pauser | unknown sources fail closed |
| Role compromise | pause affected modules; revoke the compromised non-default role from the governance Safe | default admin Safe | follow the 48-hour default-admin transfer process for default-admin rotation |
| Operational wallet compromise | remove operational roles, rotate credentials, invalidate sessions/API tokens, review all proposals and signatures | governance Safe plus operations | never move Droid Account assets as a blanket response |
| Indexer/RPC divergence | disable affected display/actions, show data unavailable, compare independent RPCs | application operations | on-chain ownership and balances remain authoritative |

`unpause()` is also role-gated. Do not unpause merely because a timer elapsed. Require root-cause analysis, reconciled balances/state, a reviewed remediation, regression tests, signer approval, and a public/status communication plan.

## Monad Account V1 limitation

`DroidAccountV1` and the collection facade are immutable and intentionally have no project-admin pause or upgrade backdoor. The project can stop new UI-assisted activation and remove unsafe integrations, but it cannot seize or freeze a holder’s existing Droid Account. Current NFT ownership continues to control owner execution. If an immutable defect is found, stop new activation, warn users, identify affected accounts, and prepare a separately audited version; never silently redirect existing accounts.

## Role rotation

1. Verify the replacement Safe and threshold on the correct chain.
2. Pause the affected module when operationally safe.
3. Export current role membership and pending default-admin state.
4. For ordinary roles, have the approved default admin grant the replacement and revoke the compromised holder in separately decoded Safe transactions.
5. For `DEFAULT_ADMIN`, use `AccessControlDefaultAdminRules` transfer/accept flow and observe its 48-hour delay.
6. Confirm events, role membership, Safe threshold, and absence of unexpected roles from two RPC sources.
7. Rotate backend credentials separately; backend wallets must never hold unrestricted treasury authority.

## Evidence and reconciliation

Preserve:

- source commit and artifact hashes;
- all affected transaction/trace hashes and decoded calldata;
- pre/post balances, liabilities, reserved rewards, claims, and epoch manifests;
- role and pause event history;
- asset, strategy, source, allocation, and destination configuration history;
- API, indexer, monitoring, and authentication logs under the applicable retention policy;
- the exact UTC incident timeline and signer decisions.

Reconcile each on-chain asset independently. `vault balance = project accrued + reward accrued + other accrued + true excess`. `reservedByAsset` must never exceed distributor balance. A discrepancy remains an active incident even if the UI appears correct.

## Monitoring specification

Alert on failed authorization attempts, unexpected account deployments, large or unusual reward claims, reward double-claim reverts, vault balance/liability movement, Safe or role changes, strategy/asset/source updates, pause/unpause, allocation/destination changes, abnormal router approvals/calls, indexer lag, and RPC divergence.

Monitoring is read-only and must not custody user assets. Recommended event consumers should pin chain ID, contract address, block hash, confirmation depth, and reorg handling. Alerts should include a direct explorer link and decoded state diff without secrets.

## Recovery and closure

An incident closes only after containment, independent reproduction, root-cause analysis, balance reconciliation, reviewed remediation, tests, role review, monitoring restoration, owner/governance approval, and a documented decision on disclosure. Feature activation remains a separate approval after closure.
