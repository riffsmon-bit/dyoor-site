# Robinhood EOA Risk and Proposed Safe Migration

No ownership or funds are moved by this plan.

Live read-only inspection shows that collection owner, collection treasury, and royalty receiver currently resolve to the same EOA:

`0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6`

This creates a single-key compromise and availability risk across unrelated authorities. The future economic modules must not copy that concentration by default.

| Authority | Current | Proposed | Required future transaction | Primary risk | Reversible? | Recommended timing |
|---|---|---|---|---|---|---|
| Collection administration | shared EOA | Main Governance Safe, preferably 3-of-5 | collection ownership transfer/acceptance using its actual two-step semantics | compromised admin can alter any still-mutable collection control | only if new owner can transfer again | after Safe testing, before mint configuration changes |
| Treasury | shared EOA | dedicated Treasury Safe, preferably 3-of-5 | set collection treasury to reviewed Safe | payout concentration and operational loss | yes if collection admin retains setter authority | before accepting material mint/revenue funds |
| Royalty receiver | shared EOA | Treasury Safe or a distinct accounting Safe | set royalty receiver through supported collection interface | royalty diversion or accounting ambiguity | yes if receiver remains configurable | alongside treasury migration, before public mint |
| Economic module administration | undeployed | Main Governance Safe for default admin; restricted Operations Safe for bounded roles | constructor role assignments during separately approved deployment | all-powerful EOA could reconfigure assets/rewards/strategies | role transfers are possible, subject to delayed default-admin rules | configure correctly at deployment; never stage through a hot wallet unless explicitly approved |

Recommended owner decision options:

- High-security: Main Governance Safe 3-of-5, Treasury Safe 3-of-5, restricted Operations Safe 2-of-3.
- Early-operation minimum: 2-of-3 for governance and treasury, with a documented path to 3-of-5.
- Do not use a 1-of-1 Safe as a cosmetic replacement for the current EOA.

PAUSER may be a separate narrowly scoped emergency authority. It must not receive withdrawal, asset seizure, role-granting, or NFT-transfer authority. Sensitive treasury destination, allocation, router, automatic asset, and reward-weight changes should use a 24–72 hour timelock where supported. Pause remains immediate.

Before any migration, the owner must approve signer identities, thresholds, independent backups, recovery procedure, transaction order, and a dry-run review. No Safe is created and no authority changes in this release-remediation task.
