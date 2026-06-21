# DYOOR Next.js Migration Report

## Scope

This report is the pre-coding migration audit for moving DYOOR from a static HTML/JavaScript Netlify site to a staged Next.js application with a single global wallet/session system, Monad configuration, hardened Ascension NFT discovery, and an architecture suitable for D.Y.O.O.R S2.

No runtime migration is included in this phase.

Reference: <https://docs.monad.xyz/templates/next-serwist-privy-embedded-wallet>

## Current Architecture

DYOOR is currently a static site served from the repository root.

- `netlify.toml`:
  - `publish = "."`
  - `functions = "netlify/functions"`
  - Netlify Functions use `node_bundler = "esbuild"`.
- `package.json`:
  - no `next`, `react`, `react-dom`, Tailwind, Privy, wagmi, or TanStack Query dependency.
  - local dev runs `PORT=5173 node local-dev-server.js`.
- There is no current Next.js structure:
  - no `app/`
  - no `pages/`
  - no `next.config.*`
  - no `tsconfig.json`
  - no Tailwind config
- Static app assets and pages are directly in repo root.
- Existing Netlify Functions must remain operational throughout migration.

Generated/local artifacts that should not drive architecture decisions:

- `.netlify/functions-serve/**`
- `artifacts/**`
- `cache/**`
- `node_modules/**`

## HTML Pages

Current static HTML routes:

- `index.html`
  - Home, collection preview, swap section, homepage Discord verifier surface.
- `stake.html`
  - Ascension Protocol.
- `verify.html`
  - Discord verification page.
- `build-droid.html`
  - Ascension Blueprint/Droid builder.
- `blueprint-checker.html`
  - Blueprint match checker.
- `whitepaper.html`
  - Whitepaper and project info.
- `quests.html`
  - Quest surface.
- `swap.html`
  - Redirect/shim to homepage swap.
- `admin-ascension.html`
  - Ascension Blueprint admin export.

## JavaScript Modules

User-facing frontend modules:

- `wallet-chooser.js`
  - Current global wallet/session facade and modal wallet chooser.
- `script.js`
  - Shared homepage/verify behavior, wallet UI compatibility, collection preview, Discord verifier frontend.
- `stake.js`
  - Ascension Protocol app logic, contract reads/writes, NFT discovery, energy display.
- `stake-ui.js`
  - Ascension recovery/admin UI, battery UI, status/progress patching.
- `swap-module.js`
  - Kuru Flow swap UI, token selection, balances, approvals, transaction submission.
- `dyoor-builder.js`
  - Droid builder, canvas render/export/share, Blueprint registration/signing.
- `blueprint-checker.js`
  - Blueprint verification UI.
- `admin-ascension.js`
  - Admin export UI.
- `local-dev-server.js`
  - Static dev server and local function shims.

Shared frontend modules:

- `src/ascensionBlueprintHelpers.js`
- `src/config/dyoorBuilderRules.js`
- `src/config/dyoorBuilderTraits.js`

Scripts and tests that can remain outside the Next app:

- `scripts/*.js`
- `test/*.test.js`
- `hardhat.config.js`

## Netlify Functions

Top-level functions:

- `ascension-blueprint-export`
- `ascension-blueprint-share`
- `ascension-blueprint-share-image`
- `ascension-blueprints`
- `ascension-stats`
- `discord-hourly-sync`
- `discord-login-start`
- `discord-oauth-callback`
- `discord-refresh`
- `discord-status`
- `discord-verify-nonce`
- `discord-verify-submit`
- `energy-bank-credit`
- `energy-bank-direct-credit`
- `harvested-ledger`
- `quest-admin`
- `quest-export`
- `quest-leaderboard`
- `quest-session`
- `quest-state`
- `quest-verify`
- `quote`
- `stake`
- `stakers`
- `wallet-config`

Function support modules:

- `netlify/functions/_verify/*`
- `netlify/functions/_quest/*`

