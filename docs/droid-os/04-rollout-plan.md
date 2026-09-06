# Droid OS — incremental rollout and release gates

Status: plan after Phase 0 assessment. No contracts deployed, production secrets changed, mainnet transactions broadcast or autonomous execution enabled by this work.

## Build order

| Phase | Additive deliverable | Exit gate |
| --- | --- | --- |
| 0 — audit | Five reports, read-only contract evidence, baseline tests and unknowns | AS-IS available before invasive changes; no unsupported production claims |
| 1a — identity foundation | Pure versioned identity/amount schemas, strict canonical resolver, account-binding wrapper, stale/unknown states | Canonical/current-owner and chain mismatch tests; no new write route |
| 1b — Control Center | Feature-gated Droid Select/cockpit; portfolio/activity/achievements adapters; owner-scoped Energy; Trait Lab links | Real source data, partial/N/A labels, mobile/desktop visual checks, existing routes preserved |
| 1c — owner custody UX | Reuse existing direct Fund/Withdraw after exact account binding and burn/approval warnings | Current-owner revalidation; no central funding wallet; no AI withdrawal; local/fork tests only |
| 2 — conversation | Provider abstraction/orchestrator, AUTO, strict read-only intents, explicit preferences and research missions | Provider failures/injection cannot produce financial calls; quotas/privacy and runtime validation tested |
| 3 — shared intelligence | Approved ingestion, dedupe, shared research/risk metadata, deterministic matching | Source freshness/provenance, bounded workers and cache correctness; no per-Droid scanner |
| 4 — policy | Versioned operating policy/grants, capital/reserve/spend/action caps, expiry/approval checks | Pure property tests plus transactional concurrency/replay tests; grants do not imply V1 execution authority |
| 5 — preparation | Narrow reviewed adapters, deterministic risk, exact-account simulation, prepared-action audit | Unsupported/unknown effects deny; no autonomous execution; inspect exact decoded transactions |
| 6 — ASSIST | Owner-approved supported swap/mint/buy/claim/quest flows | Separate authorization to activate; independent review; exact signed action, canonical final owner check and receipt reconciliation |
| 7 — autonomous canary | Only separately approved on-chain-enforceable narrow grants | Transfer-epoch/approval/burn model solved, audited account path, reserve/cap enforcement, operator kill switch and tiny caps |
| 8 — broader modules | Additional reviewed adapters, position/exit logic and capabilities | Proven canary evidence, incident drills, cost/abuse budgets and independent review |

Canary order, only after separate authorization: whitelisted claim → whitelisted/free mint → constrained mint → constrained reliable-floor NFT purchase → very small speculative token position. Never jump directly to broad memecoin trading. Design exits, sell simulation and never-sell assets before enabling speculative entries.

## First implementation slice

Create only pure identity/atomic-amount validators and a read-only canonical resolver around existing account readers. Test wrong chain/collection/registry/account binding, missing token, unknown RPC, undeployed account, stale indexer, transfer and smart-contract owner cases. Keep execution, paid AI, production database writes and account activation off. This slice is independently reviewable and does not require changing existing contracts or accepted rerolls.

The user-reported World Trade desk loading bug is an existing-product fix to address separately after this audit. Keep its code/release separate from Droid OS architecture changes. Do not enable push keys, escrow roles or trading flags merely to fix loading UI.

## Test matrix

| Boundary | Required adversarial cases |
| --- | --- |
| Schemas | uint256 overflow, negative/exponent/float amounts, unknown keys/version/capability, oversized arrays, malformed addresses and timestamps |
| Identity/authority | A controls; transfer to B; A cannot execute/withdraw/change policy; B gains control; stale indexer/session; transfer during preparation; A→B→A; wrong NFT with same owner |
| Custody | Assets/history remain at canonical account; no central prefunding; external approvals persist and are surfaced; parent burn/cycles fail closed |
| Policy | Reserve incl. gas; global/per-capability caps; concurrent reservations; pending/failed/replaced tx; expiry; scope/risk limits; ASK always denies financial execution |
| Intent/provider | Malformed/refused output, timeout/fallback, prompt injection in metadata, invented quote/contract, unauthorized policy update, cost/token limit |
| Risk/builders | Unknown adapter/code/proxy change; wrong selector/recipient/value; unexpected approval/Permit2/operator; arbitrary calldata; slippage/price impact; approval residue |
| Simulation | Revert/unknown/incomplete effects; wrong account/chain/action hash; stale block; unexpected balance/NFT changes; inability to sell; gas estimate incorrectly treated as simulation |
| Execution/audit | Exact owner authorization, nonce/expiry/replay, grant revocation/transfer, missing durable record, receipt mismatch/reorg/unknown broadcast; no automatic duplicate submission |
| Privacy/services | Cross-owner chat leakage, SSRF/redirect/private IP, rate limits, cache isolation, worker duplicate delivery, strict storage outage, RLS and backup restore |
| UI | iPhone/tablet/laptop/desktop; roster selection, real images, navigation stacking, Talk, error/retry, owner change, confirmation sheets, keyboard/focus/reduced motion |

Existing dedicated Foundry suite passed 52 tests. Root compilation and legacy broad-suite limitations remain documented in the audit; passing the dedicated suite does not prove all V2 invariants. Add explicit policy/grant/session/provider/approval-survival tests rather than rebranding current tests as coverage that does not exist.

After each major slice: relevant unit/integration/contract tests, TypeScript, ESLint, production build, rendered visual inspection where UI changes, security-impact note, migration/rollback review and remaining blockers. Do not fix unrelated failing fixtures/UI text inside financial work without a separate explanation.

## Operations, cost and observability

Use a shared queue and small worker pool with global/per-wallet/per-Droid quotas. Configure maximum concurrency, retries, response bytes, model tokens and daily provider budget. Lazy compute and shared analysis cache avoid linear growth in active agent processes. No cost estimate is asserted without actual provider usage/pricing evidence.

Track RPC/database/discovery/simulation/executor/provider health; provider/model/prompt/schema versions; token usage, cost source and cache hits; opportunity discovery/matching counts; preparations/rejections/approvals/executions; policy/risk rejection codes; simulation and execution failures; queue age and lease recovery. Redact private prompts and wallet-session secrets.

Private admin is read-oriented: active/funded Droid counts from labeled indexed data, policy/mission counts, provider cost, queues, RPC health and failure evidence. No keys/decrypted secrets, general withdrawal or hidden financial override. Kill switches can stop new automated actions, never seize owner assets.

## Release and rollback gates

Use a separate additive branch and disabled feature route for initial work. Preserve main-site styles, existing World and Trait Lab behavior. Add database tables/columns without deleting legacy records; validate backup/restore before applying anything. Preview must not accidentally use production writable financial credentials. Test wallets/forks/local simulations do not justify mainnet activation.

Rollback UI via feature flag without migrating funds. Rollback workers by halting new jobs while reconciling submitted actions; never assume halting a process cancels a transaction. Immutable account upgrades/address changes require a separate owner migration specification, not a website rollback.

Production blockers include: delegated authority and transfer-epoch design; persistent approvals and burn consequences; adapter/proxy identity; complete simulation; atomic budget accounting; independent review; private-data transfer rules; key separation; worker/database deployment verification; broad test baseline; user-visible risk language. `.xyz` domain selection/configuration remains unresolved; current `.fun` and on-chain Netlify metadata URI remain unchanged.

User authorization is required separately before production contract deployment, mainnet broadcasting, role/secret changes or autonomous activation. “Build the foundations” is not permission for any of those actions.
