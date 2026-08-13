# Robinhood HoodYØØR Pre-Mint Readiness

Date: 2026-08-12

Overall status: **ARCHITECTURE FROZEN / DEPLOYED PRE-MINT / ECONOMIC CONFIGURATION BLOCKED**. No transaction was signed or broadcast by this work.

## Repository-versus-prompt reconciliation

The repository contains verified production evidence that the final replacement HoodYØØR collection is already deployed at:

```text
Robinhood Chain 4663
0x8277F8126722B11D7b44C5C453bcF62A78AAFa25
```

It also records immutable Account V1 at `0x0FFDc6…F52A` and the official facade at `0x190602…fE48`. Live read-only calls during this pass confirmed the facade binds chain 4663, that exact collection, that implementation, the canonical ERC-6551 registry, and zero salt.

The collection is nevertheless **pre-mint**: at refreshed read-only block `34,602,847`, live `totalSupply()` was 0, owner reserve was not minted, reveal was false, and secondary trading was disabled. “Upcoming” therefore means the mint/holder lifecycle is upcoming—not that the collection address is unknown. Replacing the verified address with `UNSET`, inventing another address, or deploying the collection again would be incorrect and destructive.

## Existing production boundary — keep

| Component | Address | Status |
| --- | --- | --- |
| HoodYØØR final collection | `0x8277…Fa25` | deployed, sale closed, supply 0 |
| Energy Bank | `0x9bA9…D7c3` | deployed; existing integer progression ledger |
| Reroll V2 | `0x6cf2…FD11` | deployed and wired/frozen |
| canonical ERC-6551 registry | `0x0000…5758` | deployed; expected runtime verified |
| `DroidAccountV1` | `0x0FFD…F52A` | deployed, immutable, verified |
| official account facade | `0x1906…fE48` | deployed, immutable, verified |

No existing address, bytecode, token ID, trait assignment, renderer, metadata, Energy mechanic, reroll payment, or account derivation changes in this phase.

## Future NFT integration interface specification

This specification remains the contract for any future collection version, test mock, or sibling collection. The deployed final HoodYØØR contract currently satisfies the V1 requirements.

Required:

- standard ERC-721 ownership, approval, transfer, safe-transfer, ERC-165, and metadata behavior;
- `ownerOf(tokenId)` must revert for nonexistent/burned IDs and return the live owner otherwise;
- deterministic token existence/mint semantics and stable token IDs;
- chain-local collection identity; no token-ID-only global assumptions;
- safe metadata behavior before/after reveal and explicit freeze controls where intended;
- ordinary transfers must not mutate Droid Wallet balances or addresses;
- no custody staking unless a separately reviewed account/controller version supports it;
- Trait Lab and Energy authorization must revalidate current NFT ownership;
- burn, if ever introduced, must expose a first-party account-aware fail-closed flow and clearly warn that external burn may lock assets.

The NFT should avoid:

- portfolio balances or token allowlists;
- reward-distribution or strategy-execution logic;
- treasury or reward-pool custody;
- agent/session permissions;
- hidden account-admin hooks;
- automatic bridging;
- mutable logic that silently changes V1 controller semantics.

The deployed collection is an ordinary secure ERC-721 identity with modular companion systems. No NFT change is required for economic Droids.

## Common Droid compatibility

- Identity: `(4663, 0x8277…Fa25, tokenId)` through the common `DroidIdentity` encoding.
- Controller: current direct `ownerOf(tokenId)`.
- Account: immutable V1/canonical registry/facade, already deployed.
- Portfolio: shared direct reader, allowlisted assets, explicit partial errors, no fake fiat values.
- Energy: existing bank read as progression, never a financial balance.
- UI/indexer/schema: common chain-qualified routes and records.
- Rewards/strategies/treasury: common source, separate chain-local deployments/configuration.
- Agents/bridges: hard-disabled.

Critical staking constraint: a future custody staking contract would become the literal V1 account controller. Robinhood staking must remain non-custodial unless a new controller-aware account version is designed, audited, and separately registered.

## Six economic modules — staged only

| Order | Module | Purpose | Production input still unset |
| ---: | --- | --- | --- |
| 1 | `HoodYoorDroidRegistry` | eligible collections and immutable resolver versions | initial admin Safe |
| 2 | `HoodYoorAssetRegistry` | native/ERC-20 address allowlist | admin Safe and all assets |
| 3 | `HoodYoorRewardsDistributor` | fully funded Merkle epochs claimed to Droids | admin Safe and module addresses |
| 4 | `HoodYoorRevenueVault` | explicit-source project/reward/other accounting | admin, three destinations, and three-part split |
| 5 | `HoodYoorStrategyRegistry` | future-reward preferences only | admin, assets, strategy catalog |
| 6 | `HoodYoorAchievementRegistry` | evidence-linked capped modifiers | admin/issuer policy |