These should remain in `netlify/functions` during the first Next.js phases. A later consolidation can move shared code into `lib/server` or `lib/contracts`, but the deployment path should not change until Netlify Next runtime compatibility is verified.

## Current API Endpoints

Frontend calls currently target:

- `/.netlify/functions/quote`
- `/.netlify/functions/discord-status`
- `/.netlify/functions/discord-login-start`
- `/.netlify/functions/discord-verify-nonce`
- `/.netlify/functions/discord-verify-submit`
- `/.netlify/functions/discord-refresh`
- `/.netlify/functions/harvested-ledger`
- `/.netlify/functions/energy-bank-credit`
- `/.netlify/functions/energy-bank-direct-credit`
- `/.netlify/functions/ascension-stats`
- `/.netlify/functions/ascension-blueprints`
- `/.netlify/functions/ascension-blueprint-export`
- `/.netlify/functions/ascension-blueprint-share`
- `/.netlify/functions/ascension-blueprint-share-image`
- quest endpoints under `/.netlify/functions/quest-*`
- `/.netlify/functions/wallet-config`

External APIs/services:

- Monad RPC: `https://rpc.monad.xyz`
- Kuru Flow API: default `https://ws.kuru.io`
- Monad token list GitHub URL
- Discord API
- GitHub API for harvest ledger writes
- Netlify Blobs
- Supabase

## Wallet Connection Code

Primary wallet files:

- `wallet-chooser.js`
  - `window.DyoorWallet`
  - `window.DyoorWalletChooser`
  - `eth_requestAccounts`
  - `eth_accounts`
  - `wallet_switchEthereumChain`
  - `wallet_addEthereumChain`
  - injected wallet provider detection:
    - `window.ethereum`
    - `window.okxwallet`
    - `window.phantom`
    - MetaMask, OKX, Phantom, Backpack, TokenPocket, Rabby
  - WalletConnect v2 setup
  - `accountsChanged`, `chainChanged`, `disconnect`
- `script.js`
  - compatibility wallet globals:
    - `window.provider`
    - `window.signer`
    - `window.userAddress`
    - `window.__activeEvmProvider`
  - legacy modal helpers still present.
- `stake.js`
  - consumes `window.DyoorWallet` and compatibility globals.
  - hidden local `connectBtn` still exists.
- `swap-module.js`
  - uses `window.DyoorWallet.connect()`, `getProvider()`, `getAddress()`.
  - still listens to provider account/network events locally.
- `dyoor-builder.js`
  - uses `window.userAddress` and `window.signer.signMessage`.
- `blueprint-checker.js`
  - uses `window.userAddress` and `dyoor:wallet`.
- `stake-ui.js`
  - uses `window.provider`, `window.signer`, `window.userAddress`.

HTML wallet surfaces:

- `globalWalletBtn` appears in:
  - `index.html`
  - `stake.html`
  - `verify.html`
  - `build-droid.html`
  - `blueprint-checker.html`
  - `whitepaper.html`
- Legacy `walletModal` markup remains embedded in:
  - `index.html`
  - `verify.html`
  - `build-droid.html`
  - `blueprint-checker.html`
  - `whitepaper.html`
- Hidden or legacy page wallet buttons remain:
  - `stake.html` hidden `connectBtn`
  - hidden context buttons in `index.html` and `verify.html`

## Contract Integrations

Frontend contract integrations:

- `stake.js`
  - S1 NFT: `0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f`
  - Ascension staking: `0xf9611226c1CcCcCa37951938d6f358D3d5106549`
  - Energy Bank: `0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767`
  - reads:
    - S1 `balanceOf`, `tokenOfOwnerByIndex`, `ownerOf`, `tokenURI`, `isApprovedForAll`
    - staking `tokensOfStaker`, `getStakedTokens`, `stakedBalance`, `balanceOf`, `pendingPoints`, `pointsPerDay`
    - energy bank `spendableEnergy`, `lifetimeEnergy`, `totalSpent`
  - writes:
    - S1 `setApprovalForAll`, `transferFrom`
    - staking `stakeDeposited`, `unstake`, `claimPoints`
    - energy bank fallback `creditWithAuthorization`
