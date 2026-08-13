# HoodYØØR Economic Droid Upgrade — Audit and Impact Report

Date: 2026-08-11

Status: implementation preflight. No production transaction is authorized or performed by this update.

## Executive decision

The economic Droid system can be added without replacing either native NFT collection and without modifying the deployed HoodYØØR ERC-6551 accounts, reroll controller, trait renderer/store, staking contracts, or either Energy ledger.

The safe boundary is:

```text
existing native NFT
        |
        v
existing/versioned ERC-6551 account resolver
        |
        +---- existing Energy and trait systems (unchanged)
        |
        +---- new per-chain economic modules
                  asset registry
                  strategy registry
                  revenue vault
                  Merkle reward epochs
                  claim-to-Droid
```

Every persistent Droid record uses `(chainId, collectionAddress, tokenId)`. Token ID alone is never treated as a global identity.

## Repository architecture discovered

### Application

- Next.js 16 App Router, React 19, strict TypeScript, Tailwind, Netlify deployment.
- Wallet access is centralized in `providers/WalletServiceProvider.tsx` and currently supports the existing injected/Privy-compatible application flow.
- Chain reads use ethers v6 and viem/wagmi where appropriate.
- Durable operational data uses the `src/lib/storage/fileStore.ts` abstraction: local JSON in development and strongly consistent Netlify Blobs in production.
- Supabase currently backs the quest/user schema in `supabase/schema.sql`; it is not authoritative for NFT ownership or asset balances.
- Protected admin APIs use `lib/adminAuth.ts`: owner-wallet signatures bind version, domain, route, action, payload hash, timestamp, and a durable one-time nonce.

### Native collections and chains

| Native chain | Chain ID | Collection | Status |
| --- | ---: | --- | --- |
| Monad | 143 | D.Y.O.O.R S2 `0x349D8eb480c92cF75371fbA5C6344A4d11b9103A` | Existing native collection |
| Robinhood Chain | 4663 | HoodYØØR `0x8277F8126722B11D7b44C5C453bcF62A78AAFa25` | Existing native collection |

Monad D.Y.O.O.R and Robinhood HoodYØØR are sibling collections, not bridged copies. The existing Monad S1 collection and Ascension staking system remain separate inputs to future activity/weight calculations.

### HoodYØØR deployed boundary

- Collection: `0x8277F8126722B11D7b44C5C453bcF62A78AAFa25`
- Energy Bank: `0x9bA9aa6c6A1CB04bc0477E90f4D93214c6b1D7c3`
- Reroll V2: `0x6cf24a0119b7286ad88855Baa9CB220DF628FD11`
- ERC-6551 implementation V1: `0x0FFDc6ACb41D39ee7b535026202AA8fe0054F52A`
- Official HoodYØØR account facade: `0x190602Aa70199ec3623ad3bc97a10B534b26fE48`
- Canonical ERC-6551 registry: `0x000000006551c19487814612e58FE06813775758`

`DroidAccountV1` is immutable and has no project-admin or agent execution path. It resolves control from the current `ownerOf(tokenId)`, supports owner calls/batches and ERC-1271, and rejects controlling-collection nesting plus detected account ownership cycles. `DroidAccountRegistry` is an immutable, adminless facade over the canonical singleton registry.

### Energy, staking, Build, traits, and metadata

- Robinhood Energy is a non-transferable integer ledger in `HoodYOOREnergyBank.sol`, keyed by address with separate credit, spender, and pauser roles.
- Monad Energy is a distinct 18-decimal, non-transferable progression ledger backed by the existing staking/indexing/reconciliation stack.
- Ascension staking and `PointsClaimed` event indexing already feed Monad Energy. These events may later be verified inputs to a capped reward-weight snapshot; Energy is never converted into money.
- DYOOR Build/Ascension Blueprints currently save signed campaign participation through the existing Netlify function and storage flow. It does not provide a production revenue vault.
- HoodYØØR rerolls update the existing packed trait state and renderer. Droid-account ownership does not alter token ownership or metadata and therefore does not interfere with rerolls.
- Existing trait marketplace/bounty and DYOOR World reward code concerns Energy/game rewards; it is not a safe substitute for a real-asset reward pool.

### Indexing and portfolio

- The live HoodYØØR Droid pages use direct RPC reads and bounded event scans from configured start blocks.
- ERC-20 discovery is allowlist-based; fiat values remain unavailable unless a reliable pricing source exists.
- No existing production revenue vault, strategy registry, approved-asset registry, real-asset reward epoch engine, bridge adapter, ERC-4337 session-key system, or unrestricted agent exists.

## Component classification

### KEEP — byte-for-byte / semantics unchanged

- Both deployed NFT collections and their token IDs, ownership, metadata, royalties, and collection identity.
- HoodYØØR renderer, trait store/rules, frozen assignment data, and reroll V2.
- Robinhood and Monad Energy economics and ledgers.
- Ascension staking and Energy reconciliation/indexing.
- DYOOR Build and Blueprint flows.
- Deployed HoodYØØR `DroidAccountV1` and `DroidAccountRegistry`.
- Existing wallet provider, holder verification, and transfer warnings.
- Existing production addresses and environment variables.

### EXTEND — additive code only

- Droid TypeScript identity becomes explicitly multi-chain-safe.
- Droid profile gains native-chain, strategy, reward, achievement, and real-asset portfolio views behind feature flags.
- Storage gains chain-qualified epoch/index records; on-chain state remains authoritative.
- Admin tooling gains separate economic-module status and manifest preparation.
- Direct-read indexing gains an event-compatible economic cache rather than a new mandatory subgraph.

