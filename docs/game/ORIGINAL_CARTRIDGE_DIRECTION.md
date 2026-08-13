# Original D.Y.O.O.R Cartridge Direction

## Decision

The browser game will evoke the immediacy of a handheld monster-collecting RPG
without using a commercial ROM, decompiled game code, copyrighted maps,
characters, interfaces, sounds, or extracted assets.

The existing Phaser and TypeScript application remains the game client. This
keeps the systems D.Y.O.O.R needs—wallet authentication, live metadata,
responsive browser controls, dynamic sprites, and a future authoritative
multiplayer service—inside a platform we control.

## Experience pillars

1. Compact tile-based laboratories, settlements, industrial routes, and
   corrupted machine zones.
2. Metadata-faithful Droids with separate overworld and battle presentation.
3. A field party led by one active holder-owned Droid.
4. Turn-based Core combat using original routines, stats, balance, and UI.
5. Passive Core Emission behind active exploration, quests, mining, and battle.
6. Shared regions, presence, parties, and PvP after the authoritative service
   exists.

## Implemented in the current slice

- Holder or guest droid selection
- Callsign initialization
- Vanguard, Prospector, and Relay field protocols
- Up to three local party members from the verified session roster
- Active party switching during exploration
- Protocol-aware HP, Core capacity, and mining yield
- Existing rarity-tiered passive Core Emission
- Existing Energy Seam Survey and turn-based corrupted-droid encounter

All progress in this slice remains local and nonvaluable.

## PvP boundary

PvP must not reuse the local `BattleEngine` as an authority. The browser may
render animations and submit a selected action, but a future match service must
own:

- Verified participants and current playable-token ownership
- Match seed, turn order, legal routines, cooldowns, and Energy costs
- Health, status effects, disconnects, forfeits, and timeouts
- Signed or server-recorded results
- Replay protection, rate limiting, and match history
- Any progression, Energy, item, or ranking reward

Until that service exists, battles are explicitly local field simulations.

## Art and interface guardrails

- Every map, tile, sprite, effect, icon, sound, name, and line of dialogue must
  be original or carry a compatible documented license.
- Droids follow `DROID_SPRITE_SPEC.md` and the Dr. Halogen-style anatomy.
- General genre conventions may inform usability, but screens must retain an
  unmistakable D.Y.O.O.R visual hierarchy and terminology.
- Production assets never overwrite or become confused with labeled pilot
  placeholders.

## Recommended next slice

1. Add a laboratory party terminal with explicit ownership-refresh status.
2. Add two original enemy archetypes and trait-informed combat affinities.
3. Add one repeatable, server-shaped mining route without real rewards.
4. Create an authoritative PvP protocol and deterministic match simulator.
5. Build presence-only multiplayer before synchronized world interaction.