- `stake-ui.js`
  - recovery/admin reads and writes around `ownerOf`, `stakeInfo`, `stakeDeposited`.
- `swap-module.js`
  - ERC20/native balance and allowance reads via raw calldata.
  - transaction sends through `eth_sendTransaction`.
- `dyoor-builder.js`
  - message signing for Blueprint registration.
- `blueprint-checker.js`
  - uses metadata/helper data for Blueprint match checks.

Server-side contract integrations:

- `netlify/functions/ascension-stats.js`
- `netlify/functions/energy-bank-credit.js`
- `netlify/functions/energy-bank-direct-credit.js`
- `netlify/functions/discord-refresh.js`
- `netlify/functions/discord-verify-submit.js`
- `netlify/functions/_verify/chain.js`
- `netlify/functions/_quest/verify.js`
- `netlify/functions/stake.js`
- `netlify/functions/quote.js`
- scripts under `scripts/audit-*`, `scripts/deploy-*`, `scripts/backfill-*`, `scripts/airdrop-energy.js`

## Environment Variables

Environment variables confirmed available for the Next.js migration:

- `NEXT_PUBLIC_PRIVY_APP_ID`
- `NEXT_PUBLIC_MONAD_RPC_URL`
- `NEXT_PUBLIC_MONAD_FALLBACK_RPC`
- `NEXT_PUBLIC_GOLDSKY_SUBGRAPH_URL`
- `ALCHEMY_MONAD_RPC_URL`
- `GOLDSKY_API_KEY`
- `DYOOR_S1_CONTRACT`
- `ASCENSION_STAKING_CONTRACT`

Detected environment variable names include:

