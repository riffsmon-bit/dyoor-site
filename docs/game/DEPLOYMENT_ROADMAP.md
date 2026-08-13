# Game Deployment Roadmap

No deployment was performed for this prototype.

## Local artifact

Build with:

```bash
npm run game:build
```

The static artifact is:

```text
apps/game/dist/
```

Vite uses a relative base so the prototype can be evaluated under a subpath,
but the production origin and routing decision must be made before deployment.

## Preview gate

Before creating a hosted preview:

1. Run root lint, type-check, tests, and build.
2. Run all game checks.
3. Confirm no secrets or ignored cache files enter the artifact.
4. Review the asset manifest and placeholder labels.
5. Decide whether preview holder mode is disabled or connected through an
   approved host bridge.
6. Configure CSP, frame policy, CORS, and allowed origins explicitly.
7. Test the exact preview origin on desktop Safari/Chrome and iPhone
   Safari/Chrome.
8. Record bundle sizes and browser errors.
9. Obtain explicit deployment approval.

## Origin choices

### Production-site subpath

Advantages:

- Same product origin
- Easier host bridge and session policy
- Consistent navigation

Risks:

- Must integrate Vite output safely with Next routing
- Build and cache policy become coupled
- A game regression can affect the main release

### Separate static game origin

Advantages:

- Independent releases and rollback
- Stronger isolation
- Simpler static hosting

Risks:

- Requires an authenticated cross-origin bridge
- CORS, CSP, cookies, and wallet redirects require exact-origin testing
- Must prevent spoofed postMessage peers

Do not pick an origin by convenience alone. Prototype both authentication paths
before public holder mode.

## Configuration

Browser-exposed configuration:

- `VITE_DYOOR_SITE_ORIGIN`: approved site origin; not a secret

Read-only local tooling may use existing Monad RPC environment variables. Never
copy private RPC URLs, operator secrets, Blob tokens, or admin values into Vite
variables; all `VITE_*` values are public in the browser bundle.

## Static asset release

- Publish immutable, content-hashed sprite sheets.
- Pin a reviewed asset manifest.
- Set long cache lifetimes on hashed files.
- Keep metadata/manifest resolvers short-lived or revalidated.
- Do not ship the 3,333 metadata cache.
- Do not ship private owner maps.
- Maintain a previous manifest for rollback.

## Host bridge release

The host adapter must:

- Reuse the existing Privy provider.
- Produce a short-lived authenticated session.
- Call server-backed S2 ownership discovery.
- Return current metadata and trait hashes.
- Recheck ownership for selection/resume.
- Fail closed for holder mode while leaving Guest Mode usable.
- Restrict calls to the exact approved game origin.

## Future multiplayer deployment

Persistent multiplayer runs outside Netlify Functions:

- Container or managed authoritative game service
- PostgreSQL with backups and migrations
- Redis for presence/coordination
- Regional TLS endpoints
- Load balancer with WebSocket support
- Graceful room draining
- Metrics, alerts, tracing, and incident runbooks

The static client can still be delivered by CDN/Netlify.

## Release stages

1. Local guest vertical slice
2. Internal static preview, Guest Mode only
3. Authenticated preview host bridge
4. Small holder alpha with no valuable rewards
5. Authoritative multiplayer technical alpha
6. Persistence and moderation beta
7. Separately audited reward/trade release

Every stage needs a rollback artifact and explicit approval. Do not push this
branch to main or deploy automatically.
