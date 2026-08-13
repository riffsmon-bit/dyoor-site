# Production Readiness Gaps

The branch is a playable local vertical slice, not a production multiplayer
release.

## Blocking before public holder mode

- Build the approved production host adapter around the existing Privy flow.
- Serve or embed the game under a defined origin and test cookies/CORS/CSP.
- Have the host call existing server-side owned-token discovery.
- Return current dynamic metadata, metadata version, and trait hash.
- Recheck ownership at selection, resume, and other meaningful boundaries.
- Add integration tests for no-token, transfer, and burned-token sessions.
- Complete a mobile Safari/Chrome wallet regression pass.

The current mock cannot satisfy any production ownership requirement.

## Blocking before final visual release

- Author and review 249 directional trait layer sheets.
- Resolve asymmetry and compatibility rules.
- Build approved tiles, environment props, NPCs, battle effects, and UI atlas.
- Add audio with original/licensed sources.
- Conduct accessibility review for contrast, text size, motion, input, and
  captions.
- Publish generated sprites through a versioned, cacheable asset resolver.

The current droids, maps, and Energy Core are labeled placeholders.

## Blocking before multiplayer

- Choose Colyseus or Nakama through a small technical spike.
- Define versioned network schemas.
- Implement authenticated authoritative rooms.
- Move movement, combat, quests, inventory, and rewards to server state.
- Move Core Emission clocks, rarity/rate resolution, mining nodes, and claims
  to server state.
- Add PostgreSQL persistence and Redis presence/coordination.
- Add reconnection, moderation, observability, backups, and abuse controls.
- Deploy outside Netlify Functions for persistent sockets.

## Blocking before rewards or trade

- Threat-model every reward source.
- Create idempotent server-side ledgers and nonces.
- Add eligibility, daily caps, replay protection, and operator audit logs.
- Recalculate current metadata rarity and verify ownership at every meaningful
  emission interval or claim boundary.
- Resolve mining-node IDs and quest completion server-side.
- Define trade custody policy; prefer noncustodial atomic contracts.
- Obtain a separate smart-contract audit before any escrow or value transfer.
- Never reuse prototype local HP/Energy/inventory state.

## Performance work

- Split or lazy-load scenes where useful.
- Evaluate Phaser-specific chunking and CDN caching.
- Build compressed texture atlases.
- Add runtime frame-time and memory budgets on representative iPhones.
- Add object pooling when effects/projectiles justify it.
- Keep full-resolution NFT art out of the gameplay preload.

Current production output is approximately 1.30 MB minified JavaScript / 348 KB
gzip and triggers the Vite large-chunk warning.

## Testing work

- Physical iPhone Safari and Chrome pass
- Desktop Safari pass
- Automated browser route through full quest/map transition/victory/defeat
- Rotation and safe-area checks across multiple phone sizes
- Long-session save and memory test
- Host bridge integration tests
- RPC outage and partial metadata outage drills
- Multiplayer soak, latency, packet loss, reconnect, and load tests
- Independent security review before public rewards

## Operational work

- Decide game origin and release channel.
- Create separate preview and production environment policies.
- Add error reporting with privacy-safe payloads.
- Add server metrics, alerts, rollback, and incident runbooks.
- Pin/verify asset manifests.
- Define migration policy for save and protocol versions.

## Explicit nonclaims

This prototype does not currently provide:

- Production Privy-connected play
- Public multiplayer
- Server-authoritative progression
- Production Energy rewards
- Authoritative or valuable offline progression
- NFT trading
- Final pixel art
- A deployed game build
