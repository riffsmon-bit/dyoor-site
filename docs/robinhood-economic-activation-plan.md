# Robinhood economic activation plan

Status: **PRE-MINT / ARTIFACT FREEZE BROKEN / NOT APPROVED**

HoodYØØR is already deployed on Robinhood Chain 4663 at the full address `0x8277F8126722B11D7b44C5C453bcF62A78AAFa25`. The August 12 read-only checkpoint found zero supply, no owner reserve, reveal off, secondary trading off, the canonical SeaDrop configuration sale-closed, and the expected collection runtime hash `0xb0fdec09…e405e`.

The live collection owner, treasury, and royalty receiver are currently the same EOA, `0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6`. That is a known governance risk and not the proposed Safe architecture. This task did not mint, open a sale, move ownership, change a receiver, or alter any collection configuration.

The canonical ERC-6551 registry, immutable Account V1, and collection resolver V1 already exist and their wiring matches chain 4663 and the collection. They are not redeployed.

## Six staged economic modules

| Module | Creation hash | Runtime template hash | Whole-artifact rebuild | State |
| --- | --- | --- | --- | --- |
| `HoodYoorDroidRegistry` | `95a023ee…a924` | `0fbaaa97…e9e6` | matched | Audit required |
| `HoodYoorAssetRegistry` | `97bcb5d3…f7f` | `0ca3ab50…596e` | matched | Audit required |
| `HoodYoorRewardsDistributor` | `5f1d55f7…17697` | `04af2b85…37f8d` | changed JSON SHA; bytecode stable | Audit required |
| `HoodYoorRevenueVault` | `c5ff05ca…e431` | `5142e148…c8f` | changed JSON SHA; bytecode stable | Audit required |
| `HoodYoorStrategyRegistry` | `6d49ec96…4ce5` | `393a7bf6…b261` | changed JSON SHA; bytecode stable | Audit required |
| `HoodYoorAchievementRegistry` | `1c0f870a…ca2b` | `a1ffcf88…5036` | changed JSON SHA; bytecode stable | Audit required |

The updated Revenue Vault supports Project Treasury, Droid Rewards, and Other Approved Allocation with an exact 10,000-bps total. It has not passed independent review. The artifact-container mismatch breaks the prior freeze even though creation/runtime bytes are unchanged. No production authorization transaction is prepared.

The non-actionable transaction plan, constructor dependencies, hashes, gas benchmarks, verification templates, and assertions are in `deployments/authorization/robinhood-transactions.json`.

## Before NFT mint

- Resolve the clean-source and artifact-freeze failures.
- Independently audit the deployed collection/account integration and all six economic candidates; the prior owner waiver is not an audit for this package.
- Decide whether and how to transfer collection ownership/treasury authority from the current EOA to approved Safes.
- Approve governance, treasury, operations, and emergency Safes and signer recovery procedures.
- Keep the six economic contracts undeployed unless there is a concrete operational reason to deploy before mint.
- Keep the collection supply at zero, owner reserve unminted, and SeaDrop sale configuration closed until its separate mint authorization.
- Keep rewards, strategies, shared treasury, agent, and bridge flags false.

## At NFT deployment

Already complete. Do not deploy another collection. Reverify the full address, runtime hash, owner, treasury, royalty receiver, SeaDrop configuration, resolver wiring, and zero-supply pre-mint state immediately before any mint authorization.

## After first mint

- Verify token ownership, token URI, on-chain artwork, Energy credit, transfer, reroll, and Droid account derivation.
- Confirm the first token is identified by `4663:0x8277…Fa25:tokenId` and never collides with Monad.
- Use a separately approved small account canary before general Droid activation.
- Ensure burn or destructive Trait Lab operations fail closed when an account is active, funded, or incompletely discovered.

## Before economic deployment

All must be owner-approved:

| Input | Current state |
| --- | --- |
| Governance Safe | UNSET |
| Treasury Safe | UNSET |
| Restricted operations Safe | UNSET |
| Emergency Safe / pauser | UNSET |
| Other Approved Allocation Safe | UNSET |
| Role holders | UNSET |
| Signer thresholds and recovery | UNSET |
| Timelock policy | proposed, not approved |
| Launch split | proposed 6,000 / 3,000 / 1,000 bps; not approved |
| Assets | none approved |
| Revenue sources | none approved |
| Reward weights / first epoch | UNSET |
| Strategies / adapters / routes | none approved |
| Gas maximum | UNSET |

The intended initial Safe model is 3-of-5 for governance/treasury, with a 2-of-3 restricted operations alternative if necessary. No ordinary backend hot wallet receives unrestricted treasury authority. Default-admin transfer and vault destination changes have 48-hour on-chain delays; other sensitive actions should use a 24–72-hour Safe/timelock policy.

## Owner approval tables

No revenue source is proposed as active. For each future source, record source ID, chain, exact contract/account, description, on-chain verification, expected asset, `ACTIVE = false`, and `OWNER APPROVED = false` before review.

The only current Robinhood asset candidate recorded by the package is native ETH represented as `NATIVE` on chain 4663, and it is not approved for economic use. A settlement/stable asset, HOOD-focused asset, or market-linked asset must not be listed until its exact canonical contract, transferability, acquisition route, liquidity, pricing, and compliance/risk package are verified. Tickers alone are never sufficient.

Initial strategy concepts remain inactive:

| Concept | Assets/routes | Risk | Active | Approved |
| --- | --- | --- | --- | --- |
| Settlement/stable | UNSET | unreviewed | No | No |
| HOOD-focused | UNSET | blocked pending canonical/routing/compliance proof | No | No |
| Broad-market-type | UNSET | blocked pending every underlying asset and route | No | No |

Every final strategy must record a chain-qualified ID, assets, target weights, adapter, maximum slippage, fallback, risk label, and owner approval. A preference change applies only to future rewards; it never sells historical Droid assets.

## Deployment and configuration separation

Contract deployment does not authorize configuration. Configuration does not authorize funding. Funding does not authorize claims or strategies.

After a future six-contract deployment and exact source/bytecode verification, prepare separately decoded Safe transactions to bind the funding vault once, register the collection and resolver, assign least-privilege roles, and register only reviewed assets/sources. Keep all production strategy adapters zero and all feature flags false.

For launch economics, the proposal is 60% Project Treasury, 30% Droid Rewards, and 10% Other Approved Allocation. Individual operating bounds are governance policy only; the candidate vault enforces the exact total but not those ranges.

## Economic activation sequence

1. Droid account infrastructure.
2. Controlled Droid canary.
3. General Droid activation.
4. Portfolio display.
5. Explicitly fund the Reward Vault/pool.
6. Enable a small weekly or biweekly reward epoch.
7. Pilot one small reviewed strategy.
8. Expand strategy availability only after observation and reconciliation.
9. Consider bounded agents in a separate future security release.

Bridge activation is independent and remains off. The cross-chain treasury is an accounting view only.

## Current hold

The safe commands are the keyless economic preflight, the now-keyless SeaDrop state preflight, offline tests, fork simulation, and package verifier. The SeaDrop preflight deliberately does not inspect deployment credentials or the private reveal backup, so those launch gates remain false outside the separately authorized execution workflow. No production deployment command is emitted while the artifact freeze, audit, governance, and configuration gates remain unresolved.
