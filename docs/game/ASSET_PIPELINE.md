# Metadata and Pixel Asset Pipeline

## Source of truth

The pipeline reads the 3,333 canonical Season 2 metadata records. It validates
token IDs 1–3333, required trait categories, duplicate categories, response
size, and image URL safety. Cached source records live under ignored
`data/game/cache/metadata`.

The prototype never treats a resized NFT portrait as finished directional game
art.

## Scan and catalog

```bash
npm run game:metadata:scan
npm run game:traits:catalog
```

Generated review artifacts:

- `data/game/metadata-scan-report.json`
- `data/game/trait-frequency.json`
- `data/game/trait-manifest.json`
- `data/game/artist-task-list.json`

The initial scan found 3,333 valid records, 11 categories, 249 distinct trait
values, and no missing metadata records. The first art catalog has 249 missing
directional layer tasks because final pixel layers do not yet exist.

## Layer authoring workflow

1. Select a task from `artist-task-list.json`.
2. Follow `DROID_SPRITE_SPEC.md`.
3. Save the final sheet in the manifest’s approved layer path.
4. Add its sidecar.
5. Change the manifest entry from `missing` to `ready`.
6. Run sprite validation.
7. Generate affected token sheets.
8. Visually review every direction and interaction with other active layers.

Do not edit generated token sheets by hand. Correct the reusable source layer
and regenerate.

## Compose one token

```bash
npm run game:sprites:generate -- --token-id 1100
```

The generator hashes the normalized trait set and spec version. If every layer
is ready, it composes in canonical category order. If any required layer is
missing, it creates a clearly marked engineering placeholder and lists every
missing layer ID.

## Incremental generation

```bash
npm run game:sprites:generate-all
```

Generated sheets and index data live under ignored `apps/game/.cache/sprites`.
The cache index includes the normalized trait hash and metadata-renderer
version. Unchanged tokens are reused, metadata changes regenerate only the
affected token, and a renderer upgrade safely invalidates older placeholders.

When Trait Lab changes metadata:

1. Fetch current metadata without trusting browser-supplied traits.
2. Compare metadata version and stable trait hash.
3. Invalidate the old token composition if the hash changed.
4. Recompose from approved layers.
5. Publish through a versioned asset path or controlled resolver.
6. Refresh the game character after a session boundary or explicit sync.

The current prototype implements hash comparison and incremental composition.
It does not publish generated sheets or mutate Trait Lab.

## Runtime metadata composition

The local game can now compose the selected Droid on demand without loading
3,333 full-resolution NFT images. The deterministic model translates all 11
metadata categories into:

- Body palette, shadows, highlights, and chrome treatment
- Condition and body-art overlays
- Clothing silhouette and trim
- Eye, mouth, and headwear forms
- Two independent accessory slots
- Highest-priority Special overlays

Run the collection-wide coverage audit with:

```bash
npm run game:sprites:style-report -- --offline
```

The current report validates 3,333 of 3,333 records, produces 3,333 unique
visual signatures, and reports zero invalid tokens. Background is retained for
selection-card or environment treatment and intentionally does not alter the
overworld body silhouette.

High-fidelity pilot art is selected only when the complete current trait set
still matches its reviewed pilot. If any visible trait changes, the game falls
back to a freshly composed metadata sprite instead of displaying stale art.
Six current pilots cover tokens 16, 17, 132, and 1100 plus the guest Training
Droid and Corrupted Scout. All share the same tall capsule head, segmented
neck, compact torso, and thin articulated limbs. The same trait identity feeds
a separate three-pose 128px battle compositor.

## Validation

```bash
npm run game:sprites:validate
```

Validation covers:

- Exact 256×256 sheet size
- 16 frames at 64×64
- Required row and direction order
- Foot anchor `(32, 58)`
- Sidecar and spec version
- Placeholder labeling

Human review remains mandatory for silhouette readability, layer occlusion,
palette consistency, asymmetry, animation quality, and story appropriateness.

## Safety controls

- Metadata URLs require HTTPS, except explicit localhost development.
- IPFS URLs allow only a constrained character set.
- Responses are capped at 512 KB per token.
- Local paths are resolved and checked against approved roots.
- Cache and generated paths are ignored by Git.
- No script exposes metadata/Blob writes, deployment, or transactions.