All six are non-proxy, versioned companion contracts. None is deployed. The exact source/artifact hashes and constructor placeholders are in [`deployments/robinhood/pre-mint-release-plan.json`](../deployments/robinhood/pre-mint-release-plan.json).

Prominent release change: this readiness pass invalidated only the prior **undeployed** `HoodYoorRevenueVault` candidate hash. The replacement adds the required third other-approved allocation bucket and its independent liabilities, release path, delayed destination, and exact 10,000-bps validation. No deployed collection, Account V1, facade, Energy, or reroll bytecode changed. The replacement vault hash must receive independent review.

The release artifact pipeline is Foundry/Solidity 0.8.24, optimizer 200, via-IR, Paris EVM. This corrects an older deployment report that described a different optimizer profile than the artifacts actually consumed by the preflight.

No router, DEX adapter, stock-token adapter, bridge, session key, or agent contract is staged for deployment.

## Configuration placeholders and fail-closed behavior

The repository now declares blank/null Safe, role, and split values and explicit empty JSON arrays for assets and revenue sources. Blank governance values are invalid release inputs; empty allowlists intentionally enable nothing.

Key groups:

```text
HOODYOOR_ECONOMY_DEFAULT_ADMIN_SAFE=
HOODYOOR_TREASURY_SAFE=
HOODYOOR_REWARD_SAFE=
HOODYOOR_OTHER_ALLOCATION_SAFE=
HOODYOOR_*_ADMIN=
HOODYOOR_PAUSER=
HOODYOOR_TREASURY_BPS=
HOODYOOR_REWARD_BPS=
HOODYOOR_OTHER_ALLOCATION_BPS=
HOODYOOR_APPROVED_ASSETS=[]
HOODYOOR_APPROVED_REVENUE_SOURCES=[]
```

Economic contract addresses and strategy options also remain blank. The real deployed parent/account addresses remain populated because they are verified production facts, not placeholders.

The vault has distinct project-treasury, Droid-reward, and other-approved buckets. Each share must be in the protocol range 0–10,000 bps and the three shares must total exactly 10,000; rounding dust goes to project treasury. Each deposit is fixed under the then-current split. No percentage or third destination is chosen here. The owner must approve all three shares, all three destinations, and any narrower governance bounds before constructor calldata is finalized.

## Pre-mint simulation coverage

Local economic simulations use a staged/mock ERC-721 and shared modules; the Robinhood live fork mints the existing owner reserve only inside a disposable fork. They do not change mainnet.

Covered:

- initial and multiple mints with distinct Droid keys;
- deterministic Account V1 activation and token binding;
- owner execution, transfer, immediate stale-owner rejection, and new-owner control;
- account holdings remaining after parent transfer;
- first strategy selection, version changes, disabled strategies, and owner transfer;
- strategy changes moving no historical assets;
- reward claim with an explicit strategy and with no strategy;
- claim-to-active-Droid only, double-claim rejection, allocation cap, invalid proof, and inactive account;
- existing historical native assets remaining intact when a reward arrives;
- disabled/unsupported assets, fee-on-transfer deposits, and malicious callbacks;
- pause behavior, excess-only recovery, expired epoch accounting, achievement caps;
- Monad/Robinhood same-token-ID collision resistance in identities, routes, cache/storage, and schema.

Mocks are test fixtures, not production collection or asset configuration.

## Strategy and asset posture

The strategy catalog is empty. Labels such as stable, HOOD-focused, technology, AI, or broad market remain product concepts, not approved on-chain products.

Before adding any Robinhood Chain asset, review its canonical address, chain ID, implementation/proxy control, decimals, transfer restrictions, compliance eligibility, acquisition route, liquidity, pricing source, corporate-action behavior where relevant, router compatibility, and incident disable plan. Ticker alone is never sufficient.

Changing strategy affects future allocation snapshots only. Existing Droid assets are never sold or rebalanced by the current registry. V1 claims retain the funded settlement asset.

## Treasury and reward posture

There is no funded reward pool. Rewards are neither guaranteed nor active. A future vault and pool stay entirely on Robinhood Chain and are independently verifiable; no Monad balance or bridge is involved.

