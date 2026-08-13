# Monad D.Y.O.O.R Droid Integration Plan

Status: implementation, automated tests, live fork simulation, and read-only preflight complete; no Monad production transaction authorized or sent.

## Scope

Integrate the already-deployed Monad Season 2 D.Y.O.O.R collection into the common HoodYØØR Droid Account, portfolio, Energy, economic-module, and dashboard architecture. This is an additive companion deployment. It does not replace, remint, proxy, migrate, or configure the parent NFT.

Canonical identity remains:

```text
keccak256(abi.encode(chainId, collectionAddress, tokenId))

(143, 0x349D8eb480c92cF75371fbA5C6344A4d11b9103A, tokenId)
                              |
                              v
                  deterministic Droid Account
                              |
             MON / approved ERC-20 / NFT inventory
```

## Audit snapshot

Read-only checks were refreshed through the configured Monad RPC at block `95,362,095` (`2026-08-12T13:52:45Z`). These values are a point-in-time preflight and must be refreshed before deployment.

| Check | Result |
| --- | --- |
| Chain | Monad mainnet, chain ID `143` |
| Collection | `0x349D8eb480c92cF75371fbA5C6344A4d11b9103A` |
| Name / symbol | `D.Y.O.O.R` / `DYOOR` |
| Standard | ERC-721 + ERC-721 Metadata; not ERC-721 Enumerable |
| Live / minted / burned | `1,038` / `1,096` / `58` |
| Token IDs | start at 1; issued range currently reaches 1,096; burned IDs make `totalSupply()` unsuitable as an upper scan bound |
| Maximum supply | `3,333` from both `maxSupply()` and `MAX_SUPPLY()` |
| Sample metadata | token 1 resolves to `https://dyoor.netlify.app/api/metadata/1` |
| Transfers / approvals | holder-originated `approve`, `transferFrom`, and `safeTransferFrom` read-only simulations succeeded |
| Burn | holder-originated `burn(1)` read-only simulation succeeded; state remained unchanged because this was `eth_call` |
| Upgradeability | direct deployment; EIP-1967 implementation and beacon slots are zero |
| Runtime | 20,852 bytes; code hash `0x2baa62e8fad053a2b59e10eb8dbfc9bbb8ef98c93a55a1114ff7776226ae15fd` |
| Verification | repository deployment record reports an exact Sourcify match using Solidity 0.8.17, optimizer runs 1 |
| Metadata frozen | no; `metadataFrozen()` returned false |

The current Foundry artifact at `out/DYOORSeason2SeaDrop.sol/DYOORSeason2SeaDrop.json` exactly matches the live runtime hash. The checked-in source currently contains historical configuration values that do not all describe the deployed constructor state, so deployment records plus bytecode are the authoritative audit evidence for the live collection.

## Staking custody decision

Ascension is a custody staking contract for the separate Season 1 collection:

- Season 1 collection: `0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f`
- Ascension: `0xf9611226c1CcCcCa37951938d6f358D3d5106549`
- live Season 1 balance held by Ascension: `503`
- live Season 2 balance held by Ascension: `0`
- the application staking flow explicitly transfers Season 1 tokens and reads `stakeInfo(tokenId)` for Season 1

Therefore the requested Season 2 collection is not currently custody-staked. Its secure controller is its live `ownerOf(tokenId)`.

No Ascension override will be introduced for Season 2. Reusing `stakeInfo(tokenId)` across collections would be unsafe because a Season 1 token and a Season 2 token can share the same token ID. A Season 2 resolver could otherwise hand control to an unrelated Season 1 staker.

If a future Season 2 custody staking contract is introduced, it requires all of the following before support:

1. a resolver version that binds the exact `(chainId, collection, stakingContract)` tuple;
2. proof that the custodian records the depositor for that exact collection;
3. tests for unstaked, deposited-but-unregistered, staked, unstaking, transferred, and recovery states;
4. a new versioned account implementation/facade, rather than silently changing existing account authority.

Directly transferring a Season 2 NFT into the Season 1 Ascension contract is not staking and must never grant control using Season 1 records.

## Existing architecture classification

| Component | Decision | Notes |
| --- | --- | --- |
| Season 2 NFT and metadata | KEEP | Existing identity, ownership, burn, metadata, Trait Lab, and marketplace behavior remain untouched |
| Season 1 Ascension staking | KEEP | Separate activity/Energy input; never treated as Season 2 ownership |
| Monad Energy Bank | KEEP + EXTEND READS | Existing non-transferable Energy remains progression utility; Droid UI only reads it |
| `DroidIdentity` | KEEP | Already chain/collection/token qualified |
| `DroidAccountV1` | REUSE | Immutable current-owner authority, ERC-1271, ERC-721/1155 receive, owner execution, cycle protection |
| `DroidAccountRegistry` | REUSE | Immutable collection/chain/implementation facade; lazy deterministic activation |
| Common account/portfolio services | EXTEND | Select configuration by native chain; preserve Robinhood behavior |
| Common economic contracts | REUSE | Chain-local deployments use the same source and chain-qualified identities |
| Unified Droid dashboard | EXTEND | Add Monad squad and profile links using the same account components |
| ERC-4337 / agent execution | DEFER | Monad has canonical EntryPoint deployments, but V1 exposes no session or agent authority |
| Bridge execution | DEFER | Remains code-locked off |

## Token-bound infrastructure audit

At the audit block:

