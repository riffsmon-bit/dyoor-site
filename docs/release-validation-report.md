# HoodYØØR release validation report

Source commit: `d272a55e78219e993015a2df31facc0f153af827`

Release result: **PASS_AUDIT_REQUIRED**

This report records only tests actually executed against the frozen candidate. It is not an independent audit or deployment authorization.

## Completed release evidence

| Check | Result |
| --- | --- |
| Build A vs Build B | PASS, eight full/canonical artifacts identical |
| Third clean-room build | PASS, all eight candidates identical to A/B |
| Secret-isolation unit suite | PASS, 4/4 |
| Monad read-only preflight | PASS at block 95,611,307; keyless/no broadcast |
| Robinhood read-only preflight | PASS at block 35,330,473; keyless/no broadcast; supply zero |
| Robinhood economic gas/security suite | PASS, 21/21 |
| Historical launch/source/security regression | PASS, 21/21; both whole-artifact freezes exact |

## Full matrix

| Suite | Result |
| --- | --- |
| Root Hardhat/Node | PASS, 207/207 |
| Foundry aggregate | PASS, 94 passed, 0 failed, 2 fork-only skips |
| Account security | PASS, 21/21 |
| Economic/pre-mint | PASS 21/21 |
| Monad live fork | PASS, 1/1 against public Monad mainnet RPC |
| Robinhood live fork | PASS, 1/1 against public Robinhood Chain RPC |
| Root TypeScript | PASS |
| Root ESLint | PASS |
| Root production build | PASS; 26/26 static pages generated, dynamic routes compiled |
| Game test/typecheck/lint/build | PASS, 45/45 tests; build emitted a non-blocking large-chunk warning |
| Discord test/typecheck/lint/build | PASS, 50/50 tests |
| Artifact freeze verifier | `PASS_AUDIT_REQUIRED` |
| Deployment authorization verifier | `PASS_AUDIT_REQUIRED` |

The aggregate Foundry run skipped the two tests that require fork URLs; each was then run explicitly against its public mainnet RPC and passed. The first sandboxed Monad fork attempt hit Foundry's macOS system-proxy panic before an RPC request; rerunning the same keyless command outside that OS sandbox passed. The first Next build likewise encountered a sandbox-only denial of Turbopack's localhost worker port; the same keyless release command outside that restriction compiled and generated all routes successfully.

Every release wrapper invocation reported `SECRET_ACCESS_SENTINEL=PASS`. No signing variable, private environment file, signature, transaction, or broadcast capability was used.

Independent audit status remains `NOT STARTED` regardless of internal test results.
