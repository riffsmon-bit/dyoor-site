# Droid Account V1 implementation plan

Date: 2026-08-10

Status: implemented. Mainnet deployment was separately authorized by the owner and completed on 2026-08-11; this document preserves the design rationale and original staged plan.

## Executive decision

HoodYØØR Droid Accounts will extend the existing NFT rather than modify or replace it. The canonical controlling collection is the deployed SeaDrop V2 collection at `0x8277F8126722B11D7b44C5C453bcF62A78AAFa25` on Robinhood Chain (chain ID 4663). The earlier custom collection at `0x1Ece69C63F0b49C7a5B02eaf209059B4E2aF69a1` is explicitly recorded as superseded-before-mint and is not eligible.

Robinhood Chain mainnet and testnet already contain the canonical ERC-6551 registry at `0x000000006551c19487814612e58FE06813775758`. Both networks returned the same 571-byte runtime code with keccak256 `0xda1d5b06e579f9e42e59b00fbc22939896ecb38dc8830d40de0a2508fecd6735` during this audit. V1 will use that ownerless registry instead of deploying a competing or admin-controlled CREATE2 factory.

The repository will add:

1. an immutable `DroidAccountV1` implementation with current-NFT-owner execution;
2. an immutable HoodYØØR `DroidAccountRegistry` activation facade that pins the canonical registry, eligible collection, implementation, chain, and salt;
3. Foundry security tests using an exact registry-compatible proxy layout;
4. a Robinhood-native Droid Account dashboard, activation, funding, inventory, withdrawal, transfer warning, activity, and security UI;
5. modular readers and types for assets, Energy, Equipment, XP, Droid Score, Directives, Missions, and later agent permissions;
6. dry-run-first deployment tooling with exact chain-specific mainnet gates, live invariant checks, gas buffering, and checkpoint-safe resume.

ERC-4337 and session-key execution are deliberately deferred. Robinhood documentation states that the chain supports ERC-4337, batching, sponsorship, and session keys, but the repository does not contain a selected EntryPoint version, bundler, paymaster, or audited permission module. V1 keeps owner authority isolated and exposes no agent execution path.

## Repository architecture discovered

### Framework and frontend

- Root application: Next.js 16.2.9 App Router, React 19.2.7, strict TypeScript, Tailwind CSS, and Netlify's Next.js plugin.
- Web3 clients: ethers 6.13, viem 2.47, wagmi 3.6, and Privy React Auth 3.35.
- Shared providers: `providers/AppProviders.tsx` and `providers/WalletServiceProvider.tsx`.
- The current wallet facade supports Privy/external EVM wallets and raw EIP-1193 requests. Its convenience network status and signer helpers are Monad-oriented; Robinhood flows already use the raw provider and explicit chain switching rather than replacing the wallet system.
- Robinhood UI currently lives under `app/robinhood` with campaign-specific components in `components/robinhood`. `/robinhood` is the GTD flow and `/robinhood/trait-lab` is the reroll flow. These routes use a standalone HoodYØØR visual language and intentionally suppress the general site navigation/footer.
- Production builds use `npm run build`; lint and type checking are separate scripts.

### Contract and deployment tooling

- General DYOOR contracts use Hardhat 3 with Solidity 0.8.17 and 0.8.28.
- HoodYØØR uses the isolated Foundry project in `contracts/hoodyoor`, Solidity 0.8.24, Paris EVM, optimizer 200, and IR compilation.
- HoodYØØR deploy scripts use ethers and checkpointed JSON manifests under `deployments/robinhood`. Broadcasts require explicit acknowledgements and are dry-run by default.
- Generated Foundry artifacts are under `contracts/hoodyoor/out`; frontend/server ABIs are otherwise small, purpose-specific ABI fragments embedded near their consumers.
- No proxy upgrade system exists for HoodYØØR. The live collection, renderer, trait store, Energy configuration, and reroll controller are deliberately frozen or immutable.

### Supported networks

