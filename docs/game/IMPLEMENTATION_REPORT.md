# D.Y.O.O.R Game Prototype Implementation Report

Status: locally complete and commit-ready on `agent/dyoor-rpg-prototype`

Base commit: `58bbb1b`

Report date: 2026-07-29

## Outcome

The first D.Y.O.O.R browser RPG vertical slice is implemented as an isolated
Phaser 3, TypeScript, and Vite application in `apps/game`. It runs without a
persistent server, does not alter the production Next.js application at
runtime, and exposes interfaces for a future authoritative multiplayer
service.

The playable slice includes:

- A title screen with guest and optional holder entry paths
- A character selection screen
- A generic guest training Droid
- A development-only mock holder and owned Season 2 Droid flow
- A central laboratory and an outdoor industrial map
- Four-direction movement and walk animation
- Collision and camera following
- Desktop keyboard and mobile touch controls
- NPC dialogue with Dr. Halogen
- An Energy Core recovery quest
- A collectible Energy Core
- A hostile Corrupted Scout
- A turn-based battle with Alloy Strike, Core Pulse, Deflect, and Overclock
- Separate 128px battle poses, charge/hit feedback, and responsive combat HUD
- Health, Energy, inventory, victory, defeat, and local save/load state
- Automatic rarity-tiered Core Emission during exploration, quests, and battle
- A three-node Energy Seam Survey mining quest with local simulated rewards
- Six Dr. Halogen-style directional pilots covering four Season 2 appearances,
  the guest Training Droid, and the Corrupted Scout
- Deterministic metadata-driven Droid rendering coverage for all 3,333 records
- Responsive layouts tested at an iPhone-sized 390 × 844 viewport

No deployment, upload, smart-contract mutation, blockchain transaction, live
metadata mutation, Netlify Blob write, or production-site route change was
performed.

## Repository Findings

The production repository is a single npm package using Next.js 16.2.9,
React 19, the App Router, and strict TypeScript. It is not currently a
monorepo.

Important existing integrations discovered during inspection include:

- Privy is mounted through the production provider stack.
- Monad mainnet uses chain ID 143.
- The primary Season 2 ERC-721 contract is
  `0x349D8eb480c92cF75371fbA5C6344A4d11b9103A`.
- `/api/s2/owned-tokens` already performs server-side discovery and ownership
  verification using enumeration, indexed APIs, logs, and `ownerOf` checks.
- `/api/metadata/[tokenId]` and `lib/dyoor-s2-metadata.js` are the dynamic
  metadata source of truth.
- Metadata overrides are stored through Netlify Blob-backed production
  systems.
- The contract is ERC721A/SeaDrop based, starts token IDs at 1, and records a
  burn through `Transfer` to the zero address.
- The repository does not contain 3,333 canonical per-token JSON files. The
  collection manifest points to the pinned IPFS metadata source used by the
  read-only scanner.

The detailed findings, privileged boundaries, environment-variable inventory,
and reusable production systems are documented in
`docs/game/REPOSITORY_DISCOVERY.md`.

## Files Created

### Isolated game application

`apps/game/` contains:

- Vite, TypeScript, ESLint, Vitest, and package configuration
- Phaser scenes, entities, input, UI, data, services, and game systems
- A future multiplayer transport interface
- Read-only metadata, blockchain classification, rarity, role, and sprite
  scripts
- Thirteen test files
- A browser smoke-test tool
- An asset manifest that keeps placeholders explicitly separated from future
  production art

The complete file inventory is available from:

```bash
rg --files apps/game
```

### Generated public game data

`data/game/` contains:

- `metadata-scan-report.json`
- `trait-frequency.json`
- `trait-manifest.json`
- `artist-task-list.json`
- `droid-registry.json`
- `droid-classification-report.json`
- `rarity-report.json`
- `unminted-role-candidates.json`
- `manual-role-overrides.json`
- `sprite-validation-report.json`

The public Droid registry intentionally omits current owner addresses.

### Documentation

`docs/game/` contains:

- `REPOSITORY_DISCOVERY.md`
- `IMPLEMENTATION_PLAN.md`
- `ARCHITECTURE.md`
- `DROID_SPRITE_SPEC.md`
- `DROID_LORE_AND_ROLES.md`
- `SECURITY_MODEL.md`
- `PRODUCTION_READINESS_GAPS.md`
- `LOCAL_TESTING.md`
- `MOBILE_TESTING.md`
- `ASSET_PIPELINE.md`
- `MULTIPLAYER_ROADMAP.md`
- `DEPLOYMENT_ROADMAP.md`
- `IMPLEMENTATION_REPORT.md`
- `HYBRID_MMO_IDLE_DESIGN.md`
- `SPRITE_ART_PILOT.md`

## Existing Files Modified

- `.gitignore`
  - Ignores game builds, dependency caches, private chain caches, and generated
    production sprite outputs.
- `package.json`
  - Adds non-breaking `game:*` commands.
- `tsconfig.json`
  - Excludes the isolated Vite application from the production Next.js
    TypeScript project. The game has its own strict TypeScript configuration.

## Existing Systems Intentionally Untouched

- Production homepage, navigation, and whitepaper
- Privy provider implementation
- Monad network configuration
- Season 1 staking and Ascension
- Energy accounting and reward routes
- Season 2 Trait Lab, reroll, recycle, and burn flows
- Metadata API and Netlify Blob overrides
- OpenSea refresh tooling
- Blueprint and verification behavior
- Admin routes and credentials
- Smart contracts and deployment records
- Live metadata and marketplace state

## Local Commands

From the repository root:

```bash
npm run game:dev
npm run game:build
npm run game:test
npm run game:typecheck
npm run game:lint
```

The development command listens on all local interfaces and prints both:

- Desktop: `http://localhost:5173`
- Mobile: `http://<mac-local-ip>:5173`

No mock API server is required for guest mode. The explicit development wallet
mock can be opened with:

```text
http://localhost:5173/?mock-wallet=1
```

That query parameter is for local development only and is never an ownership
or reward authority.

## iPhone Testing

1. Connect the Mac and iPhone to the same Wi-Fi network.
2. Run `npm run game:dev`.
3. Open the printed `Network` URL on the iPhone.
4. If the page cannot connect, allow incoming connections for the terminal or
   Node process in macOS Firewall settings and confirm that the Wi-Fi does not
   isolate clients.
5. Test the directional pad, action button, inventory button, map transitions,
   dialogue, and battle controls in portrait and landscape orientations.

The complete troubleshooting guide is in `docs/game/MOBILE_TESTING.md`.

## Metadata Scan Results

The read-only full collection scan completed successfully:

- Expected records: 3,333
- Valid records: 3,333
- Invalid or unavailable records: 0
- Normalized token range: 1 through 3,333
- Trait categories: 11
- Unique trait values: 249
- Canonical metadata digest:
  `61a4102f2c3cdfd4d76ef1fc7bee9a63453f840be165fbbf14ed0ed98ec10232`

Unique-value counts:

- Background: 22
- Droid: 19
- Conditions: 4
- Stickers/Body art: 6
- Clothes: 58
- Mouth: 31
- Eyes: 33
- Hat: 43
- Accessories: 13
- Accessories 2: 13
- Special: 7

## Verified Blockchain Classification

The read-only classifier queried Monad mainnet and independently reconciled
mint logs, burn logs, contract counters, and current `ownerOf` results.

Snapshot block: `91,096,834`

- Contract `totalMinted`: 1,096
- Contract `totalSupply`: 1,039
- Verified surviving minted: 1,039
- Verified burned: 57
- Verified unminted metadata records: 2,237
- Invalid or unavailable: 0
- Transfer logs processed: 1,443
- Unique mint events: 1,096
- Current owner reads: 1,039
- Owner read failures: 0
- Owner mismatches: 0
- Classifier warnings: 0

The result is a point-in-time snapshot. Production gameplay must verify
ownership at runtime and recheck it at meaningful session boundaries.

## Rarity and Story Role Results

Rarity uses a deterministic collection-wide information score:

```text
sum(log2(total records / records with trait value))
```

It is used only for game-role suggestions and is not a market-value claim.

- Records scored: 3,333
- Minimum score: 20.075773
- Maximum score: 51.173353
- Mean: 28.029295
- Median: 27.533511
- Regional boss candidates: 12
- Dungeon boss candidates: 24
- Companion candidates: 30
- Visually distinctive common candidates: 30
- Special-trait conflicts: 0
- Missing metadata or images: 0

