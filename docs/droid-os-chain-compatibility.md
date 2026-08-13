# Droid OS Chain Compatibility Matrix

Date: 2026-08-12

This matrix applies the common rules in [droid-os-core-spec.md](./droid-os-core-spec.md). “Common” describes the invariant; chain columns describe the native implementation and current release stage.

| Concept | Common requirement | Monad | Robinhood Chain |
| --- | --- | --- | --- |
| Droid identity | `chainId + collection + tokenId` | `143 + 0x349D…103A + tokenId`; implemented | `4663 + 0x8277…Fa25 + tokenId`; implemented |
| Parent NFT | Existing/native ERC-721 remains identity | D.Y.O.O.R is live; untouched | HoodYØØR final replacement is deployed, supply 0/pre-mint; untouched |
| Account registry | Canonical ERC-6551 singleton plus immutable collection facade | canonical singleton absent; three deployments staged | canonical singleton, implementation, and facade already deployed/verified |
| Account implementation | Immutable V1; live-owner `CALL`; no admin/agent | exact V1 release artifact frozen, not deployed | immutable V1 live at `0x0FFD…F52A` |
| Controller | Current exact-collection authority, never activating wallet | direct Season 2 `ownerOf`; Ascension is S1-only custody | direct HoodYØØR `ownerOf`; future staking must remain non-custodial for V1 |
| Lazy activation | Token account deployed only when needed | staged; recommended hybrid-lazy | infrastructure live, first-party activation held until mint/release approval |
| Native asset | Chain-qualified native representation | MON | ETH |
| Prominent ERC-20s | Address and chain, never ticker | WMON/USDC are candidates only; economic registry undeployed | USDG is a display candidate; economic allowlist remains empty |
| Portfolio | Direct authoritative balances; partial reads explicit | shared reader/UI implemented, activation gate off | shared reader/UI implemented, zero-supply coming-soon state |
| NFT inventory | Configured/indexed discovery; never claim completeness silently | shared implementation | shared implementation |
| Artwork | Parent metadata/art pipeline | real D.Y.O.O.R PFP API | actual frozen HoodYØØR assignment renders/unrevealed art |
| Energy | Existing chain-local progression; no price | 18-decimal existing Monad ledger | integer existing HoodYØØR Energy Bank |
| Staking | Collection-qualified evidence/controller policy | S1 Ascension remains separate; S2 not held | no V1 custody resolver; custody staking is prohibited without new version |
| DYOOR Build | Verifiable progression input only | existing Blueprint/Build systems retained | shared philosophy; no financial conversion |
| Rerolls/layers | Mutable metadata does not change Droid identity | existing Trait Lab retained; parent burn guarded | reroll V2/renderer retained; parent collection has no holder burn path |
| Burn safety | Burning a funded controller must fail closed in first-party UI | active/funded/incomplete discovery blocks official burn | same requirement applies if any future burn is added |
| Droid registry | Chain-local eligible collections/account versions | source staged; economic deployment deferred | source staged; module address unset |
| Asset registry | Chain-local address allowlist | source staged; no approved economic assets | source staged; approved asset list empty |
| Strategy registry | Future rewards only; versioned | source staged; strategies off | source staged; strategies off |
| Achievement registry | Evidence plus capped modifiers | source staged; economic deployment deferred | source staged; module address unset |
| Revenue vault | Explicit source/funding; project/reward/other shares total 10,000 bps | deferred | replacement source staged; three destinations/shares unset |
| Reward distributor | Fully backed epoch; claim to active Droid | rewards off | source staged; rewards off |
| Treasury | Logical aggregate of native vaults | no vault deployed | no economic vault deployed |
| Indexing | Chain-qualified DB/cache/routes | implemented in shared APIs/migration | implemented in shared APIs/migration |
| Admin | Delayed Safe admin and least privilege | account layer has no admin; economic roles deferred | economic role plan staged; every holder unset |
| Agent | Default zero; separately audited capability system only | code-locked off | code-locked off |
| Bridge | Interface only; no approvals or routing | code-locked off | code-locked off |
| Production stage | Same standard, independent timeline | ready for independent audit/final approval/canary planning | architecture frozen; deployed pre-mint; economic configuration pending |

## Intentional divergences

### Deployment timing

Monad's parent collection already has circulating tokens, so account infrastructure can proceed to audit and a controlled canary without waiting for Robinhood mint. Robinhood already has its NFT and Account V1 contracts deployed but has zero supply; economic modules are deliberately not deployed merely for symmetry.

### Native assets and Energy precision

Monad uses MON gas and an 18-decimal existing Energy ledger. Robinhood Chain uses ETH gas and an integer Energy Bank. The UI formats each native system; no cross-chain conversion or merged Energy balance exists.

### Staking

Ascension custody is demonstrably limited to the separate Monad Season 1 collection. Monad Season 2 and Robinhood V1 both use direct `ownerOf`. This is secure only while those exact parent NFTs are not custody-staked. Any future custody design requires a new resolver/account version, not an exception in the frontend.

### Parent burn

Monad Season 2 supports holder burn, so the first-party Trait Lab performs a fail-closed Droid Wallet check. The current Robinhood collection has no equivalent holder burn feature. The common rule still prohibits adding one without the same or stronger account-aware protection.

## Feature-flag matrix

These are the actual repository flags at the freeze point.

| Feature | Monad | Robinhood | Enforcement |
| --- | --- | --- | --- |
| Droid Wallet UI | `NEXT_PUBLIC_DROID_WALLETS_ENABLED=true` globally; chain gate off | same; chain gate off | presentation only |
| Portfolio UI | `NEXT_PUBLIC_DROID_PORTFOLIOS_ENABLED=true`; staged data path | same; pre-mint empty state | presentation only |
| Account activation | `MONAD_DROIDS_ENABLED=false` and public twin false | `ROBINHOOD_DROIDS_ENABLED=false` and public twin false | client refuses activation when either required gate is off |
| Energy | existing live system | existing deployed pre-mint system | independent legacy/native contracts |
| Rewards | server/public `DROID_REWARDS_ENABLED=false` | same | double gate plus contracts absent |
| Strategies | server/public `DROID_STRATEGIES_ENABLED=false` | same | double gate plus contracts absent |
| Shared treasury UI | server/public `SHARED_TREASURY_ENABLED=false` | same | no vault aggregation enabled |
| Bridge | `CROSS_CHAIN_BRIDGE_ENABLED=false` | same | hard-coded false in shared code |
| Agent | `DROID_AGENT_ENABLED=false` | same | hard-coded false in shared code |
| NFT mint | not applicable; collection live | no app flag is treated as authority; on-chain sale remains closed | on-chain SeaDrop/collection state is authoritative |

## Cross-chain collision invariant

The automated suite compares Monad `(143, 0x349D…103A, 123)` with Robinhood `(4663, 0x8277…Fa25, 123)` and verifies different canonical IDs/keys, chain-prefixed reward storage, compound database keys, and distinct `/monad/droids/123` versus `/robinhood/droids/123` routes.

## Shared versus chain-local deployment

“Shared Droid OS” means shared source, interfaces, invariants, UI components, schema, and operational controls. It does not mean shared addresses or custody. Every asset registry, strategy catalog, vault, distributor, balance, epoch, and Safe remains native to its own chain.