- Wallet/frontend:
  - `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
  - `WALLETCONNECT_PROJECT_ID`
  - `NEXT_PUBLIC_PRIVY_APP_ID`
- Monad/chain:
  - `NEXT_PUBLIC_MONAD_RPC_URL`
  - `NEXT_PUBLIC_MONAD_FALLBACK_RPC`
  - `ALCHEMY_MONAD_RPC_URL`
  - `MONAD_RPC_URL`
  - `MONAD_TESTNET_RPC_URL`
  - `RPC_URL`
  - `CHAIN_ID`
  - `EXPECTED_CHAIN_ID`
- Indexing:
  - `NEXT_PUBLIC_GOLDSKY_SUBGRAPH_URL`
  - `GOLDSKY_API_KEY`
- Contracts:
  - `S1_COLLECTION_ADDRESS`
  - `ASCENSION_CONTRACT_ADDRESS`
  - `ASCENSION_STAKING_ADDRESS`
  - `ASCENSION_STAKING_CONTRACT`
  - `ASCENSION_NFT_ADDRESS`
  - `DYOOR_S1_CONTRACT`
  - `DYOOR_S1_NFT_ADDRESS`
  - `ENERGY_BANK_ADDRESS`
  - `SWAP_CONTRACT`
  - `DYOOR_SWAP_ROUTER`
  - `KURU_ROUTER_ADDRESS`
- Discord verifier:
  - `DISCORD_CLIENT_ID`
  - `DISCORD_CLIENT_SECRET`
  - `DISCORD_BOT_TOKEN`
  - `DISCORD_GUILD_ID`
  - `DISCORD_REDIRECT_URI`
  - `VERIFY_SESSION_SECRET`
  - `VERIFY_SESSION_COOKIE`
  - `VERIFY_NONCE_TTL_SECONDS`
  - `HOLDER_ROLE_ID`
  - `ASCENDED_ROLE_ID`
  - `TWENTY_PLUS_ROLE_ID`
  - `FIFTY_PLUS_ROLE_ID`
- Netlify/GitHub storage:
  - `NETLIFY_BLOBS_SITE_ID`
  - `NETLIFY_BLOBS_TOKEN`
  - `NETLIFY_SITE_ID`
  - `NETLIFY_ACCESS_TOKEN`
  - `NETLIFY_AUTH_TOKEN`
  - `SITE_ID`
  - `GITHUB_TOKEN`
  - `GITHUB_REPO`
  - `GITHUB_BRANCH`
  - `GITHUB_LEDGER_PATH`
- Quest/Supabase/social:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `QUEST_STORAGE`
  - `QUEST_DATA_BACKEND`
  - `ADMIN_WALLETS`
  - `M3SH_PROOF_URL`
  - `M3SH_SESSIONS_URL`
  - `ASCENSION_BLUEPRINT_PROOF_URL`
  - `BLUEPRINT_PROOF_URL`
  - `X_CLIENT_ID`
  - `X_CLIENT_SECRET`
  - `OPENSEA_API_KEY`
  - `OPENSEA_BUY_START_BLOCK`
  - `QUEST_START_BLOCK`
  - `TARGET_DYOOR_POST_ID`
- Swap:
  - `KURU_API_URL`
  - `VITE_KURU_API_URL`
  - `VITE_KURU_ROUTER_ADDRESS`
  - `DYOOR_TREASURY`
  - `VITE_DYOOR_TREASURY`
  - `DYOOR_SUPPORT_FEE_RECIPIENT`
  - `DYOOR_SWAP_FEE_BPS`
  - `VITE_DYOOR_SWAP_FEE_BPS`
  - `VITE_MONAD_RPC_URL`
- Energy/deploy/admin:
  - `DEPLOYER_PRIVATE_KEY`
  - `ENERGY_ADMIN_ADDRESS`
  - `ENERGY_BANK_OPERATOR_PRIVATE_KEY`
  - `ENERGY_CREDIT_SIGNER_ADDRESS`
  - `ENERGY_CREDIT_SIGNER_PRIVATE_KEY`
  - `ENERGY_BANK_START_BLOCK`
  - `AIRDROP_WALLET_FILE`
  - `AIRDROP_AMOUNT_ENERGY`
  - `AIRDROP_CAMPAIGN_LEDGER`
  - `EXECUTE_AIRDROP`
  - `EXECUTE_BACKFILL`
  - `EXECUTE_RECOVERY`
- Ascension audit/recovery:
  - `ASCENSION_START_BLOCK`
  - `ASCENSION_LOG_CHUNK_SIZE`
  - `ASCENSION_RPC_DELAY_MS`
  - `ASCENSION_TOKEN_FILE`
  - `ASCENSION_RECOVERY_BATCH_SIZE`
  - `ASCENSION_RECOVERY_MANIFEST_PATH`
  - `RECOVERY_WALLET`
  - `HARVEST_LEDGER_PATH`
  - `HARVEST_LEDGER_URL`
- S2/contracts:
  - `DYOOR_OWNER_ADDRESS`
  - `DYOOR_TREASURY_ADDRESS`
  - `DYOOR_BASE_URI`
  - `DYOOR_CONTRACT_URI`
  - `DYOOR_TRAITS_URI`
  - `DYOOR_TRAITS_CONTRACT_URI`
  - `SEASON2_METADATA_DIR`
- Runtime:
  - `PORT`
  - `URL`
  - `LAMBDA_TASK_ROOT`

## Proposed Next.js Architecture

Target structure:

```text
app/
  layout.tsx
  page.tsx
  ascension/page.tsx
  verify/page.tsx
  swap/page.tsx
  build/page.tsx
  blueprint-checker/page.tsx
  whitepaper/page.tsx
components/
  layout/
  wallet/
  ascension/
  swap/
  verifier/
  blueprint/
hooks/
  useAscension.ts
  useWalletSession.ts
  useSwap.ts
lib/
  rpc.ts
  monad.ts
  queryClient.ts
  contracts/
    addresses.ts
    abi.ts
    ascension.ts
    erc721.ts
    energyBank.ts
