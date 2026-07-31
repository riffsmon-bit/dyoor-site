# dYOOR World sticker artwork

Drop the production sticker images in this directory using these exact names:

- `gm-droid.webp`
- `charged-up.webp`
- `diamond-droid.webp`
- `burn-verified.webp`
- `send-it.webp`

Recommended export:

- WEBP with transparency
- 1:1 canvas
- 512 × 512 pixels
- sRGB
- under 350 KB per sticker
- no important artwork within 24 pixels of the edge

The chat UI automatically loads these files. Until a file exists, it uses the
existing code-rendered fallback sticker. To add a new sticker rather than
replace one, add its record to `lib/dyoor-world-media.ts` so the server can
validate its ID.
