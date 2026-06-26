# Migration Audit

Date: 2026-06-26

## Status

Migration Ready with caveats.

## Fixed

| Area | Severity | Files | Result |
| --- | --- | --- | --- |
| Mobile swap token selector opened low on page | High | `components/swap/SwapCard.tsx` | Fixed with body portal, fixed overlay, scroll lock, safe-area padding, and contained modal list. |
| Wallet button stuck on Loading | High | `providers/WalletServiceProvider.tsx`, `components/wallet/WalletButton.tsx` | Fixed with global wallet service, timeout, fallback, retry, connected, wrong-network, and error states. |
| Privy-only page coupling | High | `providers/AppProviders.tsx`, wallet-consuming pages | Fixed by moving pages to WalletService. |
| Ascension under-read and slow count loading | High | `hooks/useAscension.ts`, `app/ascension/page.tsx` | Fixed by using fast count reads for displayed counts, caching, parallel reads, and stale-data protection. |
| Ascension recovery required manual token entry | Medium | `hooks/useAscension.ts`, `app/ascension/page.tsx` | Improved with automatic bounded recovery detection and one-click recovery flow. |
| Missing `/blueprint` route | Medium | `app/blueprint/page.tsx` | Fixed with route redirect to `/build-droid`. |
| `/swap` redirected to homepage | Medium | `app/swap/page.tsx`, `next.config.mjs`, `_redirects` | Fixed with a standalone Swap page and removed stale swap redirects. |
| Admin route blocked by legacy redirects | Medium | `_redirects` | Fixed by removing admin redirects; server-side owner auth still protects data. |
| Snapshot exports lacked harvested Energy | Medium | `app/api/admin/snapshots/route.ts` | Fixed using local harvested-energy ledger. |
| Season 2 supply changed | Medium | `contracts/DyoorDroids.sol`, `test/dyoor-season2.test.js`, `app/page.tsx`, `app/whitepaper/page.tsx` | Updated from 5,555 to 3,333. |
| S1 scan start block missing | Medium | `.env.example`, `hooks/useAscension.ts` | Set/documented `54985442`; hook defaults to that block. |

## Added

| Area | Files | Notes |
| --- | --- | --- |
| Wallet fallback architecture | `providers/WalletServiceProvider.tsx` | Privy-first, browser-wallet fallback. |
| Energy transfer | `app/api/energy-transfer/route.ts`, `app/ascension/page.tsx` | Signed sender authorization and server-side verification. |
| Admin Energy airdrop | `app/api/admin/energy-airdrop/route.ts`, `app/admin/page.tsx` | Owner signature, preview, confirmation, export. |
| Docs | `AUDIT_RESULTS.md`, `ADMIN_FEATURES.md`, `MIGRATION_AUDIT.md`, `TEST_RESULTS.md` | Audit and operator-facing notes. |

## Pending Owner Approval

| Area | Severity | Required Decision |
| --- | --- | --- |
| NPM vulnerabilities | Medium | Decide whether to run `npm audit fix` or schedule manual dependency upgrades. |
| Legacy Netlify function CommonJS warnings | Medium | Decide whether to rename legacy functions/helpers to `.cjs` or convert to ESM. |
| Netlify page deployment/runtime | High | Decide whether Netlify is functions-only or approve installing/configuring Netlify Next runtime/plugin. Local Netlify Dev page proxy hung, while functions and direct Next worked. |
| Energy transfer permissions | High | Confirm operator wallet has Energy Bank `SPENDER_ROLE` and `CREDIT_ROLE`. |
| Energy airdrop permissions | High | Confirm operator wallet has Energy Bank `DEFAULT_ADMIN_ROLE`. |
| Live wallet transaction testing | High | Owner should test Privy, browser fallback, recharge, lend, airdrop, and recovery with real wallets before production launch. |

## Config Checks

- `.env.example` documents safe public and private env names.
- Real `.env` secrets remain untracked.
- Final Cloudflare tunnel flow used direct Next on `3000`.
- Netlify Dev functions were reachable on `8888`; Netlify Dev page proxying to Next hung locally and needs owner-approved deployment cleanup if Netlify will host pages.
- Next production build emits migrated app routes and dynamic API routes.

## No-Go Conditions

Do not launch if:

- Owner wallet env is missing.
- Energy Bank operator roles are missing.
- Recharge treasury env is wrong.
- Netlify is selected for page hosting before the Next runtime/plugin decision is resolved.
- Live wallet transaction testing fails.
- Cloudflare final verification fails.