providers/
  AppProviders.tsx
  PrivyProvider.tsx
  QueryProvider.tsx
contracts/
  existing Solidity sources can remain here
public/
  migrated static assets
styles/
  globals.css
netlify/functions/
  existing functions preserved
```

Required dependencies for the Next phase:

- `next`
- `react`
- `react-dom`
- `typescript`
- `tailwindcss`
- `postcss`
- `autoprefixer`
- `eslint`
- `@privy-io/react-auth`
- `viem`
- `wagmi`
- `@tanstack/react-query`
- Netlify Next runtime/plugin if deploying Next routes on Netlify

## Shared Monad RPC Plan

Create `lib/rpc.ts` as the single browser-safe read transport for Monad.

Inputs:

- primary RPC: `NEXT_PUBLIC_MONAD_RPC_URL`
- fallback RPC: `NEXT_PUBLIC_MONAD_FALLBACK_RPC`
- optional server-only fallback: `ALCHEMY_MONAD_RPC_URL`

Required behavior:

- use Monad mainnet chain id `143`
- wrap viem public clients with timeout handling
- retry transient read failures with bounded attempts
- fail over from primary to fallback when the primary errors or times out
- dedupe identical in-flight reads by method, target, calldata, block tag, and wallet where applicable
- never dedupe or cache wallet write requests
- return structured errors that preserve the attempted RPC endpoint and failure reason

Initial implementation shape:

- `createMonadPublicClient()`
- `readContractWithFailover()`
- `multicallWithFailover()`
- `withRpcRetry()`
- `dedupeRead(key, task)`

This should be introduced before migrating Ascension so `useAscension()` does not recreate retry/failover logic.

## Wallet Migration Plan

Preferred long-term wallet system: Privy Embedded Wallets.

Requirements:

- one navbar wallet/login button
- persistent Privy login session
- embedded EVM wallet auto-created on login
- external wallet support enabled only if product policy requires it
- Monad configured globally:
  - chain id `143`
  - RPC `https://rpc.monad.xyz`
  - explorer `https://monadscan.com`
- automatic network switching where provider supports it
- no page-level connect buttons
- all pages consume state from a shared provider/hook

Recommended implementation:

1. Implement `providers/PrivyProvider.tsx`.
2. Implement `hooks/useWalletSession.ts`.
3. Expose a short-term `DyoorWallet` compatibility adapter only while static pages are being migrated.
4. Convert consumers to React hooks route by route.
5. Remove:
   - `wallet-chooser.js`
   - `DyoorWalletChooser`
   - embedded `walletModal` HTML
   - WalletConnect script tags
   - page-specific wallet state globals

## Ascension Migration Plan

Highest-priority route: Ascension Protocol.

Create `hooks/useAscension.ts` returning:

- `walletNfts`
- `ascendedNfts`
- `pendingEnergy`
- `harvestedEnergy`
- `lifetimeEnergy`
- `loading`
- `error`
- `refresh()`

Data sources:

1. Goldsky subgraph from `NEXT_PUBLIC_GOLDSKY_SUBGRAPH_URL`, when configured.
2. Monad RPC through `lib/rpc.ts`.
3. Existing Netlify functions only where they provide server-side enrichment or ledger data.

Core discovery rules:

- S1 NFT: `0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f`
- Ascension: `0xf9611226c1CcCcCa37951938d6f358D3d5106549`
- compare S1 `balanceOf(wallet)` against discovered token count
- attempt `tokenOfOwnerByIndex(wallet, index)`
- if enumeration fails or count mismatches, merge with `ownerOf(1..1111)` scan
- try all staking reads:
  - `tokensOfStaker(wallet)`
  - `getStakedTokens(wallet)`
  - `stakedBalance(wallet)`
  - `balanceOf(wallet)`
- if exact staked token IDs are unavailable, show count-only ascended state
- prefer Goldsky for staked token IDs when the subgraph URL is configured
- use RPC staking reads as the mandatory fallback when Goldsky is missing, stale, or incomplete
- never cache partial scans as complete
- clear query/cache on:
  - wallet change
  - chain change
  - stake
  - unstake
  - harvest
  - manual refresh
  - page focus
