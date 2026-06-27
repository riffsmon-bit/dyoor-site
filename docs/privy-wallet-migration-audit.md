# DYOOR Privy Wallet Migration Audit

## Reference

Monad's `next-serwist-privy-embedded-wallet` template is a Next.js PWA scaffold using Privy embedded EVM wallets. It expects a Privy Web app, external wallets disabled for embedded-wallet-only mode, automatic EVM embedded wallet creation on login, and `NEXT_PUBLIC_PRIVY_APP_ID` in `.env.local`.

## Current App Shape

DYOOR is currently a static HTML/JavaScript site deployed from the repository root:

- `netlify.toml` uses `publish = "."`.
- Netlify Functions live in `netlify/functions`.
- There is no `app/`, `pages/`, or `next.config.*`.
- `package.json` has no Next.js, React, Serwist, or Privy dependencies.
- Local development runs through `local-dev-server.js` via `npm run dev`.

This means a full Privy template migration is not a drop-in dependency change. It is a framework migration unless a Next.js shell is introduced beside the existing static app.

## Wallet System Inventory

Primary wallet/session files:

- `wallet-chooser.js`
  - Current global wallet facade: `window.DyoorWallet`.
  - Current chooser/modal facade: `window.DyoorWalletChooser`.
  - Owns `eth_requestAccounts`, `eth_accounts` restore, Monad switch/add, WalletConnect, injected wallet detection, `accountsChanged`, `chainChanged`, and `disconnect`.
- `script.js`
  - Shared homepage/verify behavior.
  - Reads `window.DyoorWallet`, `window.provider`, `window.signer`, and `window.userAddress`.
  - Still contains legacy modal helpers and compatibility wallet globals.
- `stake.js`
  - Ascension consumer.
  - Reads `window.DyoorWallet`, `window.provider`, `window.signer`, and `window.userAddress`.
  - Has hidden legacy `connectBtn` and local wallet event handling compatibility code.
- `swap-module.js`
  - Swap consumer.
  - Uses `window.DyoorWallet.connect()`, `getProvider()`, and `getAddress()`.
- `dyoor-builder.js`
  - Blueprint save flow uses `window.userAddress` and `window.signer.signMessage`.
- `blueprint-checker.js`
  - Uses `window.userAddress` and `dyoor:wallet` events.
- `stake-ui.js`
  - Ascension recovery/admin UI reads `window.provider`, `window.signer`, and `window.userAddress`.

HTML surfaces currently loading wallet code:

- `index.html`
- `stake.html`
- `verify.html`
- `build-droid.html`
- `blueprint-checker.html`
- `whitepaper.html`

Visible wallet UI:

- Nav button: `id="globalWalletBtn"` on the main user-facing pages.
- Hidden legacy Ascension button: `id="connectBtn"` in `stake.html`.
- Hidden context buttons remain in `index.html` and `verify.html`.
- Legacy wallet modal markup remains embedded in several HTML files.

Direct account request usage:

- `wallet-chooser.js` contains the only intended `eth_requestAccounts` call.
- No page module should call `eth_requestAccounts` directly after the recent global wallet refactor.

Netlify wallet/chain related functions:

- `netlify/functions/ascension-stats.js`
- `netlify/functions/discord-refresh.js`
- `netlify/functions/discord-verify-submit.js`
- `netlify/functions/_verify/chain.js`
- `netlify/functions/_quest/verify.js`
- `netlify/functions/stake.js`
- `netlify/functions/quote.js`

## Migration Recommendation

Do not fully replace the static site with Next.js in one pass. The current app has several working static flows and Netlify Functions that should stay live while the Privy wallet/session layer is proven.

Recommended path:

1. Create a Next.js app shell beside the static site, not over it.
   - Candidate path: `app-shell/` or `next-app/`.
   - Keep current root static files deployable while the shell is developed.
   - Use Monad's Privy template as a reference for provider setup, embedded wallet settings, and PWA structure.

2. Preserve Netlify Functions.
   - Keep `netlify/functions` in place.
   - Decide later whether Next.js is deployed through Netlify's Next runtime or whether static root remains primary during rollout.
   - Avoid moving verifier, quote, and ascension server logic until the frontend shell is proven.

3. Build a Privy wallet adapter matching the current `DyoorWallet` API.
   - Keep consumers stable initially by exposing:
     - `connect`
     - `disconnect`
     - `getState`
     - `getProvider`
     - `getSigner`
     - `getAddress`
     - `onChange`
     - `ensureMonad`
   - Behind that adapter, source state from Privy and embedded EVM wallet.
   - Configure Monad chain id `143`, RPC `https://rpc.monad.xyz`, explorer `https://monadscan.com`.

4. Replace consumers one route at a time.
   - Ascension first, because it is most sensitive to wallet state and NFT discovery.
   - Swap next, because it requires transaction provider compatibility.
   - Discord verifier next, because it signs messages.
   - Blueprint/build after message signing is verified.

5. Remove the old wallet system only after replacement is proven.
   - Delete WalletConnect/injected chooser code.
   - Remove legacy `walletModal` markup from HTML pages.
   - Remove `DyoorWalletChooser`.
   - Remove hidden page-level wallet buttons.

## Phase Plan

### Phase 1: Audit

This document. No runtime changes.

### Phase 2: Next.js Shell Decision

Add a minimal Next.js shell in a separate directory and verify:

- local `npm install`
- local `npm run dev`
- Netlify compatibility
- access to existing static assets
- calls to existing Netlify Functions

### Phase 3: Privy Provider Prototype

Install and configure Privy in the shell:

- `@privy-io/react-auth`
- embedded EVM wallet auto-create on login
- external wallets disabled if DYOOR wants embedded-only behavior
- one nav login/connect button
- Monad network configuration

### Phase 4: DyoorWallet Privy Adapter

Implement a browser adapter that mirrors current `window.DyoorWallet` behavior but sources from Privy. This lets existing code migrate incrementally instead of rewriting every page in one pass.

### Phase 5: Route Migration

Move or wrap routes in this order:

1. Ascension Protocol
2. Swap
3. Discord verifier
4. Blueprint/build
5. Whitepaper/home static wallet display

### Phase 6: Cleanup

After route parity is confirmed:

- remove `wallet-chooser.js`
- remove `DyoorWalletChooser`
- remove duplicate modal markup
- remove compatibility globals where no longer needed
- keep only Privy session state

## Ascension NFT Discovery Requirements To Preserve

The Privy migration must preserve the current hardened discovery rules:

- S1 NFT: `0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f`
- Ascension staking: `0xf9611226c1CcCcCa37951938d6f358D3d5106549`
- Monad chain id: `143`
- Use `balanceOf(wallet)`.
- Try `tokenOfOwnerByIndex(wallet, index)`.
- If enumeration fails or is incomplete, scan `ownerOf(1..1111)`.
- Try staking reads:
  - `tokensOfStaker(wallet)`
  - `getStakedTokens(wallet)`
  - `stakedBalance(wallet)`
  - `balanceOf(wallet)`
- Do not cache partial scans as final empty results.
- Render fallback cards when metadata fails.
- Show a warning when counts disagree.
