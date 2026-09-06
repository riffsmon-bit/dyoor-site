# Droid OS — local UI review

Status: presentation prototype only, 6 September 2026. This is not completion of Phase 1's canonical identity, live portfolio or owner-authorized custody integration.

## Open locally

From the `feat/droid-os-ui-review` worktree at `/private/tmp/dyoor-live-preview`, run `npm run preview:droid-os`. Open **http://localhost:3202/droid-os**. The loopback server renders the actual React components and exposes only the four allowlisted public artwork GETs. CSP permits those same-origin reads and the production artwork hosts; all mutations remain blocked.

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

The roster is **not** connected wallet ownership. Names use the selected token identity, for example `D.Y.O.O.R #11`; placeholder nicknames were removed following review. Classes, interests, balances, Energy and achievement counts are fictional design fixtures. Artwork now reads current production metadata, including accepted rerolls; it is not fictional data. No fiat values are fabricated. Achievements are labeled concept badges, opportunities are disconnected, activity is sample history, and financial requests receive a non-executing preview explanation.

UI drafts/conversations are local component state and may reset on Droid/view changes or reload. They are not persistent Droid OS records. No production state, keys, contract roles, approvals, saved traits, metadata URIs, Energy balances or wallet funds were changed.

## Verification

Eight UI-boundary tests and 61 existing website tests passed, including canonical token labels and production-disabled build gating. The local browser test (`node scripts/test-droid-os-preview.mjs`, with isolated Chrome CDP on 9224) passed desktop and 390×844 mobile selection, chat, strategy draft, modal Escape, navigation and mission-draft flows, plus 768×1024 tablet and 1280×800 laptop layout checks. It detected no horizontal overflow, uncaught runtime errors or API calls. Screenshots were inspected locally. TypeScript and ESLint passed.

The full Next production build passed using the audit worktree's local `NODE_PATH` / `--webpack` workaround, and TypeScript passed. Existing optional Privy Stripe/Farcaster dependency warnings remain unchanged. The production build command/configuration was not altered. The review server returned HTTP 200 for the UI, 404 for an API request and 405 for a POST request.

Next gate: user visual review before canonical identity/backend integration or new contracts. Do not describe sample data as operational Droid OS functionality.

## Live artwork correction

The original UI fixtures incorrectly showed the initial artwork for rerolled Droids. The preview now reads the canonical production metadata origin `https://dyoor.netlify.app/api/metadata/{id}` (also the existing on-chain URI origin), never its deploy-preview Blob store. Both hero and roster use the returned accepted image. The production Netlify hostname serves the same site's content-addressed rendered images; no production domain or metadata URI was changed. Droid 16 was verified at metadata version 6 on 6 September, with Bartman Shirt n Cape, Horns, Shramp and 10KSquad.

Reads accept only canonical Season 2 IDs 1–3333, with a 12-second deadline, a 256 KiB metadata limit, no credentials, no redirects and no-store caching. Render paths must match both token ID and metadata version and a recognized production host. Loading/failure is explicit, never replaced with original art. A refresh button reloads current metadata without signing or changing state. Metadata requests are bounded to four concurrent workers. These reads do not establish ownership or financial authority.

## Connected roster

The hosted Next preview now uses the existing wallet connection service for account discovery only. Connect wallet loads the complete existing `/api/s2/owned-tokens` result; response wallet, collection, IDs, duplicates and count are checked. The public endpoint returned 43 IDs for the user's wallet during verification. There is no four-token truncation. The roster scrolls horizontally, and both hero and thumbnails use production artwork. A wallet change hides the prior roster immediately and aborts pending reads. Empty/error states never substitute sample Droids; disconnected design review remains explicitly labeled.

Holdings are a read snapshot from the existing service, whose cache can last up to two minutes; they are NOT transaction authorization. Current ownerOf must be revalidated independently before any future security-sensitive action. No owner key, signer, signature, approval, chain-switch or transaction method is called by the connected UI. Portfolio/Energy/achievement data is shown as unavailable when a real wallet is selected. Other panels remain labeled demonstrations. Eighteen UI/artwork/roster tests and TypeScript passed locally; hosted connected-wallet checks are the next verification gate.

## Hosted PR review

Draft [PR #29](https://github.com/riffsmon-bit/dyoor-site/pull/29) provides [the hosted UI preview](https://deploy-preview-29--dyoor.netlify.app/droid-os). GitHub's website checks and the Netlify deploy passed for UI commit `80b1a16`. The browser flows above also passed against the hosted preview on desktop, mobile, tablet and laptop, and desktop/mobile screenshots were inspected.

Unlike the isolated local harness, the hosted Next layout initializes the existing Privy provider. The initial browser test's blanket no-API assertion therefore failed on public Privy app configuration/analytics and CSP reporting, after all interaction checks passed. The test now explicitly permits only those endpoints/methods and separately counts them; application APIs and unexpected API calls still fail the test. The hosted rerun passed with no uncaught runtime errors or application API calls. This is presentation verification, not a connected-wallet, trading, minting or authorization test.