Manual role overrides always take priority over generated suggestions.

## Sprite Pipeline Status

The engineering pipeline is complete, and six AI-assisted directional pilot
sheets now demonstrate one consistent Dr. Halogen-style Droid anatomy. Four
pilots map actual Season 2 traits; two cover the original guest and enemy game
profiles. They are review assets, not final production art.

- Required sheet: 256 × 256 pixels
- Frame size: 64 × 64 pixels
- Directions: down, left, right, up
- Frames per direction: 4
- Total frames: 16
- Foot anchor: 32, 58
- Valid AI-assisted pilots: tokens 16, 17, 132, and 1100; Training Unit 01;
  Corrupted Scout
- Metadata visual records validated: 3,333 of 3,333
- Unique metadata visual signatures: 3,333
- Invalid metadata visual records: 0
- Ready final reusable trait layers: 0 of 249
- Artist tasks generated: 249

Token 1100 was regenerated as an explicitly labeled engineering placeholder.
The Season 2 pilots preserve recognizable combinations including token
16's McDYOORs/Abyss Laser/Blue Hoodie, token 132's white shirt and tie, and
token 1100's Halo/gold fur silhouette. Token 17 supplies Dr. Halogen's red
hoodie, Ricky V, Drool, and Halo appearance. The Training Droid and Corrupted
Scout use the same capsule head, segmented neck, compact torso, slim limbs, and
pixel density while retaining their own metadata. Every sheet validates at
256 × 256 with 16 frames and zero errors. The pilots were generated with the
built-in image-generation workflow, processed through the audited local Sharp
dependency, and remain marked `placeholder`, `ai-assisted-pilot`, and
`productionReady: false`.

The verified registry classifies token 1100 as unminted. Its art is used only
for the game-controlled Echo Surveyor in the Core Laboratory; it is not
offered in the holder character selector.

The verified registry classifies token 17 as surviving minted. Dr. Halogen's
use of that appearance is a narrative cameo only and does not assert ownership
or change the token's classification.

The runtime fallback compositor maps every normalized record through the same
tall capsule head, segmented neck, compact torso, slim limbs, and all 11 trait
categories. Pilot assets are selected only while their complete traits match;
any Trait Lab visual change automatically falls back to a newly composed
trait-safe texture. Battle scenes use separate 384×128 sheets with distinct
idle, charge, and hit poses. High-detail pilots supply pose-specific side
frames; unmatched metadata uses the same trait renderer.

The pipeline refuses to describe resized NFT artwork as final pixel art and
will only assemble a final sheet when all required reusable trait layers are
ready. Prompts, provenance, review requirements, and paths are documented in
`docs/game/SPRITE_ART_PILOT.md`.

## Hybrid MMO, Core Emission, And Mining

Passive Core Emission begins automatically when a character is selected and
continues during movement, dialogue, quests, mining, and battle. It does not
require an idle center or dispatch terminal. The transparent prototype rates
are:

- Mythic: 100 simulated Energy/hour
- Legendary: 65/hour
- Epic: 40/hour
- Rare: 25/hour
- Uncommon: 15/hour
- Common: 10/hour

The game re-derives rarity score, tier, and rate from normalized metadata and
caps local offline accrual at eight hours. The browser bank is explicitly
nonvaluable.

Completing Core Recovery unlocks Dr. Halogen's Energy Seam Survey. Three unique
Rustbelt nodes each award 10 local simulated Energy; turning in all samples
awards one Energy Cell and 100 additional simulated Energy. Node IDs and quest
stages are bounded and deduplicated locally, but a reward-bearing version must
be server-authoritative.

The intended active-world/idle cadence and the required authoritative server
model are documented in `docs/game/HYBRID_MMO_IDLE_DESIGN.md`.

## Wallet and Trait Lab Integration Boundary

The standalone game does not mount a second Privy provider and does not copy
production credentials. It accepts an approved host adapter at
`window.dyoorGameHost` with methods to connect, discover owned Season 2
Droids, and freshly verify ownership.

Selection requires:

- Server-shaped owned-token discovery
- Bounded and normalized metadata
- A fresh ownership recheck
- Rejection of burned, transferred, unminted, or browser-invented token IDs

The production Next.js-to-game host adapter is intentionally not enabled in
this prototype. Guest mode is complete; the local mock holder flow validates
the boundary. Wiring the real host adapter requires a separately reviewed,
backward-compatible production integration.

