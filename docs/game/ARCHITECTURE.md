# Game Architecture

## Boundary

The game is a separate Vite application in `apps/game`. The production Next.js
application remains at the repository root. Root `game:*` commands delegate with
`npm --prefix apps/game`; the repository was not converted into a monorepo.

```text
Existing Next.js site
  Privy + approved wallet flow
  server ownership APIs
  dynamic metadata API
          │ future approved host bridge
          ▼
apps/game
  Phaser scenes and UI
  local gameplay systems
  metadata/ownership ports
  LocalSessionTransport
          │ future authoritative protocol
          ▼
External game server (not built)
  rooms, persistence, combat, inventory, rewards
```

The prototype can run entirely in Guest Mode. It does not need a persistent
server and does not modify an existing production route.

## Runtime layers

### Scenes

- `BootScene`: creates runtime placeholder textures and animations.
- `TitleScene`: Guest, Holder, and resume entry.
- `CharacterSelectScene`: training droid or host-verified S2 selection.
- `LaboratoryScene`: central settlement, NPC, quest start/turn-in, exit.
- `IndustrialWastesScene`: exploration, Energy Core, hostile droid, return.
- `BattleScene`: deterministic local turn state, victory, defeat, rewards.
- `BaseWorldScene`: shared movement, camera, HUD, dialogue, inventory, save, and
  transition behavior.

### Entities and rendering

`Player` and `NonPlayerCharacter` wrap Phaser Arcade sprites.
`DroidSpriteFactory` maps normalized Season 2 metadata into tall, narrow
collection-faithful overworld and battle textures. Six reviewed pilot slots
cover four Season 2 appearances plus the guest trainer and Corrupted Scout;
all other records use the same Dr. Halogen-style deterministic runtime
composition until final reusable trait layers are authored. Trait changes
invalidate the relevant cache key and disable a stale pilot match.

Maps are compact string grids. `WorldMapBuilder` converts walls into static
collision bodies and batches floor/wall visuals into render textures. The
browser never loads all 3,333 NFT images.

### Pure gameplay systems

- `BattleEngine`: turn transitions and victory/defeat state.
- `QuestEngine`: valid Core Recovery progression.
- `Inventory`: bounded item quantities.
- `SaveSchema`: validates and bounds untrusted local storage.
- `CoreEmission`: transparent rarity scoring, tier selection, and capped
  nonvaluable background accrual.
- `VirtualInputState`: touch input independent of Phaser rendering.
- `isMapTileWalkable`: deterministic collision query for tests.

These modules are intentionally detached from Phaser where practical so a
future server can reuse or replace their rules.

### Services

- `GameSession`: local, nonvaluable session state.
- `SaveService`: versioned browser storage.
- `WalletService`: unavailable, host, or explicitly labeled development mock.
- `OwnershipSelection`: requires discovery plus a fresh ownership recheck.
- `MetadataService`: bounds and normalizes current metadata, derives a stable
  trait hash, and rejects unsafe image URLs.

### Input and UI

`UnifiedInput` merges keyboard and virtual controls. Fixed mobile hitboxes use
camera scroll factor zero, matching their HUD position while the world camera
follows the player. Dialogue is tappable and disables its hitbox while hidden.

## State ownership

Prototype state is client-owned and nonvaluable:

- Position
- Quest stage
- HP and local Energy
- Inventory
- Defeated prototype enemy IDs
- Selected display character
- A local passive-emission bank and Energy Seam Survey progress

The save parser treats local storage as untrusted. It clamps numeric values,
accepts only known map/mode/stage shapes, limits strings and arrays, and falls
back safely. Emission score, tier, and rate are re-derived from normalized
metadata rather than trusted from saved data, while stale offline credit is
capped at eight hours.

Before public multiplayer or rewards, the server must own:

- Position acceptance and speed checks
- Quest completion
- Battle actions and outcomes
- Inventory
- Trade state
- Reward eligibility
- Energy grants or claims
- Emission time, rate versions, mining results, claims, and daily/seasonal caps

## Wallet mode

The standalone game does not initialize Privy. A trusted host supplies:

```ts
window.dyoorGameHost = {
  connect,
  disconnect,
  getAddress,
  getOwnedS2Droids,
  verifyS2Ownership,
};
```

`getOwnedS2Droids` must use the existing authenticated session and server-backed
ownership discovery. Selection is rejected unless the token appears in the
verified list and `verifyS2Ownership(tokenId)` succeeds again. A burned or
transferred token therefore cannot be resumed as playable.

The production host adapter remains a documented integration step. The current
branch provides the game-side port and a dev-only mock, not a second wallet
stack.

## Metadata synchronization

Each selected character has:

- `metadataVersion`
- normalized traits
- stable `traitHash`
- sprite placeholder/final status

At a meaningful session boundary, the host should refetch the existing dynamic
metadata endpoint. A changed version or trait hash invalidates the composed
sprite cache. This preserves Trait Lab as the source of visual truth without
changing Trait Lab itself.

## Data pipeline

The Node scripts are read-only with respect to production:

1. Scan 3,333 canonical metadata records.
2. Normalize and catalog traits.
3. Read Monad transfer evidence and `ownerOf` state.
4. Separate surviving minted, burned, unminted, and unavailable records.
5. Calculate transparent collection-wide rarity information scores.
6. Generate role candidates for human review.
7. Validate and compose directional pixel layers.

Public registry output intentionally omits owner addresses. Runtime ownership
belongs behind an authenticated endpoint.

## Future multiplayer seam

`SessionTransport` defines `connect`, `disconnect`, `send`, and `subscribe`.
`LocalSessionTransport` loops events back locally and declares
`authoritative=false`. A Colyseus or Nakama adapter can replace this port after
message schemas, authentication, and authoritative server rules are designed.
The core prototype does not pretend that a local transport is multiplayer.

## Performance posture

- Small maps and generated tile render textures
- No 3,333-image browser preload
- Nearest-neighbor rendering
- Trait and chain caches in local tooling
- Incremental sprite composition by trait hash
- No persistent sockets in the first slice

The production bundle is approximately 1.30 MB minified / 348 KB gzip, dominated
by Phaser. Further scene/code splitting and an asset atlas pass are documented
as production readiness work.
