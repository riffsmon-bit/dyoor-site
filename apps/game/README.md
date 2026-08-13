# D.Y.O.O.R: Echoes of the Core

`apps/game` is an isolated, local-first Phaser 3 and TypeScript prototype for a
top-down D.Y.O.O.R RPG. It does not replace or bundle the production Next.js
site.

## Play locally

Install the isolated package once:

```bash
npm --prefix apps/game install
```

Then, from the repository root:

```bash
npm run game:dev
```

Open `http://localhost:5173`. The command also prints a host-accessible URL for
an iPhone on the same Wi-Fi.

Controls:

- Move: arrow keys or WASD
- Interact/advance dialogue: E, Space, Enter, mobile ACT, or tap the dialogue box
- Inventory: I or mobile BAG
- Field party: P or mobile TEAM
- Battle: click or tap Alloy Strike, Core Pulse, Deflect, or Overclock

## Included vertical slice

- Guest and optional holder entry
- Character selection followed by callsign and field-protocol setup
- Persistent three-droid field party with in-world active-droid switching
- Core Laboratory and Rustbelt Expanse maps
- Four-direction movement and animation
- Collision, camera follow, and map transitions
- Dr. Halogen dialogue and Core Recovery quest
- Energy Core collectible
- Corrupted Scout turn-based battle with separate combat sprites and poses
- HP, Energy, inventory, victory, defeat, and local save/resume
- Automatic rarity-tiered Core Emission while the player explores and battles
- Dr. Halogen's three-node Energy Seam Survey mining quest
- Responsive desktop layout and fixed mobile touch controls

The current local field protocols are:

- Vanguard: +15 maximum HP
- Prospector: 15 simulated Energy per mining node instead of 10
- Relay: +15 maximum Core Energy

Protocol choices and party state are local prototype progression. They do not
change NFT metadata, rarity, ownership, or production Energy.

Six AI-assisted directional art pilots now share the Dr. Halogen-style Droid
anatomy: four metadata-matched Season 2 characters, the guest Training Droid,
and the Corrupted Scout. They remain explicitly labeled pilot placeholders
pending artist review. NFT images are not resized and passed off as finished
game sprites.

The active Droid's full normalized metadata also feeds a deterministic
collection-wide fallback compositor and a separate 128px battle-pose
compositor. This keeps all 3,333 records recognizable and testable while the
249 final reusable trait layers are still being authored.

## Hybrid active and idle play

Core Emission starts automatically when a character is selected and continues
behind movement, dialogue, mining, quests, and battle. The rate is derived from
the current normalized metadata and the transparent collection-wide rarity
model:

- Mythic: 100 simulated Energy/hour
- Legendary: 65/hour
- Epic: 40/hour
- Rare: 25/hour
- Uncommon: 15/hour
- Common: 10/hour

After Core Recovery, Dr. Halogen unlocks the Energy Seam Survey. The player can
mine three unique Rustbelt seams for small field bonuses and return to the lab
for a completion bonus and refined Energy Cell.

The emitted bank and mining rewards exist only in the browser simulation. They
cannot be traded, cannot enter a leaderboard, and do not authorize any claim.
See
`docs/game/HYBRID_MMO_IDLE_DESIGN.md` for the future authoritative design.

## Wallet boundary

Guest mode works without a wallet. Holder mode consumes an approved
`window.dyoorGameHost` bridge supplied by the production host. The standalone
Vite app does not initialize a second Privy client. Local UI testing can enable
the explicitly labeled mock with:

```text
http://localhost:5173/?mock-wallet=1
```

The mock is development-only and makes no ownership claim. A production host
adapter is intentionally not enabled in this prototype branch.

## Checks

```bash
npm run game:lint
npm run game:typecheck
npm run game:test
npm run game:build
```

Read-only data and art pipeline commands:

```bash
npm run game:metadata:scan
npm run game:traits:catalog
npm run game:registry:classify
npm run game:roles:generate
npm run game:sprites:style-report -- --offline
npm run game:sprites:generate -- --token-id 1100
npm run game:sprites:validate
```

## Safety boundary

The prototype cannot deploy contracts, send transactions, write live metadata,
write Netlify Blobs, or award production Energy. Local saves, mock wallet data,
combat, inventory, quest progress, Core Emission, and mining rewards are
nonvaluable client state. See
`docs/game/SECURITY_MODEL.md` and
`docs/game/PRODUCTION_READINESS_GAPS.md` before integrating rewards or public
multiplayer.
