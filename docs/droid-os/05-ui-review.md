# Droid OS — local UI review

Status: presentation prototype only, 6 September 2026. This is not completion of Phase 1's canonical identity, live portfolio or owner-authorized custody integration.

## Open locally

From the `feat/droid-os-ui-review` worktree at `/private/tmp/dyoor-live-preview`, run `npm run preview:droid-os`. Open **http://localhost:3202/droid-os**. The loopback server renders the actual React components with their styles and locally stored artwork; it exposes no API and blocks network connections using CSP.

The Next route `/droid-os` uses a build-time presentation flag. Netlify deploy previews explicitly set `DROID_OS_UI_PREVIEW=true`; production and branch-deploy contexts force it off. Local builds can explicitly opt in. The flag is a non-secret UI switch, not a financial authorization control. The route is not added to production navigation, and no production flag or secret was changed.

## Review scope

- Select four sample Season 2 Droids using the roster or arrow keys.
- Review the selected character, identity presentation, ASK mode and sample wallet summary.
- Try the full-size Talk experience with scripted, labeled responses. Messages do not leave the UI.
- Explore portfolio, strategy, missions, opportunities, activity, achievements, Energy, Trait Lab and settings through desktop navigation or the mobile More selector.
- Change soft preference chips, review a non-saved strategy draft, or add a local research mission draft. Draft missions do not execute.
- Open Fund/Withdraw previews. These explain the owner → Droid and Droid → owner flows without generating an address, signature or transaction.

The palette retains the main site's charcoal, cyan and purple. Original NFT artwork is the hero. Mobile uses a dedicated character screen, full-height workspace and bottom navigation. Reduced-motion rules, focus styling, roster keyboard navigation and native modal focus handling are included.

## Explicit fixture boundaries

The roster is **not** connected wallet ownership. Names use the selected token identity, for example `D.Y.O.O.R #11`; placeholder nicknames were removed following review. Classes, interests, balances, Energy and achievement counts are fictional design fixtures. Images are original Season 2 samples, not claims about currently accepted rerolls. No fiat values are fabricated. Achievements are labeled concept badges, opportunities are disconnected, activity is sample history, and financial requests receive a non-executing preview explanation.

UI drafts/conversations are local component state and may reset on Droid/view changes or reload. They are not persistent Droid OS records. No production state, keys, contract roles, approvals, saved traits, metadata URIs, Energy balances or wallet funds were changed.

## Verification

Eight UI-boundary tests and 61 existing website tests passed, including canonical token labels and production-disabled build gating. The local browser test (`node scripts/test-droid-os-preview.mjs`, with isolated Chrome CDP on 9224) passed desktop and 390×844 mobile selection, chat, strategy draft, modal Escape, navigation and mission-draft flows, plus 768×1024 tablet and 1280×800 laptop layout checks. It detected no horizontal overflow, uncaught runtime errors or API calls. Screenshots were inspected locally. TypeScript and ESLint passed.

The full Next production build passed using the audit worktree's local `NODE_PATH` / `--webpack` workaround, and TypeScript passed. Existing optional Privy Stripe/Farcaster dependency warnings remain unchanged. The production build command/configuration was not altered. The review server returned HTTP 200 for the UI, 404 for an API request and 405 for a POST request.

Next gate: user visual review before canonical identity/backend integration or new contracts. Do not describe sample data as operational Droid OS functionality.
