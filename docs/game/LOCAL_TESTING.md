# Local Game Testing

## Prerequisites

- Node.js 20.19 or newer
- npm
- The D.Y.O.O.R repository checked out on the game branch

The game has its own lockfile and dependencies. Installing the production site
does not implicitly install `apps/game`.

```bash
npm --prefix apps/game install
```

## Start the game

From the repository root:

```bash
npm run game:dev
```

Expected startup output includes:

```text
Local browser:  http://localhost:5173
Mobile / LAN:   http://<local-ip>:5173
Mock mode:      built in; no mock API process is required
```

Open `http://localhost:5173`.

No mock API process is required. Guest saves use browser local storage under
the versioned key `dyoor-game-save-v1`.

## Manual acceptance route

1. Select **Enter Guest Mode**.
2. Select the generic Training Unit and deploy.
3. Use E or ACT beside Dr. Halogen.
4. Advance both dialogue lines to start Core Recovery.
5. Exit the laboratory through the south door.
6. Explore the Rustbelt, collect the Energy Core, and encounter the Corrupted
   Scout.
7. Complete the turn-based battle.
8. Return the Core to Dr. Halogen.
9. Verify the Energy Seam Survey unlocks, accept it from Dr. Halogen, and mine
   all three cyan Rustbelt seam beacons.
10. Return to Dr. Halogen and verify the Energy Cell plus local simulated
    Energy bonus.
11. Confirm the HUD's Core Emission bank continued increasing during questing
    and battle.
12. Open the inventory and verify collected items.
13. Reload the page and verify **Continue Signal** restores the latest location.

## Automated checks

```bash
npm run game:lint
npm run game:typecheck
npm run game:test
npm run game:build
```

The focused test suite covers metadata normalization, classification, burned
token rejection, ownership selection, role overrides, layer ordering, sprite
layout, quest transitions, battle state, save parsing, guest mode, failed RPC
behavior, unsafe URLs, collision rules, and virtual mobile input.

## Holder UI mock

Use the mock only for local presentation testing:

```text
http://localhost:5173/?mock-wallet=1
```

The page labels mock mode and never treats it as real ownership. A real holder
session must come from the approved production host bridge.

## Read-only collection tools

The initial scan needs network access; subsequent runs can use the ignored
cache:

```bash
npm run game:metadata:scan
npm run game:metadata:scan -- --offline
npm run game:traits:catalog
npm run game:registry:classify -- --owner-concurrency 6
npm run game:roles:generate
```

These commands print a read-only banner. They do not expose a transaction,
metadata write, Blob write, or deploy code path.

## Common failures

- Port 5173 is busy: stop the other process. The dev server intentionally uses
  `--strictPort` instead of silently choosing a different URL.
- `tsx` reports an IPC permission error in a restricted shell: run the command
  from the normal local Terminal.
- Holder mode says the host bridge is unavailable: use Guest Mode, use the
  explicit dev mock, or launch through a future approved host adapter.
- A cached save is rejected: malformed and incompatible saves are intentionally
  discarded rather than trusted.