- Monad mainnet: chain 143, native MON, used by Season 1, Ascension, Season 2, staking, the general Energy Bank, Trait Lab, World, and marketplace flows.
- Monad testnet: chain 10143 is configured for development.
- Robinhood Chain mainnet: chain 4663, native ETH, canonical explorer `https://robinhoodchain.blockscout.com`.
- Robinhood Chain testnet: chain 46630, native ETH, explorer `https://explorer.testnet.chain.robinhood.com`.
- Public Robinhood RPC defaults already appear in the repository. Production can use a server-only provider endpoint; no credentialed RPC will be exposed in browser code.

### Canonical HoodYØØR deployment

The active deployment is recorded in:

- `deployments/robinhood/hoodyoor-seadrop-v2-4663.json`
- `deployments/robinhood/hoodyoor-seadrop-v2-verification-4663.json`
- `deployments/robinhood/hoodyoor-v1-abandonment-4663.json`

Canonical V2 addresses:

- Collection: `0x8277F8126722B11D7b44C5C453bcF62A78AAFa25`
- HoodYØØR Energy Bank: `0x9bA9aa6c6A1CB04bc0477E90f4D93214c6b1D7c3`
- Reroll controller V2: `0x6cf24a0119b7286ad88855Baa9CB220DF628FD11`
- Pixel renderer: `0xb9cB0563013D9741f76a802d2F658EbF3433eE12`
- Packed trait store: `0xaD7be6b27efDF619759375aF719A9D69e25818c1`
- Trait rules: `0xd4E7F224539e628f58c4A6159A7a0eeE27991640`
- USDG: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`
- Canonical SeaDrop: `0x00005EA00Ac477B1030CE78506496e8C2dE24bf5`

`HoodYOORSeaDrop.sol` is a custom, non-enumerable ERC-721 implementation with token IDs beginning at 1, a fixed maximum supply of 3,333, fully on-chain metadata, dynamic current ownership through `ownerOf`, and ordinary ERC-721 transfer semantics. No collection edit is required for a token-bound account.

### Energy

There are two related but separate Energy systems:

- Monad `DYOOREnergyBank`: non-transferable, 18-decimal internal points integrated with Ascension harvest indexing, Netlify Blobs/local storage diagnostics, reconciliation, recharge, transfer, and admin tooling.
- Robinhood `HoodYOOREnergyBank`: non-transferable integer points keyed by address, with credit/spender/pauser roles. The HoodYØØR collection credits mint Energy to the minter wallet and the reroll controller spends it.

Energy is not an ERC-20 in either system. V1 will not create a second Energy asset or migrate owner Energy into an account. It will read and label both the Droid Account address balance and the commander's existing wallet balance. Future protocols may credit the Droid Account address directly using the existing bank and explicit economics.

### Traits, rerolls, burns, equipment, and staking

- HoodYØØR traits are packed on-chain, rendered by the frozen renderer/store, and changed only by the frozen V2 reroll controller using Energy, ETH, or USDG settlement.
- Season 2 has separate trait lab, burn, bounty, marketplace, rendering, and metadata services under `app/api/s2`, `lib/s2-*`, and the root contracts.
- The existing game prototype has deterministic off-chain inventory, quest, party, Energy, role, and save models under `apps/game`; it performs no production chain writes.
- Ascension staking is an existing Monad contract and is read through direct RPC plus Goldsky/fallback log scanning. It is not a HoodYØØR staking contract and will not be duplicated for Droid Accounts.
- No current on-chain Equipment registry exists. V1 will add neutral interfaces/types and an ownership-derived resolver boundary without changing existing metadata or trait semantics.

### APIs, storage, indexing, and holder roles

- Next.js API routes and legacy Netlify Functions coexist.
- Runtime JSON data uses Netlify Blobs in production and local JSON stores in development. Supabase backs the older quest/user schema. The new Discord application uses SQLite with durable verification, entitlement, role-sync, and audit tables.
- HoodYØØR holder role support already exists in `apps/discord`: it reads the canonical V2 `balanceOf` on chain 4663 and revalidates roles with RPC-failure grace behavior. Droid Account work must not alter this registry or role logic.
- Existing ownership discovery patterns use direct reads, chunked Transfer log scans, and optional Alchemy/Goldsky APIs. The collection is small enough for chunked direct reads initially.
- There is no existing generic portfolio engine. Existing balance and price reads are feature-specific.

### Smart-account audit result

- No ERC-6551 account, token-bound account, ERC-4337 account, session-key module, agent gateway, or Droid portfolio currently exists.
- ERC-1271 signature verification already exists for HoodYØØR rerolls and supports EOA and smart-contract owners. Its strict ECDSA and `SignatureChecker` libraries can be reused.
- The canonical ERC-6551 registry is deployed on both Robinhood networks, but nothing in the repository currently integrates it.

## Proposed V1 contracts

### `DroidAccountV1`

Location: `contracts/hoodyoor/src/droid/DroidAccountV1.sol`

Properties:

- immutable implementation code used through canonical ERC-6551 minimal proxies;
- binding read from the proxy's immutable bytecode footer: chain ID, token contract, and token ID;
- `owner()` always resolves the current `ownerOf(tokenId)` and never caches wallet ownership;
- owner-only `execute` supporting `CALL` only, with no delegatecall, CREATE, arbitrary agent, admin, or upgrade path;
- atomic owner-only `executeBatch` with bounded caller-supplied length and complete rollback on failure;
- receive ETH, ERC-721, ERC-1155, and ERC-1155 batch callbacks;
- ERC-165, ERC-6551 account/execution, and ERC-1271 support;
- strict EOA/ERC-1271 current-owner signature validation;
- state nonce updates and indexed execution/receipt events;
- direct implementation calls rejected;
- reentrancy guard around external owner execution;
- safe-receiver rejection for any controlling-collection NFT, preventing normal safe creation of droid nesting/cycles;
- explicit rejection when account execution attempts to transfer its own controlling NFT into itself.

The account has no admin and no withdrawal bypass. The current NFT owner is the only V1 executor.

### `DroidAccountRegistry`

Location: `contracts/hoodyoor/src/droid/DroidAccountRegistry.sol`

This is an immutable HoodYØØR activation facade, not a replacement CREATE2 factory. Constructor immutables pin:

- canonical ERC-6551 registry;
- eligible NFT collection;
- `DroidAccountV1` implementation;
- token chain ID;
- V1 salt.

It exposes deterministic `account(...)` and idempotent `createAccount(...)` methods, validates the exact official configuration, requires a live token, and requires the caller to be the current token owner for the polished activation path. The underlying canonical registry remains permissionless, so a third party may harmlessly predeploy the same account but cannot control it. The facade emits an indexed Droid activation event only for a newly deployed account.

It has no owner, upgrade, implementation setter, allowlist setter, or fund-moving authority. A future implementation version uses a new immutable facade/configuration and therefore a different deterministic account. Old V1 accounts remain usable by the NFT's current owner.

### Interfaces/foundations

Locations under `contracts/hoodyoor/src/droid/interfaces`:

- canonical ERC-6551 registry/account/execution interfaces;
- ERC-1271, ERC-721 receiver, and ERC-1155 receiver interfaces;
- a read-only Equipment resolver interface whose answers cannot move account assets.

No session authorization or Agent Gateway execution method ships in V1. Default agent authority is therefore zero by construction.

## Ownership-cycle decision

The account will reject controlling-collection NFTs in `onERC721Received`, preventing all normal `safeTransferFrom` nesting of HoodYØØR droids. It will also parse direct account execution against the controlling collection and reject attempts to send its own controlling token to itself.

An unmodified ERC-721 cannot force callers to use safe transfer. A user can still deliberately call the collection's raw `transferFrom` directly and send a parent NFT to its own account, bypassing every receiver hook. Multi-account cycles can likewise be forced through unsafe transfers or unrelated contracts. This cannot be fully prevented by a token-bound account without changing the existing NFT transfer contract, which this update correctly avoids. The UI will never offer such a destination, will show a critical warning, and the limitation will be explicit in the security document. Tests cover all preventable safe/account-executed cases and document the raw-transfer limitation.

## Frontend and server changes

### Routes

- `app/robinhood/droids/page.tsx`: connected wallet's Droid Squad plus token lookup.
- `app/robinhood/droids/[tokenId]/page.tsx`: Droid OS detail/dashboard.
- `app/api/robinhood/droid-accounts/route.ts`: read-only configured ownership, account, portfolio, inventory, Energy, activity, and squad reads.

### Components

Under `components/robinhood/droids`:

- shared cybernetic HoodYØØR shell/header;
- squad cards and aggregate balances without merged custody;
- account core/activation flow;
- funding controls for native ETH and configured allowlisted ERC-20s;
- owner send/withdraw controls for ETH, configured ERC-20s, and discovered NFTs;
- modular portfolio/inventory, Energy, Equipment, Directive, Missions, Activity, and Security panels;
- reusable, prominent asset-bearing parent NFT transfer warning.

All writes use the existing EIP-1193 wallet provider, explicitly verify chain 4663/configured test chain, display the exact account and destination, estimate gas, wait for receipts, and refresh reads. No backend ownership claim authorizes a transaction.

### Libraries

Under `lib/droid-accounts`:

- chain/config/address validation;
- ABI fragments and typed transaction encoders;
- owner/droid discovery via chunked logs plus live `ownerOf` verification;
- native, configured ERC-20, configured NFT, Energy, and on-chain activity readers;
- separate asset discovery, balance discovery, price discovery, valuation, and presentation models;
- Equipment, XP, score, Directive, Mission, session, and agent status types with disabled/unavailable V1 states.

Unknown prices remain `null` and render as `Value unavailable`; the implementation never substitutes zero. USDG is allowlisted from the repository's verified Robinhood deployment. Additional ERC-20/NFT contracts require explicit server configuration.

### Wallet configuration

Add a Robinhood chain helper and include Robinhood Chain in Privy's supported chain list while retaining Monad as the default. Existing Monad convenience methods remain unchanged. Droid write flows use their own explicit Robinhood switch helper.

## Migration impact

- No change to `HoodYOORSeaDrop.sol` or any deployed HoodYØØR contract.
- No NFT remint, metadata rewrite, ownership migration, Energy migration, role migration, or production address replacement.
- No effect on Discord HoodYØØR holder verification.
- No automatic account deployment for all 3,333 tokens; activation is lazy.
- Counterfactual addresses can be shown before deployment.
- Existing holders become eligible automatically because authority comes from current `ownerOf`.
- New environment variables are additive. Until implementation/facade addresses are configured, the dashboard fails closed with activation unavailable rather than fabricating an account.

## Security considerations

- Current ownership is checked on every execution and signature validation. Alice loses access immediately after transfer; Bob gains it immediately.
- No cached owner, deployer owner, activation owner, admin executor, delegatecall, implementation upgrade, hidden withdraw, or agent path exists.
- Failed external calls bubble revert data and atomic batches fully revert.
- Reentrancy is blocked for owner execution; malicious token callbacks cannot become authorized owners.
- ERC-1271 validates against the current owner and therefore also changes immediately on NFT transfer.
- Counterfactual safety depends on the exact canonical registry, implementation, chain, collection, and salt. UI configuration validates all of them.
- The canonical registry is ownerless; the facade is immutable and owns no funds.
- Malicious ERC-20s may lie, revert, reenter, levy fees, or return malformed data. Only configured assets receive first-class UI treatment, and arbitrary owner execution remains the owner's explicit responsibility.
- Marketplace contents can change before settlement. V1 warnings do not claim external marketplace atomicity or valuation.
- The implementation is unaudited and must not be considered production-ready solely because tests pass.

## Test strategy

Foundry tests will cover:

- counterfactual deterministic address and exact binding;
- lazy deployment, idempotent duplicate creation, invalid configuration/token, and non-owner facade activation;
- ETH, ERC-20, ERC-721, and ERC-1155 receipt and withdrawal;
- owner execute/batch, unauthorized calls, failure bubbling, bad operation, direct implementation protection, and reentrancy attempts;
- EOA and ERC-1271 current-owner signatures;
- mandatory Alice-to-Bob transfer scenario, including immediate old-owner and old-signature invalidation;
- safe self-control and nested HoodYØØR rejection, account-executed self-transfer rejection, and the explicitly unavoidable raw-transfer case;
- interface support and event/state behavior.

Root Node tests will enforce dry-run deployment safety, canonical configuration, required warning/UI states, unavailable-price behavior, and source boundaries. TypeScript typecheck, lint, Next build, and the existing test suite provide integration coverage.

## Deployment strategy and completion

The original plan called for a testnet-first release. The owner later explicitly authorized a guarded mainnet deployment after simulations. The executed path was:

1. clean Foundry build with Solidity 0.8.24, Paris EVM, optimizer 200, and IR compilation;
2. 72 passing local Solidity tests plus deployment/UI guard tests;
3. a fresh Robinhood mainnet fork test covering activation, execution, Alice-to-Bob authority transfer, old-owner failure, new-owner control, and unchanged metadata/reroll/Energy/renderer invariants;
4. live non-broadcasting checks of chain 4663, exact production collection, canonical registry runtime hash, deployer authority, frozen collection/reroll configuration, gas estimates, and a 3× ETH balance buffer;
5. deployment of immutable `DroidAccountV1` at `0x0FFDc6ACb41D39ee7b535026202AA8fe0054F52A` and immutable facade at `0x190602Aa70199ec3623ad3bc97a10B534b26fE48`;
6. independent RPC rereads of deployed bytecode/wiring and public Blockscout source verification.

No collection, mint, reveal, trait, reroll, renderer, Energy, or role transaction was included. Independent auditing remains outstanding and is not implied by the simulations.

## V1 scope

V1 ships the secure owner-controlled account body:

- canonical deterministic account address;
- lazy activation;
- current-NFT-owner control;
- native ETH and configured ERC-20 inventory/funding/withdrawal;
- configured NFT inventory and owner withdrawal;
- existing Energy reads without economic changes;
- portfolio and squad reads with unavailable valuation handled honestly;
- activity and security panels;
- mandatory parent-transfer warnings;
- immutable Equipment resolver boundary and future module types;
- comprehensive ownership-transfer tests and documentation.

## Deferred V2-V5 work

### V2 — identity

- durable XP/achievement attestation model based on meaningful events;
- manipulation-resistant Droid Score modules and configurable ranks;
- production Equipment registry/resolver and renderer/profile integration;
- expanded Energy earning/spending after economic approval;
- indexed squad/activity service if direct reads become insufficient;
- game save/inventory reconciliation with on-chain inventory.

### V3 — Directives

- audited capability/session module in a new account version or explicitly reviewed linked service;
- owner-bound authorization containing the authorizing owner address/epoch so transfers invalidate it on-chain;
- target, selector, asset, amount, expiration, reserve, and token-denominated spend controls;
- owner revoke-all and agent-only pause that never blocks owner rescue;
- concrete ERC-4337 EntryPoint, bundler, nonce, replay, and paymaster integration.

### V4 — autonomous agents

- noncustodial Agent Gateway;
- constrained strategy/mission executor;
- secure session-key storage and rotation;
- monitoring, simulation, alerting, and emergency operations;
- independent audits before any financial autonomy.

### V5 — Droid economy

- user-created Directive marketplace;
- advanced Equipment and composable squads;
- droid-to-droid protocols with explicit cycle protection;
- reputation interoperability and Robinhood-native financial missions.

## Official references checked

- ERC-6551: https://eips.ethereum.org/EIPS/eip-6551
- ERC-1271: https://eips.ethereum.org/EIPS/eip-1271
- ERC-4337: https://eips.ethereum.org/EIPS/eip-4337
- ERC-1167: https://eips.ethereum.org/EIPS/eip-1167
- CREATE2 / EIP-1014: https://eips.ethereum.org/EIPS/eip-1014
- Robinhood Chain overview and account abstraction: https://docs.robinhood.com/chain/
- Robinhood Chain network configuration: https://docs.robinhood.com/chain/connecting/
- Robinhood Chain deployment/testnet guidance: https://docs.robinhood.com/chain/deploy-smart-contracts/
- Robinhood Chain canonical token contracts: https://docs.robinhood.com/chain/contracts/
