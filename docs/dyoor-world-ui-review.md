# dYOOR World UI review — September 6, 2026

Status: design approved; release candidate undergoing CI and deployed smoke checks.

## Scope

- Main-site charcoal, cyan, purple, and cool-white styling; an editorial holder entrance. Updated after local design review without changing the approved layout.
- Grouped navigation using the existing server-authorized channel IDs.
- Restyled conversations, composer, inbox, identity, notifications, and Energy wheel.
- Mobile room context, larger touch targets, keyboard-contained drawers, focus restoration, browser zoom, and reduced-motion support.

No changes to holder authentication, API routes, contract calls, transaction preflights, reward probabilities, Energy accounting, saved rerolls, or IPFS data.

## Local review

The temporary design harness at `http://localhost:3201` renders the actual World components with explicitly labeled sample data. `/?gate=1` previews the entrance; `/?s1=1` previews Season 1 access. Wallet actions and API writes are disabled. The harness is outside the repository and is not part of a deploy.

Desktop and 390px mobile views were checked in Chrome, including room selection, independent panel scrolling, thread focus wrapping, Escape/trigger restoration, and identity-panel initial focus. This is visual and interaction testing, not a live-wallet end-to-end test.

## Validation notes

The 54 website checks and a clean TypeScript check pass. World security and reroll regression checks pass. The broader production-boundaries suite has an existing homepage-copy assertion expecting “Droid Burn Cap”; neither that test nor the homepage changes in this branch.

The local Next.js dev smoke check did not complete: Turbopack rejects the external dependency symlink, and the webpack attempt stalled with malformed generated route files in the existing external-drive cache. The old cache was preserved and fresh route types were generated. A full Next.js build and deployed holder-session check are still required before release.
