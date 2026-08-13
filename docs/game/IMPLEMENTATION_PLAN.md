# D.Y.O.O.R RPG Prototype File Plan

This is the exact intended change boundary after repository discovery. Paths may
be split into smaller modules when a file becomes difficult to test, but no
production feature surface is included.

## Root files modified

- `package.json`
  - Add `game:dev`, `game:build`, `game:test`, `game:typecheck`, `game:lint`,
    metadata, registry, role, and sprite commands.
- `tsconfig.json`
  - Exclude `apps/game` from the root Next.js compiler.
- `.gitignore`
  - Ignore game caches, private ownership evidence, coverage, and generated
    bulk sprite output.

No root dependencies or npm workspace configuration will be added.

## Isolated package

- `apps/game/package.json`
- `apps/game/package-lock.json`
- `apps/game/index.html`
- `apps/game/vite.config.ts`
- `apps/game/tsconfig.json`
- `apps/game/tsconfig.node.json`
- `apps/game/eslint.config.js`
- `apps/game/README.md`

## Game source

- `apps/game/src/main.ts`
- `apps/game/src/style.css`
- `apps/game/src/config/gameConfig.ts`
- `apps/game/src/config/runtimeConfig.ts`
- `apps/game/src/types/**`
- `apps/game/src/data/**`
- `apps/game/src/scenes/BootScene.ts`
- `apps/game/src/scenes/TitleScene.ts`
- `apps/game/src/scenes/CharacterSelectScene.ts`
- `apps/game/src/scenes/LaboratoryScene.ts`
- `apps/game/src/scenes/IndustrialWastesScene.ts`
- `apps/game/src/scenes/BattleScene.ts`
- `apps/game/src/entities/**`
- `apps/game/src/systems/battle/**`
- `apps/game/src/systems/quest/**`
- `apps/game/src/systems/inventory/**`
- `apps/game/src/systems/save/**`
- `apps/game/src/services/**`
- `apps/game/src/input/**`
- `apps/game/src/ui/**`
- `apps/game/src/multiplayer/**`

The implementation will keep deterministic state machines independent from
Phaser so they can be tested and later moved behind an authoritative server.

## Assets

- `apps/game/public/assets/manifest.json`
- `apps/game/public/assets/sprites/placeholders/**`
- `apps/game/public/assets/tiles/placeholders/**`
- `apps/game/public/assets/maps/**`
- `apps/game/public/assets/ui/**`

Every temporary asset will be marked `placeholder: true`. Generated production
sprites will use a different ignored directory.

## Metadata, chain, rarity, and sprite tooling

- `apps/game/scripts/lib/**`
- `apps/game/scripts/metadata-scan.ts`
- `apps/game/scripts/traits-catalog.ts`
- `apps/game/scripts/classify-droids.ts`
- `apps/game/scripts/rarity-and-roles.ts`
- `apps/game/scripts/sprites-validate.ts`
- `apps/game/scripts/sprites-generate.ts`
- `apps/game/scripts/sprites-generate-all.ts`
- `apps/game/scripts/dev.ts`

The tooling will default to read-only behavior, use resumable local caches, and
will not contain transaction or Blob-write capabilities.

## Tests

- `apps/game/tests/metadata-normalization.test.ts`
- `apps/game/tests/token-classification.test.ts`
- `apps/game/tests/ownership-selection.test.ts`
- `apps/game/tests/trait-manifest.test.ts`
- `apps/game/tests/sprite-validation.test.ts`
- `apps/game/tests/role-assignment.test.ts`
- `apps/game/tests/quest.test.ts`
- `apps/game/tests/battle.test.ts`
- `apps/game/tests/save-and-guest.test.ts`
- `apps/game/tests/input.test.ts`
- `apps/game/tests/security-validation.test.ts`

## Generated public game data

- `data/game/droid-registry.json`
- `data/game/metadata-scan-report.json`
- `data/game/trait-manifest.json`
- `data/game/trait-frequency.json`
- `data/game/unminted-role-candidates.json`
- `data/game/manual-role-overrides.json`
- `data/game/sprite-validation-report.json`
- `data/game/artist-task-list.json`

Committed data must be deterministic and must not include owner addresses.

## Documentation

- `docs/game/REPOSITORY_DISCOVERY.md`
- `docs/game/IMPLEMENTATION_PLAN.md`
- `docs/game/ARCHITECTURE.md`
- `docs/game/DROID_SPRITE_SPEC.md`
- `docs/game/DROID_LORE_AND_ROLES.md`
- `docs/game/SECURITY_MODEL.md`
- `docs/game/PRODUCTION_READINESS_GAPS.md`
- `docs/game/LOCAL_TESTING.md`
- `docs/game/MOBILE_TESTING.md`
- `docs/game/ASSET_PIPELINE.md`
- `docs/game/MULTIPLAYER_ROADMAP.md`
- `docs/game/DEPLOYMENT_ROADMAP.md`
- `docs/game/FINAL_IMPLEMENTATION_REPORT.md`

## Explicit nonchanges

- No Solidity edits
- No deployment script edits
- No chain writes
- No Netlify configuration or deployment
- No metadata API or Trait Lab mutation
- No live Blob writes
- No production navigation or homepage changes
- No push or pull request
