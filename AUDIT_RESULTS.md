# D.Y.O.O.R Final Audit Results

Date: 2026-06-26
Branch: `audit-polish-migration-check`

## Migration Status

Migration Ready with documented caveats.

The migrated Next app has real routes, shared providers, API routes, Netlify function compatibility checks, and production build output. Main remains untouched.

## Priority Fixes

- Mobile swap selector now renders in a `document.body` portal with fixed viewport positioning, backdrop, body scroll lock, `max-height: 80dvh`, safe-area padding, immediate search, and desktop-compatible modal behavior.
- Wallet connect now uses a global WalletService. It prefers Privy, falls back to injected EVM wallets, and does not leave the UI permanently stuck on `Loading`.
- Ascension count loading now uses fast count reads for initial stats and avoids full owner scans during page load.
- Ascension Health was added as a compact status panel with only affected checks expanded.
- Recovery detection runs beside normal Ascension loading with a bounded timeout and uses S1 start block `54985442`.
- Season 2 supply references were changed from `5,555` to `3,333`, including the Season 2 contract max supply and tests.

## Performance Improvements

- Ascension known-wallet fast count path:
  - Unstaked: 14
  - Ascended: 8
  - Total Controlled: 22
  - Latest direct timing sample: 488 ms through public Monad RPC.
- Previous slow fallback sample was about 35,895 ms when forced into full `ownerOf` scanning.
- Independent Ascension reads now run in parallel where safe.
- React Query keeps previous good data while refreshing to avoid flashing wrong counts.
- Recovery scan is bounded so it cannot block the main dashboard.
- Swap token lists are cached and selector scrolling is contained inside the modal.

## UI Improvements

- Mobile swap modal/bottom-sheet behavior fixed.
- Ascension Health panel compacted after visual review.
- Recharge Energy and Lend to a Fren now sit in paired utility cards.
- Recovery Tool now prioritizes automatic detection and keeps manual input as fallback.
- Admin tables include owner search/filter and export controls.
- Loading, warning, success, and error states are present across major new flows.

## Privy Audit

- `PrivyProvider` still loads `NEXT_PUBLIC_PRIVY_APP_ID` when configured.
- Monad chain config remains chain id `143`.
- App no longer depends entirely on Privy hooks in pages.
- Header, Swap, Ascension, Blueprint, Blueprint Checker, Verify, and Admin use WalletService.
- Manual browser wallet session tests are still required for real Privy mobile handoff and reconnect persistence.

## Wallet Fallback

Implemented `WalletService` with:

- `connect()`
- `disconnect()`
- `getProvider()`
- `getSigner()`
- `getAddress()`
- `sendTransaction()`
- `signMessage()`
- `switchChain()`

Fallback order:

1. Privy active wallet
2. Browser injected EVM wallet: MetaMask, OKX, Backpack, Rabby, TokenPocket, Phantom EVM, or generic `window.ethereum`

Wallet loading has timeout behavior and retry/error state.

## Admin And Energy Features

- Owner admin snapshot API requires server-side owner wallet match plus fresh signature, timestamp, and nonce.
- Staking snapshot exports CSV/JSON with wallet, token IDs, staked count, pending Energy, harvested Energy, lifetime Energy, and timestamp.
- Blueprint snapshot exports CSV/JSON with wallet, blueprint ID/hash, saved date, image fields, traits, and eligibility.
- Energy Airdrop Tool added to owner admin with wallet list, CSV upload, preview, confirmation, progress state, result log, and export.
- Lend to a Fren added to Ascension with recipient validation, balance preview, signed authorization, server verification, and refresh after success.
- Recharge Energy retained: MON payment to treasury is verified before Energy Bank credit.

### 2026-06-28 Harvested Energy Reconciliation Update

- Root cause: Ascension harvests could be indexed or present in the historical harvest ledger without a matching Energy Bank `creditEnergy` entry, so Harvested Energy, Lifetime Energy, and Energy Bank could diverge after the site started relying on the Energy Bank as the usable balance source of truth.
- Ascension stats now read harvested Energy from Goldsky `PointsClaimed` events by default, merge non-duplicated historical ledger rows, and expose actual Energy Bank `spendableEnergy`, `lifetimeEnergy`, and `totalSpent`.
- New harvests now call `/api/energy-harvest-credit` after the `claimPoints` transaction is confirmed. The API verifies the `PointsClaimed` event for the wallet before calling Energy Bank `creditEnergy`.
- The Ascension hook normalizes wallet addresses and prevents previous-wallet Energy/NFT data from rendering after a wallet switch.
- Admin Command Center now includes an owner-only Energy Reconciliation report and repair tool.
- `npm run energy:reconciliation:report` exports dated CSV/JSON reconciliation files from Goldsky events plus Energy Bank reads.
- Added `ENERGY_SYSTEM_AUDIT.md` and `ENERGY_RECONCILIATION_REPORT.md` for formulas, data sources, repair process, and remaining risks.

