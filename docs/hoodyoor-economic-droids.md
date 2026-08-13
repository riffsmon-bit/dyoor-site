# HoodYØØR Economic Droids

Status: implemented and locally verified; economic contracts are not deployed and reward/strategy features remain disabled.

## Purpose and invariants

This upgrade turns each existing native NFT into the identity for a persistent economic Droid without changing the NFT contract, collection identity, token ID, metadata, traits, rerolls, staking, or Energy.

The system keeps four concepts deliberately separate:

- **NFT**: identity and current ownership.
- **Droid Account**: the NFT-controlled ERC-6551-style asset container.
- **Energy**: non-transferable progression and ecosystem utility, with its existing units and economics.
- **Real assets**: native tokens and approved ERC-20s funded from explicit revenue/reward pools.

Energy has no dollar conversion and is never transferred into the reward contracts. Activity and achievements can only become transparent, capped inputs to an independently published reward-weight snapshot.

## Architecture

```text
Native NFT (chainId, collection, tokenId)
                 |
                 v current owner controls
        versioned Droid Account
                 |
        +--------+---------+
        |                  |
  existing systems     real assets
 Energy / rerolls      portfolio / inventory
        |                  ^
        v                  |
 verifiable activity      claim
        |                  |
        +--> epoch weight--+
                            |
approved revenue --> Revenue Vault --> Rewards Distributor
                          |                    |
                          +--> Treasury        +--> Droid Account only
```

Every identity is collision-safe across sibling collections:

```solidity
keccak256(abi.encode(chainId, collectionAddress, tokenId))
```

Token ID alone is never a canonical identifier. Monad D.Y.O.O.R and Robinhood HoodYØØR remain separate native collections and are not represented as bridged copies.

## Contract modules

| Module | Responsibility | Custody or authority boundary |
| --- | --- | --- |
| `HoodYoorDroidRegistry` | Registers eligible local collections and immutable resolver versions | Reads live NFT ownership; cannot move Droid assets |
| `HoodYoorAssetRegistry` | Allowlists native/ERC-20 assets by chain-local address | Configuration only; never holds assets |
| `HoodYoorStrategyRegistry` | Stores owner-selected, versioned preferences for future rewards | Never sells, swaps, approves, or moves existing assets |
| `HoodYoorAchievementRegistry` | Stores evidence-linked achievements and capped modifiers | No asset custody; modifiers are public snapshot inputs |
| `HoodYoorRevenueVault` | Splits approved-source deposits into project, reward, and other-approved accounting | Can release only accrued balances to configured destinations |
| `HoodYoorRewardsDistributor` | Reserves funded epochs and verifies claims | Claims pay the active Droid Account only; no admin withdrawal |

All six modules are immutable deployments using delayed role administration. Existing Droid Account V1 instances remain unchanged and continue to derive authority from the current NFT owner.

## Account and transfer lifecycle

1. The application derives `(chainId, collectionAddress, tokenId)`.
2. The chain-local Droid registry resolves the configured immutable account-facade version.
3. The account address is deterministic even before activation.
4. Activation still uses the existing ERC-6551 registry/facade flow.
5. Assets deposited or claimed to that address are controlled through the NFT.
6. If the NFT is transferred, the previous owner immediately loses account authority and the new owner immediately gains it.

The profile must keep this warning visible whenever the account contains assets:

> Transferring this Droid may transfer control of its Droid Wallet and the assets inside it. Assets are not automatically returned to the current owner wallet.

Existing trait rerolls continue to work because they update the existing trait state/renderer and require NFT-owner authorization independently of the account. No token, renderer, reroll, or Energy contract is replaced by this upgrade.

## Revenue and reward lifecycle

1. A reviewed revenue source deposits an approved asset using a unique `revenueId`.
2. The vault verifies an exact ERC-20 balance increase, rejects replayed IDs, and records project/reward/other-approved shares under the three-part allocation active at deposit time.
3. A release role sends the reward share to the fixed distributor; the distributor accepts native funding only from its permanently bound vault.
4. An operator prepares a chain-qualified manifest from verifiable activity inputs.
5. The epoch transaction publishes the manifest hash, Merkle root, asset, allocation, and time window. The distributor refuses underfunded epochs.
6. The current NFT owner presents the allocation proof. The contract verifies current ownership, active account bytecode, account version/address, replay state, and the declared epoch total.
7. The approved settlement asset is transferred directly to the Droid Account.

The StandardMerkleTree-compatible allocation leaf commits:

```text
epochId
chainId
collectionAddress
tokenId
accountVersion
droidAccount
strategyId
rewardWeight
amount
```