- render fallback cards when metadata fails
- show mismatch warning with a refresh action

Contract layer should move from ad hoc ABI arrays in `stake.js` to `lib/contracts`.

Reliability guard:

- compare `balanceOf(wallet)` to the merged wallet-token result
- compare Goldsky staked token count, RPC staked token IDs, and RPC staked count
- when counts disagree, return partial data with `isPartial: true`, show "Some NFTs may still be loading. Click Refresh NFTs.", and avoid caching the result as final
- metadata failures must not filter out token IDs; render fallback cards named `DYOOR #tokenId`

## Shared Contract Layer

Create a central contract layer:

- `lib/contracts/addresses.ts`
- `lib/contracts/abis.ts`
- `lib/contracts/clients.ts`
- `lib/contracts/ascension.ts`
- `lib/contracts/s1.ts`
- `lib/contracts/energyBank.ts`
- `lib/contracts/swap.ts`

Use `viem` for reads and typed calldata where possible. Use `ethers` only where needed for compatibility with existing signer flows or message signing until Privy/wagmi equivalents are confirmed.

## Performance Plan

Use TanStack Query for:

- wallet NFT discovery
- ascended NFT discovery
- energy totals
- token metadata
- swap token lists and balances
- Discord status
- Blueprint status

Rules:

- no caching partial NFT scans as final data
- explicit query keys by wallet + chain + contract address
- invalidate on wallet/chain/transaction/page-focus events
- request deduplication for token metadata
- loading skeletons for route-level data
- error boundaries for route failures

## Future D.Y.O.O.R S2 Architecture

Prepare modules for:

- S2 Mint
- Dynamic Traits
- Trait Marketplace
- Trait Rerolls
- Ascension Blueprints
- Energy Marketplace
- Leaderboards
- Reward Claims
- Future NFT Collections

Recommended domain layout:

- `features/ascension`
- `features/swap`
- `features/verify`
- `features/blueprint`
- `features/quests`
- `features/s2-mint`
- `features/traits`
- `features/energy`
- `features/leaderboards`
- `features/rewards`

Each feature should own UI components and route-specific hooks, but contract clients and wallet state must stay shared.

## Files Requiring Migration

High priority:

- `stake.html`
- `stake.js`
- `stake-ui.js`
- `wallet-chooser.js`
- `swap-module.js`
- `script.js`
- `verify.html`
- `dyoor-builder.js`
- `blueprint-checker.js`
- all HTML files containing `walletModal`

Medium priority:

- `index.html`
- `build-droid.html`
- `blueprint-checker.html`
- `whitepaper.html`
- `quests.html`
- `admin-ascension.html`
- `admin-ascension.js`
- `local-dev-server.js`
- `style.css`

Server/shared code to preserve first, then centralize:

- `netlify/functions/**`
- `src/ascensionBlueprintHelpers.js`
- `src/config/**`
- `tokenlist.monad.json`

Files that can remain mostly unchanged early:

- `contracts/**`
- `scripts/**`
- `test/**`
- `supabase/**`
- `data/**` static JSON, except when route-specific imports change
- assets under `assets/**`, `public/**`, `dyoor-builder/layers/**`

## File-By-File Migration Plan

- `wallet-chooser.js`
  - Phase: replace after Privy provider lands.
  - Action: keep as a temporary compatibility facade only if static pages still require it.
  - Final state: delete after every route reads from `useWalletSession()`.
- `script.js`
  - Phase: homepage and verifier migration.
  - Action: split Discord verifier code into `features/verify`, collection/home UI into `app/page.tsx`, and remove `window.provider`, `window.signer`, `window.userAddress` writes.
- `stake.html`
  - Phase: Ascension first.
  - Action: replace with `app/ascension/page.tsx` and shared layout/nav.
  - Final state: redirect `/stake` to `/ascension` or keep `/stake` as a Next route alias if marketing links depend on it.
