# World Trade desk loading fix — 6 September 2026

Status: local follow-up to the Droid OS audit. No live escrow action or production deployment performed.

## Reproduced causes

1. The four-second message poll aborted an in-flight initial load and replaced it with a silent request. A six-second response was therefore repeatedly cancelled; the original loading flag could remain set even after a silent request completed.
2. The fixed-height flex conversation shell shrank the trade panel, whose `overflow-hidden` clipped the controls. At 1440×900, the rendered forms were approximately 688px tall inside a 72px parent.

## Changes

- Silent polling skips requests already in flight. Foreground reload/channel changes still cancel obsolete requests, with sequence checks preventing stale state updates.
- Requests have a 20-second abort deadline, separate message error state and a Retry messages button. A message refresh no longer clears unrelated transaction errors.
- Channel cleanup invalidates pending callbacks. Foreground loads clear old-channel messages.
- Trade panel children cannot shrink; the conversation scrolls and the message area has a bounded height. No escrow calldata, approval logic, wallet authorization, Energy or reroll code changed.

## Local evidence

A no-signing design harness rendered the actual World component with explicitly labeled demo data and delayed message responses. Before: three stuck skeletons after repeated polling and a clipped 72px panel. After: zero skeletons, a 721px panel containing the 688px forms, and a scrollable conversation.

Regression suite now includes executable tests of the actual TypeScript message-loader callback: in-flight polling, supersession, timeout/retry, HTTP failure and channel cleanup, plus layout/source guard assertions. This is not an authenticated live trade test. Owner-only transaction functionality was deliberately not exercised on mainnet.

At 390×844 the forms occupied approximately 933px inside a 958px parent, with zero skeletons and no horizontal overflow after loading. Desktop and mobile screenshots were inspected. The design harness does not provide complete live image/API coverage; asset loading or real wallet trades are not certified by these screenshots.

Validation: **61 website tests**, **13 World security / Trait Lab reroll regression tests**, TypeScript and ESLint passed. Full production build passed with `NODE_PATH=/Users/brandonduke/Projects/DYOOR/node_modules npm run build -- --webpack`. This local command accommodates the isolated worktree's external-drive symlinks; normal build/deployment configuration is unchanged. Optional Privy Stripe/Farcaster dependency warnings remain documented in the audit.

Do not describe this local fix as deployed until a separate release is confirmed.
