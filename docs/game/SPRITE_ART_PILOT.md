# D.Y.O.O.R Collection-Faithful Sprite Pilot

Status: local prototype art, not final production layers

## Goal

Replace generic box-robot placeholders with overworld characters that preserve
the Season 2 collection's defining visual language:

- Tall rounded-rectangular Droid heads
- Thick dark contour lines
- Expressive oversized eyes and mouths
- Side ear pods
- Exposed segmented mechanical necks
- Slim articulated limbs
- Trait-specific clothing, headwear, and accessories

The pilots are reference-guided redraws. No NFT portrait was resized and
presented as finished game art.

## Prompt set

The pilots were created with the built-in image-generation tool using the
original public token artwork as the identity and trait reference.

### Shared production prompt

```text
Use case: stylized-concept
Asset type: browser RPG pixel-art character sprite-sheet pilot
Primary request: create a coherent four-direction walking sprite sheet for the
same D.Y.O.O.R character, retaining the collection's unmistakable elongated
Droid design.
Style/medium: polished handcrafted 16-bit pixel art, deliberate pixel clusters,
one-pixel near-black outlines, compact limited palette, no anti-aliasing, no
painterly texture, and no smooth vector edges.
Composition/framing: exact 4 by 4 sprite grid; four columns of walk-cycle frames;
rows ordered FRONT/DOWN, LEFT, RIGHT, BACK/UP; equal square cells; full character
visible at a consistent scale; fixed foot anchor; opposing strides in frames 1
and 3.
Scene/backdrop: perfectly flat solid #ff00ff chroma-key background.
Constraints: all 16 frames depict the same character; views are logically
consistent; nearest-neighbor pixel appearance; no cropped traits; no shadows,
scenery, labels, panel borders, watermark, UI, captions, or extra characters.
Avoid: generic box robots, human anatomy, chibi round heads, photorealism,
vector smoothing, blur, gradients, weapons, and unrelated traits.
```

### Token 16 identity prompt

```text
Full-body lime-green Droid with a tall rounded rectangular head, side ear pod,
segmented mechanical neck, black circular Abyss Laser eye housings with a
restrained red inner glow and no long beams, Diamond Grill, cyan Blue Hoodie,
slim mechanical limbs, and red McDYOORs cap with a small yellow arch insignia.
Preserve the lanky comic proportions and thick dark contour language of the
reference.
```

### Token 132 identity prompt

```text
Full-body red Droid with a tall rounded rectangular head, side ear pod,
segmented mechanical neck, close-set off-white Intense eyes with tiny dark
pupils and worried brow creases, tiny crooked silver Emo Whatever mouth,
crisp White Shirt W:Tie, slim red mechanical limbs, and no hat.
```

### Token 1100 identity prompt

```text
Full-body lime-green Droid with a tall rounded rectangular head, side ear pod,
segmented mechanical neck, droopy Excited eyes, huge open AHHH mouth with a
long dusty-pink tongue, extravagant Fur Coat Gold, slim green mechanical limbs,
and a centered hovering gold Halo in every direction.
```

### Token 17 / Dr. Halogen identity prompt

```text
Use the supplied D.Y.O.O.R directional sprite sheets as the exact style,
proportion, grid, and animation reference. Create the same 4×4 transparent
walk-sheet treatment for D.Y.O.O.R #17: a tall red Droid with rounded
rectangular head, side ear pod, segmented mechanical neck, red hoodie, Ricky V
eyewear, Drool mouth, slim articulated red limbs, and a centered floating gold
Halo visible in every direction. Rows are front/down, left, right, back/up;
four coherent walk frames per row; fixed feet; deliberate hard pixel clusters;
no anti-aliasing, scenery, text, UI, shadows, or additional characters.
```

### Guest Training Droid prompt