- `stake.js`
  - Phase: Ascension first.
  - Action: extract contract reads into `lib/contracts/*`, state orchestration into `hooks/useAscension.ts`, and writes into typed Ascension actions.
  - Final state: remove page-level connect flow, local caches, and global wallet compatibility reads.
- `stake-ui.js`
  - Phase: Ascension first or admin follow-up.
  - Action: move recovery/admin components into `components/ascension` only after core user Ascension parity is verified.
- `swap-module.js`
  - Phase: after verifier.
  - Action: move token/balance/quote/approve/swap code into `features/swap` and consume Privy wallet/provider.
- `verify.html`
  - Phase: after Ascension.
  - Action: replace with `app/verify/page.tsx`; preserve Netlify function endpoints and Discord redirect behavior.
- `dyoor-builder.js`
  - Phase: after swap.
  - Action: migrate canvas/builder state into `features/blueprint`; replace global signer usage with Privy wallet signing.
- `build-droid.html`
  - Phase: after swap.
  - Action: replace with `app/build/page.tsx`; preserve layer assets and blueprint share functions.
- `blueprint-checker.js`
  - Phase: after builder.
  - Action: convert checker into `features/blueprint/checker`, replace `dyoor:wallet` event usage with `useWalletSession()`.
- `blueprint-checker.html`
  - Phase: after builder.
  - Action: replace with `app/blueprint-checker/page.tsx`.
- `index.html`
  - Phase: late.
  - Action: migrate home content into `app/page.tsx` after high-risk wallet pages are stable.
- `whitepaper.html`
  - Phase: late.
  - Action: migrate to `app/whitepaper/page.tsx`; remove duplicated wallet modal markup.
- `quests.html`
  - Phase: late or separate.
  - Action: migrate only after deciding whether quests remain active.
- `admin-ascension.html` and `admin-ascension.js`
  - Phase: admin follow-up.
  - Action: keep static until public user flows are migrated; then move behind an admin route.
- `netlify/functions/**`
  - Phase: preserve.
  - Action: keep paths stable. Add shared server utilities only after Next preview deploy proves function compatibility.
- `local-dev-server.js`
  - Phase: transitional.
  - Action: keep for static fallback until Next local and Netlify preview workflows fully replace it.

## Potential Blockers

- Privy app configuration is external and required before real login testing.
- A Next.js migration changes Netlify build semantics; the existing `publish = "."` cannot remain the final production config for Next routes.
- Static pages and Next routes cannot own the same production path without a routing strategy.
- Existing frontend code relies heavily on globals: `window.provider`, `window.signer`, `window.userAddress`.
- Wallet modal markup is duplicated in several HTML files.
- Some Netlify Functions mix CommonJS and ESM styles; keep function bundling unchanged until Next deployment is proven.
- Ascension discovery depends on RPC reliability and contract support for optional methods.
- Swap flow uses raw EIP-1193 provider calls and may need careful Privy provider transaction testing.
- Discord verifier depends on cookies and redirect URLs; Next route changes must preserve callback origins.
- Current local worktree has unrelated uncommitted contract/docs/assets changes. Migration commits must keep scope explicit.
- Goldsky schema must be confirmed before `useAscension()` can rely on indexed staked token IDs.
- Privy embedded wallet behavior must be tested with Monad mainnet and external EIP-1193 wallets before removing the current chooser.

## Estimated Effort

- Phase 1 audit/report: 0.5 day
- Next.js foundation beside static site: 1-2 days
- Privy provider and wallet adapter: 1-2 days
- Ascension route migration and NFT discovery hook: 3-5 days
- Swap migration: 2-4 days
- Discord verifier migration: 2-3 days
- Blueprint builder migration: 3-5 days
- Remaining pages and layout polish: 2-4 days
- Cleanup of old wallet system: 1-2 days
- QA across wallet/account/network/NFT states: 2-4 days

