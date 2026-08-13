# Droid Lore and Role Classification

## Canonical status groups

At read-only Monad block 91,096,834, the classifier verified:

| Status | Count | Game interpretation |
| --- | ---: | --- |
| Surviving minted | 1,039 | Authentic player-controlled protagonists |
| Burned | 57 | Burned Echoes and Deflationary Energy remnants |
| Unminted metadata | 2,237 | Game-controlled world characters |
| Invalid/unavailable | 0 | Quarantined until metadata or chain evidence resolves |

Contract evidence also reports 1,096 total minted and a 3,333 max supply. These
numbers are generated evidence, not hard-coded lore assumptions.

## Surviving minted droids

Survivors are the only S2 tokens eligible for wallet-connected character
selection. Selection requires current ownership. Ownership is rechecked when a
holder selects a droid and when a wallet save resumes.

A transfer immediately removes eligibility from the former holder. A burn
permanently removes player eligibility.

Guest Mode uses a clearly labeled generic Training Unit and makes no NFT claim.

## Burned Echoes

Burned droids are not revived as owned assets. Their token history may inform:

- Memorial terminals
- Ghost signals
- Deflationary Energy fragments
- Lore archive entries
- Hidden encounter modifiers
- Boss mechanics
- Global world-event contributions

Any UI that shows a Burned Echo must state its burned status and must not show a
current owner or selectable player slot.

## Unminted units

Unminted metadata records are game-controlled characters, not NFTs for sale or
player-owned assets. Candidate roles include:

- NPC or quest character
- Roaming corrupted enemy
- Companion
- Mini-boss
- Dungeon or regional boss
- Faction leader
- Secret encounter
- Main-story antagonist

The candidate generator never mints, transfers, or implies ownership.

## Rarity scoring

When no authoritative rarity source was found in the repository, the pipeline
calculated a deterministic information score across all 3,333 metadata records:

```text
token score = sum(log2(3333 / count of each token trait value))
```

The score is:

- Explainable from `trait-frequency.json`
- Deterministic for a fixed metadata snapshot
- Collection-wide, including minted, burned, and unminted records
- A story and art review aid only
- Not a market-value claim

`visualDistinctiveness` separately weights values occurring in 1% or less of
records and nonempty Special traits. Compatibility conflicts are evaluated
before candidates are shortlisted.

## Role policy

Automated scoring proposes candidates; it does not assign narrative authority.

- Rarity alone never makes a character a boss.
- Only unminted records enter game-controlled role candidate lists.
- Story fit, silhouette readability, animation cost, and trait compatibility
  require human review.
- Visually distinctive common units are deliberately surfaced for recurring
  NPC roles.
- Manual overrides always take priority.

Edit:

```text
data/game/manual-role-overrides.json
```

Then regenerate:

```bash
npm run game:roles:generate
```

Each override may set `gameRole`, `region`, `recruitable`, and reviewer notes.
An override never changes blockchain status.

## Generated review artifacts

- `data/game/droid-registry.json`
- `data/game/droid-classification-report.json`
- `data/game/rarity-report.json`
- `data/game/unminted-role-candidates.json`
- `data/game/manual-role-overrides.json`

The public registry sets `owner` to `null` by design. Live owner discovery
should occur only when gameplay genuinely requires it.