Claims are `O(log n)`, so no transaction loops over the collection. Expiring an epoch releases its accounting reservation for a later epoch but does not give an admin a path to withdraw distributor funds.

## Reward weight and achievements

V1 publishes reward weight rather than computing it in the custody contract. A manifest-generation policy can combine on-chain staking, Build participation, quests, loyalty, and achievements, subject to documented per-source caps. Each manifest is content-addressed and committed on-chain.

Rules for every epoch:

- never treat Energy as money;
- never reward raw transaction volume by itself;
- disclose inputs, caps, exclusions, and allocation arithmetic;
- snapshot by canonical Droid identity;
- verify minted tokens and their official account addresses before publication;
- reject duplicate identities and allocations whose sum differs from `totalAllocated`.

Achievement definitions are versioned operational inputs. The initial contract caps any single achievement at 500 basis points and total achievement modifiers at 2,000 basis points; a future replacement version is required to change those immutable safety limits.

## Strategies and asset routing

A strategy is a generic, versioned basket definition with metadata, approved assets, allocations, adapter address, and risk metadata. Selecting a strategy is authorized by the live NFT owner and affects future reward snapshots only.

V1 deliberately does not execute a strategy. Claims retain the approved settlement asset. `IHoodYoorAssetRouter`, `IHoodYoorBridgeAdapter`, and `IHoodYoorAgentGateway` define future integration boundaries but have no implementations or permissions in this release.

If a future route cannot legitimately acquire an asset, the correct behavior is to retain or make claimable the settlement asset—not fabricate a swap.

## Application and data flow

- The HoodYØØR Droid profile adds Rewards and Strategy sections behind independent flags.
- The HoodYØØR collection page uses exact frozen assignment renders and labels the economic model as staged until deployment review is complete.
- `/droids` is a chain-badged aggregate shell. Robinhood can use the existing direct reader; Monad remains disabled until a chain-local account implementation/facade is reviewed and deployed.
- `/admin/droid-economy` prepares immutable manifests and verifies actual epoch receipts. It has no signer, private key, or transaction-broadcast capability.
- Admin mutations use the existing wallet-signature scheme with route, action, payload hash, Robinhood chain ID, timestamp, and a durable one-time nonce.
- Full allocation proofs stay in protected Netlify/local storage. Admin status returns only public epoch commitments.
- The additive Supabase migration supports indexing and analytics, but on-chain ownership, balances, claims, and contract events remain authoritative.

## Feature flags

Wallet and portfolio views can remain enabled against the existing account system. New economic behavior defaults off:

```text
DROID_REWARDS_ENABLED=false
DROID_STRATEGIES_ENABLED=false
MONAD_DROIDS_ENABLED=false
SHARED_TREASURY_ENABLED=false
CROSS_CHAIN_BRIDGE_ENABLED=false   (code-locked)
DROID_AGENT_ENABLED=false          (code-locked)
```

Both bridge and agent gates are hard-coded false in public and server configuration. Changing environment variables alone cannot enable them.

## Multi-chain treasury model

Each native chain must have an independently deployed, independently funded vault and distributor. The frontend/indexer may aggregate verified balances into a logical HoodYØØR treasury view, but there is no global custody contract and no automatic bridge.

```text
Robinhood Vault -- Robinhood assets --+
                                       +--> read-only unified index/UI
Monad Vault ------ Monad assets -------+
```

Cross-chain records in the database are future operational records only. They do not authorize transfers.

## Version and migration policy

- Existing NFT and Droid Account contracts remain immutable.
- Account resolver versions cannot be replaced after registration; a new version receives a new number.
- Strategy definitions create immutable versions.
- Economic contracts are not proxies. A security or feature upgrade deploys a new version, redirects only future revenue/funding after a timelocked review, and leaves historical events verifiable.
- No holder migration or remint is required.

## Known limitations and deferred work

- The economic contracts and migration have not received an independent audit.
- No oracle or fiat valuation is used. The UI must display `Value unavailable` when a price source is unavailable.
- V1 does not discover arbitrary ERC-20s, execute swaps, rebalance portfolios, bridge funds, or run an agent.
- Monad Droid wallets remain disabled pending a separate chain-local account deployment and review.
- Activity-weight policy and the first funded epoch require public operational specifications and independent reconciliation.
- External marketplaces may not display or price assets controlled by a Droid Account.

Operational security and rollout details are in [hoodyoor-economic-droid-security.md](./hoodyoor-economic-droid-security.md) and [hoodyoor-economic-droid-deployment-report.md](./hoodyoor-economic-droid-deployment-report.md).