Total expected effort: roughly 3-5 engineering weeks depending on design polish, Privy configuration readiness, and test wallet coverage.

## Recommended Rollout Order

1. Keep static site live.
2. Add Next.js foundation on a separate branch/path.
3. Configure Netlify preview deploy for Next shell.
4. Add Privy provider and Monad config.
5. Build compatibility wallet adapter.
6. Migrate Ascension first.
7. Validate Ascension with wallets covering:
   - only unstaked NFTs
   - only ascended NFTs
   - both unstaked and ascended NFTs
   - zero NFTs
   - large holder wallet
   - after stake/unstake/harvest
8. Migrate Discord verifier.
9. Migrate Swap.
10. Migrate Blueprint builder/checker.
11. Migrate home/whitepaper/quests/admin.
12. Remove old wallet code and duplicated modal markup.
13. Switch production routing after preview parity is confirmed.

## Deployment Instructions

Staged deployment target:

1. Keep the current static Netlify deploy intact for production.
2. Create the Next.js app structure on `migration/nextjs-privy`.
3. Add Netlify Next runtime/plugin configuration in a preview-only commit.
4. Configure preview env vars:
   - `NEXT_PUBLIC_PRIVY_APP_ID`
   - `NEXT_PUBLIC_MONAD_RPC_URL`
   - `NEXT_PUBLIC_MONAD_FALLBACK_RPC`
   - `NEXT_PUBLIC_GOLDSKY_SUBGRAPH_URL`
   - `DYOOR_S1_CONTRACT`
   - `ASCENSION_STAKING_CONTRACT`
5. Keep existing server env vars for Netlify functions unchanged.
6. Use Netlify preview deploys for route-by-route parity checks.
7. Switch production `publish`/build settings only after Ascension, verifier, swap, builder, and homepage pass wallet QA.

Local migration workflow:

```bash
npm run check
npm run dev
```

The first Next.js foundation commit should add the new `dev` script for Next while preserving the current static dev command under a separate script such as `dev:static`.

## Testing Checklist

Wallet/session:

- Privy login persists after refresh.
- Embedded wallet is created for a new user.
- External wallet login works when enabled.
- Navbar is the only visible wallet connect/login button.
- Account changes update all pages.
- Disconnect clears page state.
- Monad chain id is `143`.
- Wrong network prompts switch/add where supported.

Ascension:

- wallet with only unstaked S1 NFTs shows all wallet NFTs
- wallet with only ascended/staked S1 NFTs shows ascended state
- wallet with both unstaked and ascended NFTs shows both lists
- zero-NFT wallet shows empty state only after all discovery methods finish
- large holder does not cache partial owner scans
- staking transaction invalidates wallet NFTs, ascended NFTs, and energy queries
- unstaking transaction invalidates wallet NFTs, ascended NFTs, and energy queries
- harvest transaction invalidates pending, harvested, and lifetime energy
- metadata failure renders fallback `DYOOR #tokenId` card
- Goldsky disabled path falls back to RPC
- Goldsky stale/incomplete path falls back to RPC and marks partial data

Routes:

- `/` homepage keeps current visual/layout parity
- `/stake` and/or `/ascension` loads migrated Ascension
- `/verify` completes Discord verification flow
- `/swap` quotes and submits using the Privy wallet provider
- `/build` saves and exports Blueprints
- `/blueprint-checker` validates existing Blueprint data

Netlify/functions:

- all existing `/.netlify/functions/*` endpoints remain reachable
- Discord OAuth callback origin remains valid
- Blueprint share image redirects still resolve
- quest endpoints are not regressed if quests remain live

## First Implementation Step After This Audit

Create a non-destructive Next.js foundation in a separate path or branch:

- add `app/`, `components/`, `hooks/`, `lib/`, `providers/`, `styles/`
- add TypeScript/Tailwind/ESLint configs
- keep `netlify/functions` unchanged
- do not move existing static routes yet
- add one preview route proving assets, functions, and Monad config load correctly
