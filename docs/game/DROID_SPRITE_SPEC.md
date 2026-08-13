# D.Y.O.O.R Overworld Droid Sprite Specification

Spec version: `dyoor-overworld-v1`

## Canvas and sheet

- Frame canvas: 64×64 transparent pixels
- Final sheet: 256×256 transparent PNG
- Columns per direction: 4
- Direction rows: down, left, right, up
- Total frames: 16
- Fixed foot anchor: x=32, y=58
- Visible character target: approximately 48–56 pixels tall
- Color mode: indexed or RGBA PNG
- Scaling: integer nearest-neighbor only
- Anti-aliasing, blur, fractional placement, and resampling are prohibited

Sheet layout:

| Row | Direction | Frames |
| --- | --- | --- |
| 0 | down/front | 0, 1, 2, 3 |
| 1 | left | 0, 1, 2, 3 |
| 2 | right | 0, 1, 2, 3 |
| 3 | up/back | 0, 1, 2, 3 |

Frame names are `{direction}-{frame}`, such as `down-0` and `left-3`.
Animation names are `{texture-key}-walk-{direction}`. The prototype uses eight
frames per second and loops walking animations.

## Collection silhouette

Every Droid, including procedural fallbacks, must preserve the collection's
recognizable anatomy:

- Tall rounded-rectangular Droid head rather than a square robot head
- Side ear pod
- Large expressive eye and mouth area
- Exposed segmented mechanical neck
- Compact clothing silhouette
- Slim articulated arms and legs
- Trait-visible headwear, eyewear, mouth, clothing, and accessories

Generic box robots are a validation failure even when their sheet dimensions
are correct. The current metadata compositor follows this silhouette for all
3,333 records. It is still an engineering placeholder until the matching
directional trait layers receive artist approval.

## Walk cycle

- Frame 0: neutral contact
- Frame 1: first stride with a one-pixel body bob
- Frame 2: neutral/pass
- Frame 3: opposite stride with a one-pixel body bob

The foot anchor must remain at `(32, 58)` in every direction and frame. Apparent
body bob is created above the anchor; the anchor itself does not move.

## Layer order

Lowest to highest:

1. Background-dependent floor shadow, if approved
2. Droid/base body
3. Conditions
4. Stickers/Body art
5. Clothes
6. Mouth
7. Eyes
8. Hat
9. Accessories
10. Accessories 2
11. Special
12. Explicit foreground effects approved for that trait

Every layer sheet must use the same 256×256 canvas, row order, frame order, and
anchor. Empty traits still need either an explicit transparent layer decision or
the manifest status `not_required`.

## Naming rules

Generated layer IDs use a normalized trait category, normalized trait value, and
a stable suffix, for example:

```text
hat--halo--059407c58f
```

Artist-authored layer sheets live under:

```text
apps/game/public/assets/sprites/layers/<category>/<layer-id>.png
```

Each sheet needs an adjacent `.sprite.json` sidecar containing:

- `specVersion`
- `frameWidth` and `frameHeight`
- `frameCount`
- `directions`
- `framesPerDirection`
- `footAnchor`
- `placeholder`

## Trait compatibility

- A trait layer must not erase another category unless the manifest explicitly
  declares that occlusion.
- Hat, eyes, and accessory geometry must remain compatible with the approved
  Droid/base silhouette or declare supported base variants.
- A Special trait may replace multiple visual layers only through a reviewed
  compatibility rule.
- Empty Slot and None are never interpreted as interchangeable unless the
  source metadata says so.
- Trait names and capitalization come from normalized collection metadata, not
  filenames guessed by an artist.

## Mirroring

Right-facing frames may be mirrored from left only when all visible traits are
bilaterally safe. Do not mirror:

- Text, logos, directional symbols, or one-sided body art
- One-sided accessories
- Asymmetrical damage or Conditions
- Lighting or effects with a fixed world direction

When any active layer is unsafe to mirror, author both directions.

## Special-trait behavior

Special traits must declare one of:

- `overlay`: draws above normal layers
- `replacement`: replaces named categories
- `environmental`: emits a separate world effect
- `animation`: adds approved extra frames handled outside the base walk sheet

The base 16 frames remain mandatory even when a separate effect atlas exists.

## Export and validation

- Disable smoothing and color-profile transformations that alter pixel values.
- Export exactly 256×256.
- Preserve transparency.
- Do not trim the canvas.
- Do not scale a full-resolution NFT image into the sheet.
- Keep placeholder and final outputs in separate directories.

Validate with:

```bash
npm run game:sprites:validate
```

The validator checks dimensions, frame count, direction order, sidecar version,
foot anchor, and placeholder status. Visual compatibility still requires human
review; an automated pass does not certify artistic quality.

## AI-assisted pilot status

Reference-guided pilot sheets may be used to test collection fidelity before
all 249 reusable trait layers are hand-authored. A pilot must:

- Be a new directional pixel-art interpretation, never a resized NFT portrait
- Preserve the source token's normalized metadata traits
- Use the same 4×4 direction and frame order as final sheets
- Pass the same dimensions, frame-count, anchor, and alpha validation
- Carry `placeholder: true`, `assetStatus: "ai-assisted-pilot"`, and
  `productionReady: false` in its sidecar
- Live only under `public/assets/sprites/pilots`
- Never be copied into the final trait-layer directory without artist review

Process a generated 4×4 concept grid with:

```bash
npm run game:sprites:pilot:process -- \
  --input /absolute/path/to/concept-grid.png \
  --token-id 16
```

For a non-token prototype character, use a safe local slug instead:

```bash
npm run game:sprites:pilot:process -- \
  --input /absolute/path/to/concept-grid.png \
  --asset-id corrupted-scout
```

The processor samples and removes the chroma background, rejects isolated
generation artifacts, extracts all 16 cells, applies one consistent scale,
uses nearest-neighbor resampling, aligns every frame to `(32, 58)`, and writes
an auditable sidecar.

## Separate battle sheets

Battle presentation uses a separate 384×128 sheet and pose set:

| Frame | Name | Purpose |
| --- | --- | --- |
| 0 | `idle` | Side-facing combat stance |
| 1 | `charge` | Forward lean, extended core arm, and charge effect |
| 2 | `hit` | Recoil pose used for damage feedback |

Each battle frame is 128×128. A matching high-detail pilot supplies distinct
side-facing walk poses for idle, charge, and hit composition, plus a battle-only
Core charge effect. Every other Droid is drawn from the same normalized
metadata visual model as the overworld sheet so body, clothes, eyes, mouth,
hat, accessories, Conditions, stickers, and Special remain consistent. Trait
Lab changes invalidate both texture keys and prevent a stale pilot match.

The combat view uses original D.Y.O.O.R staging, commands, effects, names, and
balance. It may follow established turn-based readability conventions, but it
must not reproduce another game's creatures, interface, text, sounds, maps, or
exact mechanics.