### ADD — new versioned companion contracts per native chain

- `HoodYoorDroidRegistry`: maps eligible local collections to their immutable account resolvers.
- `HoodYoorAssetRegistry`: allowlists assets by local chain and contract address.
- `HoodYoorStrategyRegistry`: generic, versioned future-reward preferences; it never sells existing assets.
- `HoodYoorRevenueVault`: accounts separately for treasury and Droid reward shares.
- `HoodYoorRewardsDistributor`: funded Merkle epochs with one claim per canonical Droid, paid only to its active Droid Account.
- `HoodYoorAchievementRegistry`: transparent, capped achievement modifiers for future snapshot inputs.
- Router, bridge, and agent interfaces only. No router, bridge, session key, or autonomous execution is enabled in this release.

### REPLACE ONLY IF REQUIRED

Nothing identified in this audit requires replacement.

Monad needs a chain-local ERC-6551 implementation/facade before Monad Droid wallets can be enabled. That is a new companion deployment, not an NFT migration. The Robinhood implementation is already available and remains its V1 address.

## Economic and custody rules

1. Energy and real assets have independent ledgers and units.
2. Reward weights are published per epoch with a content hash and Merkle root; the distributor does not derive dollar value or trust mutable frontend claims.
3. Claims require current NFT ownership at execution time and pay the deterministic, already-activated Droid Account—not the caller wallet.
4. NFT transfer changes account control immediately. An unclaimed allocation follows the canonical Droid identity; a previous owner cannot claim after transfer.
5. Strategy selection affects only future allocation snapshots. V1 claims retain the funded settlement asset.
6. Vault roles can account and route project revenue only to configured project/reward/other-approved destinations. They cannot execute from Droid Accounts.
7. Admin recovery is limited to unaccounted/excess vault funds and the fixed treasury destination. Distributor funds remain available only for reward epochs; neither module can seize a Droid's assets.

## Multi-chain design

Contracts are deployed independently on each native chain. A logical aggregate is produced by the application/indexer:

```text
Monad vault + reward epochs ---------+
                                      +--> chain-qualified index --> unified UI
Robinhood vault + reward epochs -----+
```

No automatic bridge is part of V1. `CROSS_CHAIN_BRIDGE_ENABLED` and `DROID_AGENT_ENABLED` are hard-disabled. A future bridge adapter requires a separate security review and explicit approval.

## Security impact

- New custody is limited to explicitly funded project revenue/reward pools; NFT-holder assets remain inside their own Droid Accounts.
- Claims use checks-effects-interactions, reentrancy protection, exact accounting, current `ownerOf`, active-account verification, and replay protection by `(epochId, droidKey)`.
- ERC-20s must be explicitly registered; fee-on-transfer behavior is rejected by exact-balance accounting at deposit.
- Reward allocation avoids `O(totalSupply)` transactions through Merkle proofs.
- Published weight and amount are both committed in each leaf. Activity/Energy inputs are computed off-chain from verifiable sources and capped by a public epoch manifest.
- No delegatecall, arbitrary target execution, unlimited router approval, oracle valuation, cross-chain replay path, or AI authority is introduced.
- The contracts are immutable/versioned rather than proxy-upgradeable. New behavior requires a new version and explicit migration of future funding only.

## Standards and current network verification

- ERC-6551 specifies deterministic accounts from implementation, salt, chain ID, token contract, and token ID, and explicitly calls out ownership-cycle and marketplace-state risks: <https://eips.ethereum.org/EIPS/eip-6551>
- Robinhood's official documentation lists mainnet chain ID 4663, ETH gas, and the current public RPC/explorer endpoints: <https://docs.robinhood.com/chain/connecting/>
- Monad's official chain configuration lists mainnet chain ID 143: <https://docs.monad.xyz/developer-essentials/changelog>
- OpenZeppelin Contracts 5.x primitives are used for role control, pausing, reentrancy protection, safe ERC-20 calls, and Merkle verification: <https://docs.openzeppelin.com/contracts/5.x/>

## Implementation sequence

1. Add canonical multi-chain identity types and feature flags.
2. Add and unit-test local-chain Droid, asset, strategy, achievement, vault, and reward modules.
3. Add an additive database migration and chain-derived index storage.
4. Add disabled-by-default reward/strategy profile panels and a multi-chain squad shell.
5. Add signed admin manifest generation/status tooling.
6. Run local Solidity, TypeScript, lint, build, and fork regression checks.
7. Produce a deployment/migration report. Stop before any broadcast.

## Explicitly deferred

- DEX or Robinhood asset acquisition adapters.
- Automatic strategy execution or rebalancing.
- ERC-4337/session keys and any agent gateway.
- Automatic cross-chain movement.
- Oracle-backed fiat enforcement or guaranteed portfolio prices.
- Guaranteed rewards, hardcoded financial categories, or any Energy-to-money exchange rate.

## Files affected by the upgrade

New modules will be isolated under:

- `contracts/hoodyoor/src/economic/`
- `contracts/hoodyoor/test/HoodYoorEconomicDroid.t.sol`
- `lib/droid-economy/`
- `src/lib/storage/droidEconomyStore.ts`
- `app/api/robinhood/droid-economy/`
- `app/api/admin/droid-economy/`
- `components/robinhood/droids/DroidEconomyPanel.tsx`
- `components/robinhood/HoodYoorCollectionInfo.tsx`
- `app/admin/droid-economy/`
- `supabase/migrations/`

Existing deployed contract sources are audit inputs only and are not edited for this feature.