### 2026-06-26 Admin Command Center Update

- Mobile navigation was replaced with a controlled fixed overlay for mobile widths, including backdrop close, Escape close, body scroll lock, route-close behavior, active link highlighting, safe-area bottom padding, and contained scrolling.
- Header wallet button was constrained on mobile so connected addresses and network prompts cannot overflow the nav row.
- `/admin-command-center` was added as an alias for `/admin`.
- Admin signatures are now action-specific through `DYOOR Admin Command` messages, so snapshot signatures cannot authorize Energy airdrops.
- Admin APIs now share server-side owner verification, timestamp validation, and in-memory nonce replay protection.
- Energy Airdrop preview now reports raw entries, valid wallets, duplicates removed, invalid entries, Energy totals, and estimated action count.
- Energy Airdrop execution now supports server-side batching, per-wallet result rows, partial-success status, and CSV/JSON result exports with note/reason fields.
- Admin snapshot suite now includes a dedicated Ascended S1 NFT Snapshot export with one row per ascended S1 token ID.
- See `ADMIN_COMMAND_CENTER.md` for route, ENV, security, CSV, and export details.

## Cloudflare Verification

Final Cloudflare tunnel tested:

- URL: `https://ceiling-preliminary-tom-campaigns.trycloudflare.com`
- Target: direct Next production server at `http://localhost:3000`
- Result: `/`, `/swap`, `/ascension`, `/stake`, `/blueprint`, `/blueprint-checker`, `/admin`, `/api/quote`, `/api/ascension-blueprints`, `/api/energy-recharge`, `/api/admin/snapshots`, and `/assets/dyoor-logo.png` returned 200.
- `GET /api/energy-transfer` returned 405 as expected because Energy transfer is POST-only.
- `/swap` is now a standalone page and no longer redirects to `/#swap`.

Netlify Dev notes:

- Netlify functions responded through `http://localhost:8888`; `/.netlify/functions/wallet-config` returned 200.
- Netlify Dev page proxying to the Next app hung locally even when Netlify launched `next start` itself. Direct Next routing and Cloudflare-to-Next routing worked.
- No `@netlify/plugin-nextjs` / Netlify Next runtime dependency is installed. Treat Netlify page deployment as pending owner approval before changing deployment architecture.

Commands used:

```bash
npm install
npm run check
npm run lint
npm run typecheck
npm test
npm run build
npm run start
cloudflared tunnel --url http://localhost:3000
```

## Ascension Verification

Known wallet:

`0x854038f3d137e753c7e3245d9163c58bbd068d91`

Expected:

- Unstaked: 14
- Ascended: 8
- Total Controlled: 22

Latest direct count check returned 14 / 8 / 22 in 488 ms.

## Known Issues

- NPM audit still reports 65 vulnerabilities. I did not run `npm audit fix` or `npm audit fix --force` because that can create broad dependency churn and needs owner approval.
- Netlify Dev page proxying to Next hung locally. Direct Next and Cloudflare-to-Next verification passed; Netlify page deployment needs owner approval for a Next runtime/plugin configuration decision.
- Legacy Netlify functions still emit CommonJS-in-ESM warnings under `"type": "module"`. Tested functions have returned 200, but cleanup should be scheduled.
- Real wallet connect, mobile wallet handoff, disconnect, session persistence, transaction confirmation, Energy transfer, airdrop execution, and recovery execution still require live-wallet/manual testing.
- Energy transfer requires the Energy Bank operator to hold both `SPENDER_ROLE` and `CREDIT_ROLE`.
- Energy airdrop requires the operator to hold Energy Bank `DEFAULT_ADMIN_ROLE`.

## Files Changed

Primary app-layer changes:

- `providers/WalletServiceProvider.tsx`
- `providers/AppProviders.tsx`
- `components/wallet/WalletButton.tsx`
- `components/swap/SwapCard.tsx`
- `hooks/useAscension.ts`
- `app/ascension/page.tsx`
- `app/admin/page.tsx`
- `app/api/admin/snapshots/route.ts`
- `app/api/admin/energy-airdrop/route.ts`
- `app/api/energy-transfer/route.ts`
- `app/swap/page.tsx`
- `app/page.tsx`
- `app/whitepaper/page.tsx`
- `contracts/DyoorDroids.sol`
- `test/dyoor-season2.test.js`
- `.env.example`
- `_redirects`

## Go / No-Go

Go for the Next app and direct Cloudflare preview after owner accepts the manual-wallet and dependency-audit caveats.

No-Go for Netlify page deployment until the owner approves Netlify Next runtime/plugin cleanup or decides Netlify is functions-only.
