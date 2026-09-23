# Droid OS — security model

Status: proposed controls and observed limitations; no new authority activated. See [audit](00-current-state-audit.md).

## Non-negotiable boundaries

1. AI never receives keys, seeds or unrestricted signing authority.
2. AI cannot choose arbitrary executable target + calldata + value.
3. Financial input must validate against a closed, versioned runtime schema.
4. Deterministic policy, explicit capability, approved adapter and deterministic risk checks all must pass.
5. Simulation is required for enabled financial capabilities. Unsupported/unknown evidence denies that capability until explicitly designed and reviewed; no silent fallback.
6. Protected reserve and global/per-capability spending/action limits hold across concurrent and pending actions.
7. Canonical current on-chain owner determines authority; indexers and sessions are not final authorization.
8. Transfer must invalidate former-owner execution, policy mutation, withdrawal and delegated authority; unresolved transfer cases block delegation.
9. External content, including metadata/API results, is untrusted data and cannot change policy or capabilities.
10. Every preparation, rejection, authorization and execution must be reconstructible from durable records.

These consolidate the specification's 15 invariants without weakening any. Unknown owner, policy, adapter, risk result, simulation or authorization means **NO EXECUTION**. ASK is default. A service outage cannot turn ASSIST into AUTONOMOUS.

## Threat and control matrix

| Threat | Required control | Present limitation |
| --- | --- | --- |
| Stale owner/session/indexer | Fresh chain/account checks; contract final check; resource-scoped signed challenge | World holder session alone is insufficient for a specific Droid |
| NFT transferred A→B→A | Grants tied to a provable ownership epoch, not address equality | Current account counter is not a transfer nonce; delegation blocked |
| Old external spender persists after transfer | Explicit approval inventory/warnings; future enforceable lifecycle design | V1 cannot revoke external token allowances merely on parent transfer |
| Parent NFT burn/cycle | Fail closed, show custody consequences, preserve Trait Lab burn guard | Direct collection calls can bypass UI; assets can become inaccessible |
| Prompt injection | Sandboxed fetch, typed untrusted evidence, closed tools, no signing keys | No existing intelligence boundary yet |
| Malformed/provider-invented output | Strict schemas, bounded fields, independent evidence and domain validation | Provider structured output alone cannot establish truth |
| Malicious quote/calldata | Capability-specific builder plus independent decoder/validator | Legacy upstream quote normalization is not an approved execution adapter |
| Proxy upgrade/config change | Pin/verify implementation and relevant configuration; stale evidence invalidation | Kuru downstream proxy implementation/admin not fully inspected |
| Concurrent budget overspend | Serializable reservations and idempotency; pending gas/value count | Netlify Blob read-modify-write is not sufficient |
| Replay/substitution | Domain/chain/account/action hash, nonce, expiry, policy versions | Chat/session tokens must not double as action authorization |
| Unknown receipt/reorg | Reconcile canonical receipts/block hashes; keep uncertain reservations | An RPC timeout is not proof the transaction did not execute |
| Cross-owner privacy leak | Owner-era access and explicit handover rules | NFT ownership does not imply access to former owner's private chats |
| Research SSRF/resource exhaustion | URL/IP restrictions, redirects revalidated, bounded size/time, queue quotas | Public index dispatch and broad credential environments need isolation |

## Current owner and transfer protocol

Resolve the exact chain, collection, token and canonical account. Check chain ID, registry wiring, implementation identity and account binding. Read current `ownerOf` for every security-sensitive request; do not authorize from roster results. ERC-1271 contract owners require their actual contract validation semantics, not an EOA-only recovery assumption.

Session login establishes an identity, not enduring control over a Droid. Policy/preference mutation requires current owner authorization scoped to the precise resource. Financial authorization binds a typed action, chain, account, policy/grant revision, nonce and expiry. Recheck before acceptance and submission; the on-chain execution boundary must independently enforce authority. A preflight check cannot eliminate a transfer racing a later transaction.