```text
Use the supplied Dr. Halogen sheet as the exact anatomy, pixel-density,
outline, proportion, and animation-layout reference. Create an original
Training Unit 01 with a tall turquoise Training Alloy capsule head, thin
segmented neck, compact navy training vest with a small gold Energy Core
insignia, skinny articulated limbs, warm-white Core Scanner eyes with tiny cyan
pupils, neutral mechanical mouth, and short calibration antenna. Produce an
exact 4×4 grid ordered front/down, left, right, back/up with four walk frames
per row and a fixed foot baseline on a flat #ff00ff chroma background. No text,
UI, props, scenery, extra characters, antialiasing, bulky humanoid proportions,
or copied commercial-game designs.
```

### Corrupted Scout prompt

```text
Use the supplied Dr. Halogen sheet as the exact anatomy, pixel-density,
outline, proportion, and animation-layout reference. Create an original
Corrupted Scout with a tall Dark Chrome capsule head, Dirty-Broken cracks and
restrained grime, thin segmented neck, Torn Black Tee, Radiation Glow red laser
eyes, open AHHHH Flames mouth, Burning Chog antenna, small cyan-and-purple
DYOOR chest marking, compact torso, and skinny articulated limbs. Produce an
exact 4×4 grid ordered front/down, left, right, back/up with four walk frames
per row and a fixed foot baseline on a flat #ff00ff chroma background. No text,
UI, props, scenery, extra characters, antialiasing, bulky humanoid proportions,
or copied commercial-game designs.
```

The built-in image-generation workflow used the existing local token 16, 132,
and 1100 pilot sheets as style references for Dr. Halogen. The Dr. Halogen
sheet then became the shared anatomy reference for the guest and enemy. The
unmodified generated sources are retained at:

```text
apps/game/art/pilot-sources/dyoor-17-source-v1.png
apps/game/art/pilot-sources/training-unit-01-source-v1.png
apps/game/art/pilot-sources/corrupted-scout-source-v1.png
```

## Engine processing

The generated concept grids were not loaded directly. The local Sharp-based
processor:

1. Samples the border chroma color.
2. Removes the magenta background.
3. Removes isolated generation artifacts per grid cell.
4. Extracts all 16 source poses.
5. Calculates one consistent character scale for the whole sheet.
6. Resizes with nearest-neighbor sampling.
7. Aligns every foot position to `(32, 58)`.
8. Writes a 256×256 transparent PNG and sidecar.

Command:

```bash
npm run game:sprites:pilot:process -- \
  --input /absolute/path/to/generated-grid.png \
  --token-id <1-3333>
```

Non-token game characters use `--asset-id <safe-slug>` instead of
`--token-id`. The processor rejects unsafe slugs and path escapes.

## Saved pilot assets

- `apps/game/public/assets/sprites/pilots/dyoor-16-walk-v1.png`
- `apps/game/public/assets/sprites/pilots/dyoor-132-walk-v1.png`
- `apps/game/public/assets/sprites/pilots/dyoor-1100-walk-v1.png`
- `apps/game/public/assets/sprites/pilots/dyoor-17-walk-v1.png`
- `apps/game/public/assets/sprites/pilots/dyoor-training-unit-01-walk-v1.png`
- `apps/game/public/assets/sprites/pilots/dyoor-corrupted-scout-walk-v1.png`

Token 16 and token 132 replace the two mock holder sprites in the local
prototype. The read-only registry verifies token 1100 as unminted, so its pilot
appears only as the game-controlled Echo Surveyor in the Core Laboratory. It
is never presented as owned or holder-selectable.

Token 17 is classified as a surviving minted/player-character record.
Dr. Halogen uses its visual identity only as a narrative appearance; the game
does not assert ownership or reclassify the NFT.

Training Unit 01 and the Corrupted Scout are original non-token game
characters. Their pilot art is matched against their complete local metadata
profiles and is used in overworld and separate battle-sheet composition.

All six pilots remain marked `productionReady: false`. Final collection-wide
support still requires reviewed reusable body and trait layers.
