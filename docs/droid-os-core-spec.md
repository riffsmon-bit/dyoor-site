# HoodYØØR Droid OS Core Specification

Status: shared architecture source of truth. This specification applies equally to the native Monad D.Y.O.O.R collection and the native Robinhood Chain HoodYØØR collection. A chain-specific implementation is conforming only when it satisfies this document and its own reviewed release manifest.

## 1. Non-negotiable model

```text
NFT identity --current ownership--> Droid Wallet --holds--> real assets
       |                                  |
       +--> traits / metadata             +--> portfolio / inventory
       +--> Energy / progression
       +--> achievements --> capped, optional reward-weight input

explicit chain-local revenue --> funded reward pool --> claim to Droid Wallet
owner strategy preference ---------------------------> future rewards only
agent and bridge execution --------------------------> DISABLED
```

- The NFT is identity.
- Energy is non-transferable ecosystem progression and utility. It is not money, a price, a guaranteed reward, or automatically convertible into an asset.
- Reward weight is a separately computed, capped, auditable eligibility input. It is not the Energy balance.
- The Droid Wallet is the NFT-bound asset container. It has no private key.
- Portfolio assets are real chain-local assets and remain separate from Energy.
- A strategy is a preference for future eligible reward allocation. It never liquidates historical inventory merely because the preference changes.
- Agent and bridge authority default to zero.

## 2. Canonical Droid identity

Every contract, API, route, cache, database row, manifest, and event-derived record must bind the full tuple:

```text
chainId + collectionAddress + tokenId
```

The canonical Solidity key is:

```solidity
keccak256(abi.encode(chainId, collectionAddress, tokenId))
```

The canonical application identifier is:

```text
<decimal chainId>:<lowercase checksummed-valid collection>:<decimal tokenId>
```

Token ID alone is forbidden as a persistent or cross-chain key. Monad D.Y.O.O.R #123 and Robinhood HoodYØØR #123 are different Droids even if their traits or owners happen to match.

## 3. Controller semantics

V1 authority is the current controller of the exact native-chain ERC-721 binding. For the two current V1 integrations, the controller is resolved by calling `ownerOf(tokenId)` on every authorization. The activating wallet is never cached as authority.

Required transfer behavior:

1. Alice owns the parent NFT and can execute from its Droid Wallet.
2. Alice transfers the NFT to Bob.
3. Alice immediately loses execution and signature authority.
4. Bob immediately gains authority.
5. Assets remain in the same Droid Wallet.

Burn must fail closed. If `ownerOf` reverts because the parent was burned, V1 returns no controller; it must not remember the previous owner. A first-party burn surface must therefore block when the account is active, detectably funded, or cannot be exhaustively assessed.

Custody staking is not compatible with direct-`ownerOf` V1 unless the staking contract is intentionally meant to control the account. Both current V1 collections therefore require non-custodial staking. A future custody integration needs a new, immutable resolver/account version bound to the exact `(chainId, collection, custodian)` tuple and dedicated transition tests. A staking record from another collection must never be reused by token ID.

## 4. Account behavior and lifecycle

The account address is derived from:

```text
canonical ERC-6551 registry
+ implementation address/version
+ salt
+ native chain ID
+ parent collection
+ token ID
```

The official collection facade pins one exact configuration. Account creation is lazy and idempotent. Counterfactual addresses may be displayed only after registry, implementation, chain, collection, and salt are verified; first-party funding requires deployed account code.

V1 requirements:

- receive native gas asset;
- receive standard ERC-20 transfers;
- receive ERC-721 and ERC-1155 assets;
- expose immutable token binding and live owner resolution;
- owner-authorized ordinary `CALL` and bounded atomic batch calls;
- ERC-1271 current-owner signature validation;
- ERC-165/ERC-6551 interface reporting;
- no `delegatecall`, CREATE, CREATE2, upgrade, admin executor, session key, or agent path;
- prevent self-targeting, parent self-control, controlling-collection nesting, reentrant execution, and detected/bounded ownership cycles.

Account implementations are immutable and versioned. A registry may register a new version, but it must not silently redirect an existing version or mutate an existing account's code.

## 5. Activation policy

Mass activation is prohibited. The common policy is lazy activation with optional capped sponsorship:

- holder-paid activation is the secure baseline and has the lowest abuse/operations burden;
- project sponsorship may be used for a limited campaign with allowlists, per-Droid limits, and a budget cap;
- depositing or claiming can trigger activation only when the owner explicitly approves the transaction and the exact derived address is verified;
- funding an undeployed counterfactual address is not offered by the first-party UI.

The recommended production model is hybrid lazy activation: holders pay by default; carefully budgeted sponsorship may be added later without changing account authority.

## 6. Portfolio and inventory semantics

On-chain balances are authoritative. Discovery, balance reads, pricing, valuation, and presentation are separate layers.

- Native and ERC-20 assets are identified by chain and address; native assets use the explicit zero-address representation in chain-local registries.
- Symbols and names are untrusted display metadata, never identity.
- Prominent assets require an allowlist and reviewed decimals/behavior.
- NFT inventory is event/indexer assisted or explicitly configured. Direct RPC cannot prove the absence of every arbitrary asset.
- Unknown pricing is shown as `Value unavailable`, never fabricated `$0`.
- Aggregated fiat totals are display-only and must retain chain/source timestamps.
- Every parent-NFT transfer warning includes underlying native/token/NFT balances when available and states that assets are not automatically returned.

## 7. Energy, progression, Build, and traits

Each chain keeps its existing Energy ledger, unit precision, roles, sinks, and economics. The shared UI normalizes display only; it does not merge balances or tokenize Energy.

Staking, DYOOR Build, quests, rerolls, layers, and achievements may emit or provide verifiable progression events. They may become capped inputs to a published reward-weight policy. They never mint financial assets simply because Energy accumulated.

Account identity does not depend on mutable traits or metadata. Trait rerolls and layer changes therefore preserve the same Droid Wallet. Burning the parent is categorically different because it destroys controller resolution.

## 8. Achievements and reward weight

Achievements are chain-qualified, evidence-linked, versioned records. They may contribute only disclosed, capped modifiers. The current shared contract caps one achievement modifier at 500 bps and total modifiers at 2,000 bps.

Reward-weight generation is off-chain but reproducible from declared sources. Every epoch policy must publish:

- snapshot blocks/timestamps and native chain;
- eligible collection(s);
- source events and exclusions;
- per-source and total caps;
- allocation arithmetic and rounding;
- manifest hash and dispute window.

Raw transaction volume alone is not a valid weight source. The epoch contract verifies commitment and funding, not subjective fairness; independent reproduction is an operational requirement.

## 9. Revenue and reward accounting

Each chain has its own independently funded vault and distributor. There is no cross-chain pool.

Revenue requirements:

- only approved sources and assets;
- unique, nonzero revenue IDs;
- exact balance-increase accounting for ERC-20 deposits;
- project-treasury, Droid-reward-pool, and optional other-approved-allocation shares fixed at deposit time;
- three explicit basis-point shares, each within `0..10,000`, whose total must equal `10,000`;
- any indivisible rounding remainder assigned to the project-treasury bucket and disclosed in accounting events;
- final split and any narrower governance bounds require owner approval;
- releases only to the three configured destinations; a zero-percent other bucket still uses an explicit owner-approved destination so later policy changes cannot invent one silently;
- destination changes delayed;
- recovery only for unaccounted excess, while paused, to the configured treasury.

Reward requirements:

- explicitly funded before an epoch is created;
- reservations never exceed unreserved on-chain balance;
- immutable epoch ID/root/manifest commitment;
- leaf binds epoch, chain, collection, token, account version/address, strategy snapshot, weight, and amount;
- current NFT owner must claim;
- active official Droid Wallet must receive the asset;
- one claim per `(epochId, droidKey)` and remaining-allocation cap;
- no Energy-to-asset mint path and no admin withdrawal from Droid Wallets.

## 10. Strategy semantics

Strategies are chain-local, generic, versioned baskets of approved assets plus display/risk metadata and an optional reviewed adapter address. Catalog labels are not embedded as permanent financial promises.

Changing or clearing a strategy:

- changes only future reward snapshots;
- does not sell, swap, bridge, approve, or move assets already held;
- requires the current NFT owner;
- does not guarantee that target assets are available or liquid.