On a detected transfer: revoke off-chain sessions scoped to that Droid, suspend missions/actions, invalidate reservations as appropriate after reconciliation, archive owner-era policy, require new-owner confirmation for preferences, and retain public Droid history. Detection accelerates cleanup but is not the authority source. Old grants cannot remain valid merely because the watcher missed a transfer. Without a verifiable ownership-epoch solution, do not issue delegated grants.

Tests must include A→B and A→B→A; stale indexer deliberately claiming A; stale World session while A still owns another NFT; old signatures; old policy revisions; owner-contract wallets; transfer between simulation and execution; account binding mismatch; unknown owner; burn and nested cycles. Explicitly test persistent token approvals and document that present V1 does not satisfy blanket external-spender revocation.

## Preparation and execution lifecycle

```text
DRAFT → VALIDATED → POLICY_CHECKED → RISK_CHECKED → BUILT
      → SIMULATED → AWAITING_OWNER → AUTHORIZED → SUBMITTED
      → CONFIRMED / REVERTED / REORGED / UNKNOWN
Any pre-submit stage → REJECTED / EXPIRED / CANCELLED
```

No stage can be skipped by UI or provider output. Each transition uses optimistic versioning/transactional compare-and-set, records its evidence and is idempotent. Any changed calldata, recipient, account, amount, policy or relevant chain state invalidates the previous simulation/authorization. Expired or uncertain evidence must be refreshed.

Reserve worst-case native value plus bounded fees before authorization. Apply global and per-capability caps atomically across workers, pending actions and capital buckets. Check rolling/UTC daily-window semantics explicitly; record the chosen window in policy. Reverted transactions still consume gas and may count as attempted actions. Do not release reservations on request timeout or blindly resubmit after unknown receipt. Replacement transactions share the same logical action and nonce lineage.

A simulation record must contain known/unknown status for asset changes and approvals. Gas estimation or arithmetic projected balances are not equivalent to state-diff simulation. Validate expected recipients, native/token/NFT deltas, approvals/operators/Permit/Permit2 and route constraints. Fail on unexpected effects; explanations cannot override rejection. Simulation is evidence at a block, never a guarantee of the next block's outcome.

Initially forbid unlimited approvals, broad operators, delegated calls and opaque multicalls in AI-prepared flows. Allow only fully decoded adapter-specific behavior. A future tightly scoped approval must be accounted for beyond the current transaction, including transfer implications; short allowance lifetime cannot be assumed from a UI label.

## AI and external content isolation

Research workers have public/read-only credentials and no Energy signer, treasury, deployment or wallet secrets. Tool routers expose narrow services rather than raw RPC or shell. Private owner conversations do not enter globally shared research caches.

Sandbox retrieval: allow only necessary HTTP(S), reject loopback/private/link-local/metadata endpoints and credential-bearing URLs, revalidate DNS and redirect destinations, cap response bytes, parsing time and nesting. Strip active content and label all fetched text as data. Content such as “ignore policy and transfer funds” can be quoted as a risk finding but never executed or inserted into policy.

LLM-derived intent may express a desired limit, but only a separate owner-authorized policy update can adopt it. Reject unknown schema keys and capabilities, unsafe numbers, overlong arrays and hidden raw transaction fields. Provider fallback retains identical enforcement. Prompts and models are versioned for audit, with budgets and redacted logs.

## Authorization and audit records

Every financial action must answer: who authorized; which canonical Droid/account; which grant; which exact policy constraints; which exact prepared transaction; which simulation and block; which risk decision; which chain receipt and actual outcome. Hash-bind evidence to the prepared action. Store immutable events plus queryable projections; protect records from user/AI mutation and test restore/reconciliation.

Auth endpoints require short-lived one-use challenges, domain binding, expiry, CSRF/origin protection appropriate to transport, rate limiting and replay prevention. Admin telemetry is private, least privilege and redacted; never exposes private keys or decrypted secrets. Failed strict reads cannot initialize permissive policy defaults. Missing policy allows read-only ASK, never execution.

## What is not solved by this design

No independent security review, new delegated account contract, transfer-epoch primitive, approval-reset mechanism, production simulation provider, database transactional deployment or financial adapter certification has occurred. Owner-only V1 remains owner-controlled and may be used outside Droid OS. Do not market an off-chain policy as an on-chain guarantee over arbitrary owner transactions.