Epoch creation requires available backing. Claims bind chain, collection, token, account version/address, strategy snapshot, weight, and amount; require current NFT ownership; prevent duplicate claims; and pay the active Droid Wallet. Energy never creates or prices the reward asset.

## Safe-compatible role plan

- `DEFAULT_ADMIN_ROLE`: high-threshold protocol Safe; never a hot wallet.
- Treasury destination: separate high-threshold treasury Safe; never an EOA.
- Collection/asset/strategy/achievement configuration: reviewed configuration Safe, preferably timelocked.
- Source/allocation/destination policy: treasury-governance Safe.
- Release and epoch roles: operations Safe with manifest/funding reconciliation and transaction limits.
- Achievement issuer: constrained/revocable campaign Safe or narrowly scoped service.
- Pauser: monitored security Safe; it may stop economic actions but never owner account rescue.

Every module uses a two-day default-admin transfer delay; the vault adds a two-day destination delay. The deployer must not remain an all-powerful personal EOA. Actual addresses/thresholds remain owner decisions.

## Order of operations

### BEFORE NFT MINT

1. Keep owner reserve, public sale, reveal, account activation, rewards, strategies, agents, bridge, and shared treasury gates off.
2. Independently review the already-deployed collection, reroll/Energy wiring, and Account V1 boundary.
3. Approve mint launch controls separately from economic infrastructure.
4. Keep all six economic addresses and governance values unset.
5. Re-run the Robinhood account fork and read-only preflight; confirm supply remains zero until the launch decision.

### AT NFT DEPLOYMENT

Already completed. Do not deploy another collection. Verify the existing address/runtime and keep a permanent reference to the superseded abandoned V1 collection so it is never confused with `0x8277…Fa25`.

### AFTER NFT MINT

1. Verify first token owner, metadata/reveal state, traits, Energy credit, reroll quotes, transfer restrictions, and exact Account V1 derivation.
2. Run one account activation canary only after a separate approval.
3. Verify account funding, owner/non-owner execution, transfer authority, inventory, UI, and indexing.
4. Enable Robinhood account activation only in a later website release.

### BEFORE ECONOMIC ACTIVATION

1. Approve clean artifact snapshot and independent audit.
2. Approve Safe addresses, thresholds, roles, treasury split, assets, sources, reward-weight policy, strategies, and canary cap.
3. Run fork-equivalent deployment simulations with final constructor values and current fees.
4. Deploy and verify the six modules only if there is an operational need; register the existing collection/facade.
5. Remove deployer roles and verify every Safe role.
6. Fund only a separately approved capped canary; publish and reconcile one test epoch.
7. Enable rewards/strategies in a separate release. Keep agents and bridge off.

## Cost status

Final economic gas and ETH budget cannot be approved until Safe addresses, all three destinations, and all three split values complete constructor calldata. The replacement-artifact Foundry benchmark totals `12,665,676` constructor gas. At the refreshed read-only checkpoint maximum fee of `101,264,000` wei, that is `0.001282577014464 ETH`; a mechanical 3× planning reserve is `0.003847731043392 ETH`. These are planning figures—not a funding instruction—and exclude verification, role/configuration transactions, and canary rewards. A live final-constructor simulation and refreshed fee estimate remain mandatory.

Robinhood Chain uses ETH for gas according to its official network configuration. No ETH was moved or requested by this task.

## Status gates

### READY

- final collection and Account V1 addresses are verified repository/live facts;
- zero-supply pre-mint state is confirmed;
- common identity, portfolio, Energy, UI, schema, and security boundaries are compatible;
- six module sources and artifact hashes are staged;
- mock/fork simulations cover mint-through-claim and transfer security;
- UI now shows a pre-mint staged state instead of nonexistent NFTs.

### BLOCKED

- independent audit outstanding;
- no approved Safe/role configuration;
- no approved split, assets, sources, reward policy, strategy catalog, or canary cap;
- economic addresses unset and pools unfunded;
- dirty worktree is not a clean approved release snapshot;
- no mint, economic deployment, funding, or activation authorization.

### NEEDS OWNER DECISION

- approve the already-deployed NFT architecture/launch procedure;
- approve Safe thresholds and role holders;
- approve treasury split/governance bounds;
- approve asset and revenue-source lists;
- approve reward policy, strategy catalog, and economic timing;
- approve independent audit disposition;
- separately approve mint, account activation, economic deployment, canary funding, and later reward activation.

## Hold point

Robinhood is pre-mint ready at the shared architectural standard. It is intentionally not ready for mint activation or economic deployment. No mainnet transaction is authorized by this report.
