# Migration Follow-Up Test Results

Date: 2026-06-26

## What Was Broken

- Mobile swap token selector rendered inside the swap section instead of a viewport-level modal, so mobile users could end up scrolling to find it.
- Privy wallet consumers used `wallets[0]`, which can diverge from Privy's active wallet.
- Ascension wallet discovery could under-read S1 wallet NFTs when `tokenOfOwnerByIndex` reverted and the full `ownerOf` fallback had transient RPC misses.
- `/blueprint` was missing even though `/build-droid` existed.

## What Changed

- Swap token selector now renders through a `document.body` portal with a fixed backdrop, viewport-centered mobile modal layout, click-outside close, visible search input, `max-height: 80dvh`, scroll containment, safe-area padding, and body scroll lock.
- Added WalletService and moved header, swap, ascension, admin, builder, verify, and blueprint checker to a Privy-first wallet service with browser-wallet fallback.
- Ascension fetches staked IDs/counts and Energy reads in parallel with `Promise.allSettled`, keeps previous good data during refresh, adds short wallet-level query caching, logs fetch timing in dev, and uses `balanceOf` as the final unstaked count while token IDs are still being verified.
- The `ownerOf` fallback now retries failed token IDs with lower concurrency and throttling to reduce public RPC rate-limit/under-read behavior.
- Added `/blueprint` redirect route to `/build-droid`.
- Converted `/swap` from a homepage redirect into a standalone Next page using the same `SwapCard`.
- Added `build`, `start`, `lint`, `typecheck`, and `test` scripts.
- Added `@types/react-dom` for the swap selector portal.

## Mobile Selector Test Result

- Local mobile user-agent probes returned 200 for `/`, `/swap`, `/ascension`, `/blueprint`, `/blueprint-checker`, and `/admin`.
- Cloudflare tunnel mobile user-agent probes returned 200 for the same routes.
- Code-level acceptance checks:
  - Modal is portal-mounted under `document.body`.
  - Overlay is `position: fixed`.
  - Modal is centered in the visible viewport instead of being anchored lower on the page.
  - Body scroll is locked while open.
  - Token search input is at the top of the sheet.
  - Token list scrolls inside the modal.
  - Modal uses safe-area top/bottom padding.

## Ascension Load Timing

- Before fix: repeated full `ownerOf` scans for known wallet reproduced unstable counts, returning 1, 2, or 3 unstaked tokens while direct `balanceOf` was 14.
- After fix known wallet sample:
  - Wallet: `0x854038f3d137e753c7e3245d9163c58bbd068d91`
  - Unstaked: 14
  - Ascended/staked: 8
  - Total Controlled: 22
  - Verified unstaked token IDs: `126,128,130,132,135,136,140,324,1028,1029,1030,1032,1033,1035`
  - Staked token IDs: `121,1019,537,814,123,139,815,125`
  - Timing sample: 35,895 ms through public Monad RPC with throttled `ownerOf` fallback.
- Current fast-count path sample:
  - Reads: `S1.balanceOf(wallet)` and `Ascension.stakedBalance(wallet)` in parallel.
  - Unstaked: 14
  - Ascended/staked: 8
  - Total Controlled: 22
  - Timing sample: 488 ms through public Monad RPC.
- Bottleneck: S1 `tokenOfOwnerByIndex` reverts, so wallet token IDs require fallback verification. A reliable indexer or configured narrow S1 deployment start block would be the next speed improvement.

## Privy Check Result

- `PrivyProvider` loads `NEXT_PUBLIC_PRIVY_APP_ID`.
- Monad chain config remains chain id `143`, RPC `https://rpc.monad.xyz`, explorer `https://monadscan.com`.
- Header disconnect, admin owner check, swap, ascension, builder, verify, and blueprint checker now share WalletService.
- Browser-only wallet modal, mobile wallet handoff, reconnect persistence, and disconnect UX still need manual wallet testing with a real Privy app id and wallet.

## Verification Commands

- `npm install`
- `npm run check`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run start`
- `cloudflared tunnel --url http://localhost:3000`

## Local Route Results

- `/` -> 200
- `/swap` -> 200, standalone swap page
- `/ascension` -> 200
- `/stake` -> 200, redirects to `/ascension`
- `/blueprint` -> 200, redirects to `/build-droid`
- `/blueprint-checker` -> 200
- `/admin` -> 200
- `/api/quote` -> 200
- `/api/ascension-blueprints` -> 200
- `/api/admin/snapshots` -> 200
- `/api/energy-recharge` -> 200

## Cloudflare Tunnel Results

- Current tested URL: `https://ceiling-preliminary-tom-campaigns.trycloudflare.com`
- Tunnel target: Next production server at `http://localhost:3000`.
- `/`, `/swap`, `/ascension`, `/stake`, `/blueprint`, `/blueprint-checker`, and `/admin` returned 200 through Cloudflare.
- `/swap` returned standalone swap content and did not redirect to the homepage.
- `/blueprint` resolves to `/build-droid`.
- `/admin` loads the migrated admin page.
- `/api/quote`, `/api/ascension-blueprints`, `/api/energy-recharge`, and `/api/admin/snapshots` returned 200 through Cloudflare.
- `GET /api/energy-transfer` returned 405 as expected because Energy transfer is POST-only.
- Legacy Netlify functions checked locally through Netlify Dev:
  - `/.netlify/functions/wallet-config` -> 200
- Static asset `/assets/dyoor-logo.png` returned 200.

## Remaining Issues

- Plain `next start` does not serve legacy `/.netlify/functions/*` paths. The migrated Next API routes tested above work, but Netlify function parity still depends on the Netlify runtime or a dedicated compatibility layer.
- Netlify Dev functions work locally, but Netlify Dev page proxying to Next hung for `GET /` in this environment. Direct Next and Cloudflare-to-Next route checks pass. Netlify page deployment needs owner approval for a Next runtime/plugin decision.
- Netlify function bundling still warns about CommonJS `exports`/`module.exports` in a `"type": "module"` package. Tested functions above returned 200 despite the warnings.
- NPM audit reports 65 vulnerabilities. I did not run `npm audit fix` because that can introduce broad dependency churn and needs owner approval.
- Real wallet connect/disconnect/session persistence and transaction-confirmation paths require manual browser testing with live wallet credentials.