- the canonical ERC-6551 registry address `0x000000006551c19487814612e58FE06813775758` had no code on Monad;
- Nick's deterministic deployment factory `0x4e59b44847b379578588920cA78FbF26c0B4956C` was present;
- canonical ERC-4337 EntryPoint v0.6, v0.7, and v0.8 addresses had code.

V1 uses ERC-6551-style deterministic accounts only. It does not claim ERC-4337 support. Before Droid deployments, the canonical ERC-6551 registry must be deployed through the standard deterministic transaction and its runtime hash must equal `0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735`.

## Implementation

### Contracts

No parent-NFT change is required.

Monad requires these new companion deployments:

1. canonical ownerless ERC-6551 registry at the standard address, because it is currently absent;
2. the existing immutable `DroidAccountV1` implementation bytecode;
3. the existing immutable `DroidAccountRegistry` facade configured with chain `143`, the Season 2 collection, the implementation, and reviewed salt;
4. later, only after separate approval, chain-local instances of the common economic modules.

The account implementation and activation facade have no project administrator and no user-fund withdrawal backdoor. Economic module administrators cannot execute from Droid Accounts.

The verified Robinhood V1 Solidity sources and local sources match byte-for-byte. After normalizing constructor-patched immutable slots and stripping compiler metadata, the local creation/runtime executable hashes match the verified implementation. The Monad preflight treats those reference hashes as hard release invariants.

### Application

- make `DroidProtocolConfig` native-chain aware, including native symbol, Energy decimals, artwork route, and controller policy;
- use the common Monad/Robinhood network switch adapter for writes;
- fix burned-collection fallback discovery to scan `totalMinted()`, not `totalSupply()`;
- expose a common chain-qualified API and keep the existing Robinhood route compatible;
- render actual Season 2 artwork through the existing metadata/PFP image pipeline;
- add Monad squad/profile routes using the existing Droid UI components;
- display MON, not ETH, on Monad;
- show explicit transfer and burn lockout warnings;
- keep rewards, strategies, bridge, and agents disabled until their chain-local contracts are reviewed and deployed.

### Energy

Monad `DYOOREnergyBank` is an 18-decimal, non-transferable internal point ledger. It is not an ERC-20 and receives no price. The Droid profile may display:

- the current NFT owner's existing Energy balance;
- the Droid Account address's Energy balance if explicitly credited by an existing authorized ecosystem flow.

This integration does not move owner Energy into the Droid Account, create a second ledger, modify spending roles, or change reroll/build economics.

### Rerolls, layers, and burns

Trait rerolls and layer updates continue to work because the Droid Account binding uses `(chainId, collection, tokenId)`, not metadata or traits.

Burn is different: destroying the parent NFT makes `ownerOf(tokenId)` revert and the account fails closed with no controller. Assets left inside would be locked. The Droid profile must state this clearly, and existing burn surfaces should consume the reusable asset-warning state before a burn is confirmed. V1 does not invent a cached post-burn owner because that would weaken ownership security.

## Tests

Required local tests:

- deterministic address and lazy activation on chain-qualified binding;
- direct Season 2 current-owner control;
- old owner loses and new owner gains authority immediately after transfer;
- old ERC-1271 signature fails after transfer;
- burned token makes account authority zero/fail closed;
- Season 1 staking custody does not affect a same-numbered Season 2 Droid;
- a foreign custody record cannot authorize a Season 2 account;
- native MON, ERC-20, ERC-721, and ERC-1155 custody/withdrawal;
- self-ownership and multi-account cycles fail closed;
- non-enumerable/burned supply ownership discovery scans the issued range;
- Monad config, actual-art route, feature flags, and generic network switching;
- no bridge or agent feature can be enabled.

The optional live fork test passed against chain 143, proving the immutable collection facts, Season 2 `balanceOf(Ascension) == 0`, direct account control, immediate authority transfer, and unchanged metadata/Energy reads. It remains separate from offline CI so deterministic local suites do not require public RPC access.

## Deployment and migration impact

There is no NFT migration and no existing production contract redeployment. Existing token IDs, owners, metadata URLs, Trait Lab state, Energy balances, staking records, and Robinhood Droid addresses remain unchanged.

Deployment is lazy at two levels:

- only three shared companion contracts are needed for initial Monad account support (including the missing canonical registry);
- each token-specific account is created only when its current owner activates it.

The deployment script must default to dry-run, require exact Monad-specific acknowledgements for broadcast, verify chain/code hashes/collection invariants, estimate gas, require a safety buffer, checkpoint every transaction, and stop before enabling website flags. This plan does not authorize a mainnet broadcast.

## Security limitations

- The new integration is not independently audited.
- Any asset sent to a counterfactual address before canonical registry and implementation verification is at risk; the UI will require activation before funding.
- Burning a funded parent NFT locks the account by design.
- Arbitrary owner `CALL` execution carries external-protocol and malicious-token risk.
- Unknown ERC-20s are not promoted as supported assets.
- Fiat values remain unavailable unless a reviewed price source exists.
- No marketplace is assumed to understand account contents.
- No agent, session key, bridge, DEX adapter, or autonomous strategy is enabled.

## Sources

- Monad network and canonical contract information: <https://docs.monad.xyz/developer-essentials/network-information>
- ERC-6551 deterministic registry/account model and ownership-cycle warning: <https://eips.ethereum.org/EIPS/eip-6551>
- Local deployment evidence: `deployments/dyoor-s2-seadrop-mainnet.latest.json`
- Local verification evidence: `deployments/dyoor-s2-verification-143-0x349D8eb480c92cF75371fbA5C6344A4d11b9103A.json`