Trait metadata is reduced to a deterministic trait hash and metadata version.
Those values form the sprite cache key, so a Trait Lab change invalidates only
the affected Droid when synchronization is added. The existing Trait Lab was
not modified.

## Security Review

Implemented controls include:

- No secrets or privileged environment values in the game bundle
- No client-only token ID accepted as ownership proof
- Fresh ownership verification before holder selection
- Burned-token rejection
- Metadata schema bounds and normalization
- HTTPS/IPFS image URL allowlisting
- Output path containment for generated assets
- JSON parsing and prototype-key defenses
- Versioned, bounded local save data
- Re-derived emission rarity/rate state and capped offline credit
- Bounded, unique Energy mining node identifiers and quest stages
- No client authority for valuable rewards
- No public owner-address registry
- RPC retries, timeouts, pagination, caching, and adaptive log ranges
- A future authenticated server transport boundary

All combat, inventory, quest, and save state in this prototype is local and
nonvaluable. Those systems must move behind an authoritative server before
multiplayer, trading, competitive state, or rewards are enabled.

The isolated game dependency audit reports:

- Critical: 0
- High: 0
- Moderate: 0
- Low: 0

## Test and Build Results

### Before implementation

- Production lint: pass
- Production typecheck: pass
- Production build: pass with the existing edge-runtime static-generation
  warning
- Existing tests: 110 passed, 1 failed

The pre-existing failure is
`the whitepaper positions dYOOR World as the holder home and social apps as onboarding`.
Its assertion still expects the removed exact phrase
`Holder-Exclusive Community Layer`.

### After implementation

- Game lint: pass, zero warnings
- Game typecheck: pass
- Game tests: 41 passed across 13 files
- Game production build: pass
- Game dependency audit: 0 vulnerabilities
- Production lint: pass
- Production typecheck: pass
- Production build: pass
- Existing tests: 110 passed, the same 1 pre-existing whitepaper wording
  assertion failed

No new production test failure was introduced.

Automated mobile browser smoke tests ran at 390 × 844 with device-pixel ratio
3:

- Guest mode: pass
- Mock holder mode: pass
- Dialogue touch input: pass
- Quest activation: pass
- Battle action and turn transition: pass
- Local save assertions: pass
- Holder rarity derivation: Rare at 25 simulated Energy/hour
- Guest rarity derivation: Common at 10 simulated Energy/hour
- One simulated hour of passive emission while questing: pass
- High-detail player and Corrupted Scout battle sprites: pass
- Browser console errors: 0
- Smoke assertion failures: 0

## Known Limitations

- Final reusable layered pixel art remains an artist dependency; the six new
  collection-faithful pilots are explicitly labeled review placeholders.
- The production Privy host adapter is not wired.
- Progress is local and intentionally carries no financial or reward value.
- Core Emission time, rarity/rate resolution, and mining rewards are local and
  cannot become public progression until moved to an authoritative server.
- Multiplayer is represented by interfaces and a roadmap, not a server.
- The Phaser production bundle is approximately 1.30 MB minified
  (approximately 348 KB gzip) and should be route-split before a public
  deployment.
- The battle smoke test enters the battle scene through the development QA
  hook; the game-state test suite separately validates quest and battle
  transitions.
- The blockchain registry is a snapshot and must not replace runtime ownership
  checks.
- No audio or final music assets are included.

## Recommended Next Phase

1. Human-review the generated unminted role candidates and commit manual
   overrides.
2. Artist-review the six directional pilots and use the accepted anatomy,
   palette, and pixel density for a small reusable layer pack.
3. Validate composed directional sprites for a five-to-ten-Droid pilot.
4. Playtest the emission tier economy and Energy Seam Survey pacing without
   connecting the local bank to production Energy.
5. Add a reviewed Next.js host route and bridge that reuses the existing Privy
   session and `/api/s2/owned-tokens` verification.
6. Code-split Phaser from menus and preload only the active map.
7. Run a closed local-network playtest on iPhone Safari, desktop Safari, and
   Chrome.
8. Build the first authoritative Colyseus or Nakama room plus server-time
   emission-ledger spike without enabling rewards.

Only after those steps should a separate preview-deployment proposal be
reviewed.