V1 retains the funded settlement asset. Any future execution adapter must fail closed when routing, liquidity, compliance, deadline, minimum output, or price validation is unavailable.

## 11. Shared treasury model

The HoodYØØR treasury is a logical read model:

```text
Monad vault -------- independently verifiable Monad balances ---+
                                                               +--> unified read-only UI
Robinhood vault ---- independently verifiable RH balances ------+
```

No synchronized global balance exists. Reward pools remain chain-local. No bridge is required, selected, or approved. A displayed aggregate must never be used for on-chain accounting.

## 12. Indexing and APIs

Financial ownership, balances, roots, reservations, and claims remain on-chain authoritative. Database and file/Blob records are caches and protected manifests.

Required keys:

- Droid: `(chain_id, collection_address, token_id)`;
- account: Droid tuple plus account version;
- strategy: chain plus strategy ID/version;
- epoch: chain plus epoch ID;
- claim: chain plus epoch plus Droid key;
- asset: chain plus contract address.

All APIs accept and validate a supported chain ID, derive official collection/account configuration server-side, and re-read ownership for authorization. Cache paths and frontend routes must include the native chain namespace.

## 13. Frontend contract

Shared vocabulary: Droid, Droid Wallet, Portfolio, Inventory, Energy, Strategy, Rewards, Achievements, Activity, Security.

Every profile shows a native-chain badge, parent owner, exact Droid Wallet, activation state, underlying balances, Energy as progression, partial-read warnings, transfer warning, and owner recovery actions. Pre-mint chains show a staged/coming-soon state and no fabricated NFT cards.

Writes must switch to the profile's configured native chain and verify the resulting chain ID. The UI is not an authorization boundary.

## 14. Feature gates

Server and public gates are both required for rewards, strategies, and chain activation. Default release posture:

```text
DROID_REWARDS_ENABLED=false
DROID_STRATEGIES_ENABLED=false
SHARED_TREASURY_ENABLED=false
CROSS_CHAIN_BRIDGE_ENABLED=false
DROID_AGENT_ENABLED=false
```

Bridge and agent flags are additionally hard-coded false in shared server/public configuration. An environment variable alone cannot enable them.

## 15. Admin and emergency boundaries

Default admins, treasury destinations, allocation/release roles, asset/strategy/achievement managers, epoch managers, and pausers are separate capabilities. Production default admin and treasury custody belong to reviewed Safe multisigs, not personal or hot EOAs. Operational issuers may use limited wallets only when revocable, monitored, and unable to move treasury or Droid funds.

Pausing economic modules must stop new deposits/configuration/claims as applicable without disabling owner execution from existing Droid Wallets. There is no project-admin path to withdraw user inventory.

## 16. Agent and bridge boundary

No current contract grants an agent or bridge authority. Future agent permissions require a separately audited account version/gateway with on-chain target, selector, asset, amount, daily cap, slippage, strategy, expiration, nonce, ownership epoch, revoke, and pause enforcement. The agent must never transfer the parent NFT, alter ultimate ownership/security, use arbitrary `delegatecall`, whitelist itself, or obtain unlimited arbitrary approvals.

Bridge support remains an interface only. No adapter, route, allowance, or automated cross-chain movement is approved.

## 17. Chain lifecycle

Monad:

```text
existing NFT -> discovered -> counterfactual address -> lazy activation
             -> portfolio -> future eligibility -> future strategy/rewards
```

Robinhood:

```text
collection deployed / pre-mint -> mint opens under separate approval -> NFT exists
-> discovered -> counterfactual address -> lazy activation -> portfolio
-> future eligibility -> future strategy/rewards
```

The two chains must meet the same security standard but are intentionally allowed to advance on different release timelines.

## 18. Conformance gates

A release is conforming only when exact source/artifact hashes are frozen, current chain/collection/account wiring is read from live RPC, complete local and fork tests pass, feature flags remain correct, roles and Safe thresholds are approved, independent review status is explicit, canary limits are defined, and a separate owner instruction authorizes deployment or activation.

Standards and network references: [ERC-6551](https://eips.ethereum.org/EIPS/eip-6551), [Monad chain configuration](https://docs.monad.xyz/developer-essentials/changelog), and [Robinhood Chain network configuration](https://docs.robinhood.com/chain/connecting/).
