# Game Security Model

## Security objective

The prototype must be safe to run beside the production repository without
creating a reward, wallet, metadata, or administration path. Current gameplay
state has no financial value.

## Trust boundaries

Untrusted:

- Browser local storage
- Browser-supplied token IDs
- URL query parameters
- Remote metadata JSON and image URLs
- Public RPC responses before validation/retry
- Mock wallet data
- Future client movement, combat, quest, inventory, and chat events

Trusted only after server verification:

- Existing authenticated Privy session
- Existing server ownership lookup and fresh `ownerOf` evidence
- Approved metadata resolver
- Future authoritative game server state
- Explicit administrator policy outside the browser

## Wallet impersonation and ownership spoofing

- The standalone app does not accept an address query parameter.
- The dev mock exists only when `import.meta.env.DEV` and
  `?mock-wallet=1` are both present.
- Holder selection requires the token in host-provided verified discovery and a
  fresh `verifyS2Ownership` call.
- Saved reserve droids are rechecked at resume boundaries and removed when
  current ownership cannot be verified.
- In-session party switching is restricted to the already admitted party
  roster; it does not accept an arbitrary token ID.
- Token IDs are bounded to 1–3333.
- Burned or transferred tokens fail current ownership.
- A future valuable action must verify the authenticated wallet and ownership
  again on the server; browser state is never sufficient.

## Privy sessions

The game does not duplicate Privy credentials or initialize a second provider.
The host bridge should remain same-origin or use a narrowly scoped authenticated
message protocol. Never pass Privy access tokens through query strings, local
storage, public postMessage payloads, or static game files.

## Secrets and privileged routes

No game source contains:

- Private keys
- RPC credential values
- Blob credentials
- Admin tokens
- Operator secrets

Classification scripts load existing RPC environment configuration locally and
report only the RPC hostname. Generated files exclude secrets and owner
addresses. No new admin or write route was added.

## Metadata and image safety

- Metadata responses are capped at 512 KB.
- Token IDs and object shapes are validated.
- Trait counts and string lengths are bounded.
- Duplicate and missing categories are reported.
- Runtime assets allow HTTPS, constrained `ipfs://`, and localhost HTTP only.
- Script path resolution is constrained to approved repository/cache roots.
- Metadata strings are rendered through Phaser text objects, not HTML.

Before production, proxy remote images through a controlled resolver or publish
approved sprite assets; do not load arbitrary metadata hosts directly into a
privileged origin.

## JSON, XSS, and prototype pollution

Input is copied into explicit objects rather than merged into application
prototypes. Role overrides use known fields. Metadata is not inserted with
`innerHTML`. Callsigns are normalized to a bounded uppercase alphanumeric and
hyphen format before entering save state or Phaser text. Future network
payloads require schema validation and must reject `__proto__`, `constructor`,
and unexpected keys.

## Local storage

`SaveSchema` treats local storage as corruptible. It:

- Requires save version 1
- Accepts only known modes, maps, directions, and quest stages
- Bounds HP, Energy, positions, quantities, strings, and arrays
- Re-derives Core Emission score, tier, and hourly rate from normalized
  metadata and caps stale offline credit at eight hours
- Accepts only known mining stages and bounded unique node identifiers
- Reconstructs a maximum three-member party around the active normalized Droid
- Replaces token-bearing characters and parties in tampered Guest saves with
  the generic training unit
- Drops malformed values

Local progress must never authorize rewards, inventory trades, NFT state, or
leaderboard results.

The passive Core Emission bank and Energy Seam Survey rewards are intentionally
local and nonvaluable. Browser time, saved metadata, mining-node completion,
balances, and claims are all untrusted. A public system must use server
timestamps, server-trusted current metadata, versioned rarity/rate rules,
authenticated accounts, idempotency keys, authoritative quest events, and a
transactional result ledger.

## Replay and reward attacks

There is no production reward endpoint in the prototype. Before rewards exist:

- Use server-issued, single-use action IDs
- Bind claims to authenticated wallet, season, event, and expiry
- Store used nonces
- Recompute eligibility server-side
- Rate-limit by session, wallet, and IP
- Make reward writes idempotent
- Audit operator permissions

## Client-authoritative systems

Current combat, movement, inventory, quest progress, simulated Energy, passive
emission, and mining are local for playability. They are explicitly
non-authoritative. Public multiplayer must move these transitions to the
server. Client prediction may improve feel but cannot be the source of truth.

## RPC and denial of service

Read-only tooling uses:

- Adaptive/paginated transfer queries
- Bounded concurrency
- Timeouts
- Retries and slow final owner retries
- Ignored caches
- Contract count cross-checks

Public APIs need authentication where appropriate, response caching, per-route
rate limits, global concurrency caps, and upstream circuit breakers.

## Future WebSocket security

- Authenticate the connection using a short-lived server ticket, not a wallet
  address string.
- Authorize room joins and character selection server-side.
- Enforce message schemas and size limits.
- Apply message rate limits and backpressure.
- Rotate tickets on reconnect.
- Reject duplicate sessions according to explicit policy.
- Log moderation and trade events without logging secrets.

## Dependencies

The game runtime and full development dependency audits report zero known
vulnerabilities after updating the affected lint, RPC, WebSocket, and image
tooling. Continue auditing in CI. Do not use forceful audit upgrades that
silently cross major versions.

## Incident posture

If ownership, metadata, or reward verification is unavailable, fail closed for
holder-only or valuable actions while keeping Guest Mode available. Never fall
back from a failed server ownership check to a browser claim.
