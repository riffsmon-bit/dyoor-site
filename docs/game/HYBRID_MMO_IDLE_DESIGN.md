# Hybrid MMO, Core Emission, and Energy Mining

## Product direction

The game is an exploration-first online RPG with a passive layer behind active
play. A player should not need to open an idle center, dispatch a timer, or stop
questing to remain productive.

The intended rhythm is:

```text
Select a verified Droid
  → its Core continuously emits Energy
  → explore, quest, mine, and battle while emission continues
  → earn field bonuses from active Energy work
  → spend the bank on future preparation, crafting, and world systems
```

Passive progress provides continuity. Quests, encounters, other players, and
world decisions remain the reason to play.

## Cartridge identity and field party

After selecting an owned Droid or the generic guest unit, the player creates a
local field identity:

- A sanitized 16-character callsign
- Vanguard protocol for additional prototype HP
- Prospector protocol for improved local mining yield
- Relay protocol for additional prototype Core capacity

Wallet mode can retain up to three droids returned by the verified ownership
adapter. One is active in the overworld and the others are reserves. Party
switching can only select a member already admitted to the session party.
Ownership is rechecked at resume boundaries before saved reserve droids remain
available.

This is not sufficient authorization for valuable play. A production server
must reconstruct the party from current ownership rather than trusting the
browser save.

## Passive Core Emission

Every playable Droid receives a transparent emission tier derived from the
existing collection-wide rarity score. The score is:

```text
sum(log2(3333 / records with each trait value))
```

It uses all 3,333 metadata records and is not a claim about market value.

Prototype tier thresholds are fixed collection percentiles:

| Tier | Minimum rarity score | Collection band | Simulated Energy/hour |
| --- | ---: | --- | ---: |
| Mythic | 40.469005 | Top 1% | 100 |
| Legendary | 35.803753 | 95th–99th percentile | 65 |
| Epic | 32.463521 | 85th–95th percentile | 40 |
| Rare | 29.729391 | 70th–85th percentile | 25 |
| Uncommon | 27.533511 | 50th–70th percentile | 15 |
| Common | Below 27.533511 | Bottom 50% | 10 |

The game re-derives score, tier, and rate from normalized metadata. It does not
trust a tier or hourly rate stored by the browser. A Trait Lab change therefore
updates both appearance and emission classification at the next controlled
synchronization.

These rates are prototype balance values. Before production they need economy,
fairness, retention, and holder-distribution review. Rarity should create
identity and pacing differences, not an unbeatable combat advantage.

## Background behavior

- Emission begins automatically when a character is selected.
- It continues during movement, dialogue, mining, quests, and battle.
- There is no terminal or dispatch requirement.
- Local development credits at most eight hours of time between
  synchronizations.
- The HUD shows tier, hourly rate, and local bank.
- Combat Core charge and the longer-term emitted Energy bank are separate.

Guest training units use the Common 10/hour simulation rate but cannot claim
blockchain or production rewards.

## Energy mining quests

Active Energy work complements passive emission. The first prototype survey
unlocks after Core Recovery:

1. Dr. Halogen unlocks the Energy Seam Survey.
2. The player accepts the survey.
3. Three cyan seam beacons appear across the Rustbelt.
4. Each unique node adds 10 local simulated Energy and one ore sample.
5. The third node marks the quest ready for turn-in.
6. Dr. Halogen refines the ore into one Energy Cell and awards a 100 local
   simulated Energy completion bonus.

Later regions can expand this into:

- Timed mining routes
- Group extraction events
- Corrupted drill encounters
- Defend-the-rig battles
- Blueprint-specific mining tools
- Burned Echo seam anomalies
- Regional supply objectives
- Party mining bonuses with contribution caps

Mining rewards must be server-resolved before they carry value.

## Prototype safety boundary

The browser prototype stores emission, quest progress, inventory, and mining
results in local storage. Browser time and storage are user-controlled, so the
current bank is explicitly a nonvaluable simulation:

- No production Energy is minted or transferred.
- No smart-contract or Netlify Blob write occurs.
- No leaderboard, marketplace, trade, or claim trusts this balance.
- No wallet signature authorizes a reward.
- Clock manipulation can still alter local simulation state.

The eight-hour cap limits accidental runaway values; it is not an anti-cheat
control.

## Authoritative production model

A public reward-bearing service should record:

```text
account_id
verified_character_token_id
metadata_hash
rarity_model_version
emission_tier
emission_rate_version
server_accrued_through
banked_energy
lifetime_energy
daily_and_seasonal_cap_state
ledger_entry_id
```

The server must:

- Authenticate through a short-lived ticket derived from the approved Privy
  session.
- Verify the selected token is surviving and currently owned.
- Calculate rarity from server-trusted current metadata.
- Use server time only.
- Pin rarity and emission rule versions for each ledger interval.
- Recheck ownership at meaningful boundaries and after transfers.
- Accrue idempotently.
- Apply daily, seasonal, and account-level caps.
- Resolve mining nodes and quest completion server-side.
- Reject replayed node IDs, claims, and client-supplied balances.
- Write results through an auditable transactional ledger.
- Enforce callsign uniqueness, moderation, and reserved-name rules.
- Reconstruct field parties from current ownership at trusted boundaries.

## MMO boundary

| System | Prototype authority | Public-game authority |
| --- | --- | --- |
| Movement | Local browser | Regional game server |
| Battle | Local browser | Battle instance server |
| Quest state | Local browser | Persistent game service |
| Core Emission | Local, nonvaluable simulation | Server-time reward ledger |
| Mining nodes | Local quest state | Authoritative regional encounter |
| Inventory | Local, nonvaluable | Transactional database ledger |
| S2 ownership | Dev mock or approved host port | Authenticated ownership service |
| Valuable Energy | Disabled | Separately reviewed reward service |
| World events | Roadmap only | Scheduled authoritative service |

## Progression guardrails

- Active play must add choices and bonuses that passive waiting cannot replace.
- Common Droids retain a meaningful 10/hour floor.
- Rarity affects emission cadence, not base movement or guaranteed battle wins.
- Offline credit is bounded.
- Mining rewards require actual quest participation.
- A returning player should feel welcomed rather than permanently behind.
- No client-only milestone can authorize a production reward.
- Economy values remain configuration, not hard-coded smart-contract promises.

## Next phase

1. Playtest the six rates and eight-hour cap against the verified surviving
   holder distribution.
2. Add one meaningful local Energy sink without enabling real rewards.
3. Add one repeatable mining route with varied spawn positions.
4. Build a minimal authoritative account and ledger spike.
5. Move server time, emission intervals, node collection, and quest turn-in to
   that spike.
6. Add multiplayer presence only after the local movement and battle slice
   remains stable.
