# HoodYØØR GTD launch artwork

## Generated assets

- Desktop hero source: `/Users/brandonduke/.codex/generated_images/019fcfa6-f0a5-7cb2-88d4-88ad1499ee29/exec-6b1a164a-3872-4602-b5c6-1137f0b31860.png`
- Mobile hero source: `/Users/brandonduke/.codex/generated_images/019fcfa6-f0a5-7cb2-88d4-88ad1499ee29/exec-882e6e80-3f6d-42cf-85fa-ab16e2ae4115.png`

Copy these into the launch application's public asset directory before wiring them into the page. Suggested names:

- `hoodyoor-gtd-hero-desktop.png`
- `hoodyoor-gtd-hero-mobile.png`

## Intended use

- Desktop: use the left half for the HoodYØØR headline, supply/mint details, and GTD-wallet form. Keep the droid anchored right.
- Mobile: use the upper portion for copy and controls. Keep the droid anchored center-bottom.
- Both artworks intentionally contain no baked-in text, buttons, or wallet UI.

## Existing collection references

- PFP: `data/robinhood/branding/robinhood-collection-pfp.png`
- Banner: `data/robinhood/branding/robinhood-collection-banner.png`

## Responsive recommendation

Use a `<picture>` source switch rather than cropping the desktop hero into a portrait viewport. Apply `object-fit: cover`; use a right-center object position for desktop and center-bottom for mobile.
