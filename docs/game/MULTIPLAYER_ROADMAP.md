# Authoritative Multiplayer Roadmap

The first playable uses `LocalSessionTransport` and has no persistent server.
Do not grow it into a peer-to-peer or client-authoritative MMO.

## Target architecture

Use a persistent game service such as Colyseus or Nakama after a focused
prototype comparison.

```text
Browser / Phaser
  input + prediction + presentation
          │ short-lived authenticated ticket
          ▼
Regional authoritative game service
  room simulation + validation + moderation
          │
          ├── PostgreSQL: durable player, quest, inventory, audit state
          ├── Redis: presence, room directory, short-lived coordination
          └── Existing D.Y.O.O.R backend: wallet/ownership verification
```

Netlify can continue serving the website and static assets. Persistent game
sockets and simulation belong on infrastructure designed for long-lived
connections.

## Stage 1: protocol and room spike

- Choose Colyseus or Nakama using measured deployment, TypeScript, operations,
  reconnection, and room tooling criteria.
- Define versioned schemas for input intent, snapshots, interactions, and errors.
- Authenticate with a one-time server ticket derived from the approved Privy
  session.
- Implement one laboratory room with authoritative movement.
- Client sends direction/input sequence, never position as truth.
- Server enforces speed, collision, map bounds, and rate limits.
- Add interpolation and reconciliation.

Exit criteria: two clients can join, move, disconnect, and reconnect without
teleport or duplicate-session exploits.

## Stage 2: regions and presence

- Treat each map/region as a bounded room.
- Add a room directory and capacity policy.
- Transfer players with signed handoff data.
- Store durable location only at controlled checkpoints.
- Add online presence, status, and privacy controls.
- Add shard strategy before maps exceed room simulation budgets.

## Stage 3: chat and moderation

- Separate chat messages from movement traffic.
- Authenticate every message and enforce channel authorization.
- Bound text length, attachments, and message rate.
- Add block, mute, report, moderator actions, and audit logs.
- Sanitize links and media.
- Do not expose wallet addresses by default.

## Stage 4: parties and instanced battles

- Server owns party membership and invitations.
- Create battle instances with a deterministic action log.
- Server validates turn order, abilities, cooldowns, HP, Energy, victory, and
  loot.
- Clients render predictions only after authoritative acknowledgement.
- Persist outcomes idempotently.

## Stage 5: quests, inventory, and persistence

- Model quest transitions as allowed server events.
- Store inventory mutations in database transactions.
- Use immutable audit entries for valuable items.
- Add schema migrations, backups, restores, and reconciliation jobs.
- Treat browser saves as import-ineligible local prototypes.

## Stage 5A: authoritative Core Emission and mining

- Accrue from server-issued timestamps; never use a browser clock or local save.
- Pin each interval to versioned rarity and emission-rate definitions.
- Derive rarity from server-trusted current metadata.
- Verify the authenticated account and currently owned surviving Droid.
- Recheck transfers, burns, disconnects, and ownership loss at defined
  boundaries.
- Enforce offline, daily, seasonal, and account caps server-side.
- Resolve mining-node activation, uniqueness, completion, and quest rewards on
  an authoritative region or quest service.
- Accrue and claim through idempotent database transactions.
- Write valuable results through an auditable Energy ledger.

The prototype Core Emission bank and mining bonuses are local pacing systems.
They cannot enter a public inventory, leaderboard, trade, or production Energy
balance.

## Stage 6: world events and bosses

- Schedule events server-side.
- Aggregate contributions with idempotency keys.
- Keep boss health and phase transitions authoritative.
- Snapshot and recover active events.
- Define participation and reward rules before launch.

## Trading restrictions

- Do not create an ownerless bot wallet that takes custody.
- Prefer audited atomic, noncustodial exchange contracts.
- Verify current ownership, approvals, chain, collection, and token status.
- Display explicit asset/price/fee summaries.
- Require fresh user signatures.
- Expire offers and prevent replay.
- Keep in-game inventory trade separate from NFT trade unless both ledgers can
  settle atomically and safely.

## Anti-cheat

- Validate speed, collision, action frequency, cooldowns, resource costs, and
  state transitions.
- Use monotonically increasing input sequences.
- Rate-limit connection, room join, chat, trade, and reward paths separately.
- Detect impossible quest/combat timing.
- Record evidence for review without collecting unnecessary personal data.
- Avoid security through obscurity; browser code is observable.

## Operations

- Structured logs with session IDs, never secrets
- Metrics for tick time, room count, reconnects, message rejection, and database
  latency
- Distributed tracing for ownership/reward calls
- Graceful draining during deployments
- Version negotiation and minimum client version
- Load, soak, latency, packet loss, and failover tests

## Server-side rewards

Rewards are a separate final phase. The server must verify:

- Authenticated wallet
- Current eligibility and ownership
- Authoritative gameplay event
- Daily/event cap
- Unused nonce
- Correct chain and contract configuration

Reward writes must be idempotent and observable. A client-reported battle,
message, trade, or quest completion is never enough.
