# Droid OS — data and persistence model

Status: proposed additive schemas. No database migration applied; no production state copied or overwritten.

## Four kinds of truth

| Category | Examples | Authority |
| --- | --- | --- |
| ON-CHAIN AUTHORITY | Current `ownerOf`, account binding, contract-enforced permissions | Canonical chain reads/final contract execution |
| INDEXED ON-CHAIN DATA | Balances, logs, historical owners, holdings, receipts | Read acceleration; block/hash/completeness recorded; never final ownership authorization |
| OFF-CHAIN APPLICATION STATE | Preferences, conversations, missions, signed policy revisions | Strictly validated, owner-scoped and versioned; cannot invent on-chain permissions |
| AI-GENERATED ANALYSIS | Research, summaries, rankings, suggested intent | Untrusted advisory output with provenance, never authority |

## Common schema rules

Use runtime schemas at all trust boundaries, preferably a deliberately added website Zod dependency. Durable objects carry `version: 1`; reject unknown versions and unexpected keys. Keep pure validators independent of UI/provider code. Never parse financial amounts through JavaScript `number`.

`UInt256Decimal` is a canonical nonnegative base-10 integer string, no signs, spaces, decimal points, exponent, or leading zeroes except `0`, bounded to uint256. JSON stores atomic units this way; computation uses bigint; PostgreSQL uses `numeric(78,0)` with range checks. Token decimals are verified metadata, not inferred from symbols. Basis points are bounded integers. Addresses are normalized validated 20-byte values; hashes are fixed-length hex. Token IDs use uint256, not unsafe JS numeric conversion.

Timestamps use explicit UTC instants; expiry must be after validity start. Chain snapshots carry block number, block hash, observation time, source and freshness. An unavailable balance, price, owner or simulation field is an explicit unknown/error—not `0`, empty success or a fabricated estimate.

## Versioned domain schemas

| Schema | Required fields and rules |
| --- | --- |
| `DroidIdentityV1` | version, chainId, collectionAddress, tokenId; derive existing ABI-encoded identity hash; explicit allowlisted chain/collection |
| `DroidPreferencesV1` | identity, owner-era scope, interests/exclusions, explanation detail, persona style, locale, revision, timestamps; soft influence only; no transaction or grant fields |
| `DroidOperatingPolicyV1` | identity, revision, authorizing owner/epoch, chainId, mode ASK/ASSIST/AUTONOMOUS, reserve, global/per-capability spending/action limits, risk/approval/contract rules, enabled capabilities, validAfter, expiresAt, signature reference; missing policy cannot permit financial actions |
| `DroidCapitalPolicyV1` | minimumNativeReserveWei, maxNativePerActionWei, maxNativePerDayWei, per-capability budgets; later named NFT/speculative/unallocated buckets; sum/allocation constraints; gas counted; no Energy units |
| `DroidCapabilityGrantV1` | identity, grantId, issuer/current-owner epoch, capability, chainId, maxValuePerActionWei, dailyLimitWei, maxActions, contractScope, assetScope, riskLimit, simulationRequired, ownerApprovalRequired, validAfter, expiresAt, policy revision, revocation reference; no arbitrary-call capability; grants initially inactive |
| `DroidMissionV1` | identity, missionId, owner-era, objective, typed parameters, executionClass, status, optional schedule/condition, budget/time limits, cancellation, source references; research first |
| `DroidPositionPolicyV1` | maxOpenPositions, maxPositionValueWei, maxHoldingDuration, optional stop-loss/take-profit BPS, liquidity/risk-change triggers, never-sell assets, approval rules; future only, no automated exits enabled |
| `OpportunityV1` | id, chainId, type/status, source/sourceUrls, contracts/tokens/collections, requiredValueWei, estimatedGas evidence, start/end, required capability, risk/research status and references, typed simulation template reference, bounded metadata/analysis, freshness, timestamps |
| `PreparedActionV1` | id, identity/account, current owner/epoch, capability/grant/policy revisions, typed intent, adapter/version, chain, exact transaction envelope/hash, asset/recipient/approval constraints, risk/simulation IDs, nonce, expiry, lifecycle state; only trusted builders produce executable envelope |
| `SimulationResultV1` | action hash/account/chain, status SUCCESS/REVERT/UNKNOWN, revert reason, gas estimate, native balances, ERC20/NFT deltas, approvals/operators, recipients, expected/unexpected outcomes, completeness, block/hash/time/provider; incomplete required evidence denies financial action |
| `RiskAssessmentV1` | target/adapter identities, bytecode/proxy/config evidence, deterministic findings/severity, decision ALLOW/DENY/UNKNOWN, source versions/freshness, simulation reference; AI explanation separate and non-authoritative |
| `ExecutionRecordV1` | action/authorization IDs, who/which Droid/grant/policy, evaluated constraints, tx hash/nonce/chain, submitted/confirmed blocks, receipts/actual deltas, status, gas/spend reconciliation, immutable audit event IDs |

Structured intent is a discriminated union, not `{target, calldata, value}`. Read-only intents include research/summary/inspection. Future swap intents identify assets, amount, slippage and expected recipient; mint/buy intents identify supported adapter and listing/mint constraints. Only a trusted adapter translates intent into call bytes.

Capabilities are a closed registry grouped into intelligence, missions, NFT, token, ecosystem and future operations. The initial enabled set is read-only chat/research/discovery/inspection/strategy drafting and validation; simulation preparation is enabled only after evidence infrastructure exists. Unknown capability denies. Financial and cross-chain variants may be represented but remain disabled.

Floor evidence records marketplace/source, currency, sample size, observed listing set, timestamp, freshness and confidence. A stale/illiquid reference cannot support an unqualified “below floor” claim. Token risk stores inspectability and unknowns, not a `safe: true` label.

## Normalized PostgreSQL design

Use an additive `droid_os` namespace, distinct from existing economic/rewards tables. Existing Supabase/Postgres may host it after deployment/RLS/backup validation; this is not an instruction to apply migrations. Existing Netlify storage continues serving legacy metadata/Energy/World workflows.

| Table | Keys, relationships and purpose |
| --- | --- |
| `droids` | identity PK; unique(chain, collection, token); descriptive metadata references; no authoritative owner column |
| `account_observations` | identity + block hash + registry version; account/code/binding evidence; indexed snapshots |
| `ownership_observations` | identity + block hash; sampled owner, source, reorg status; explicitly not permission grants |
| `owner_eras` | identity + era ID, observed boundaries and status; privacy segmentation only until on-chain epoch proof exists |
| `droid_preferences` | identity + owner-era + revision; validated preferences; active revision pointer |
| `droid_operating_policies` | policy ID, identity, revision unique, owner/epoch proof and signature; immutable revisions |
| `capability_grants` | grant ID, policy FK, issuer/epoch, capability, caps/scopes/expiry/revocation; never mutable AI output |
| `capital_buckets` | policy + bucket key; exact allocation/reserve limits |
| `budget_reservations` | action ID unique, policy/window/bucket, reserved value+fees, lifecycle and reconciliation; transactional |
| `positions` / `position_policies` | identity/asset, observed exposure and explicit exit rules; future disabled execution |
| `missions` / `mission_runs` | owner-era, mission version, bounded schedule; run idempotency key and status |
| `conversations` / `conversation_messages` | identity + owner-era, role, content, provider/version, retention; private by default |
| `opportunities` | normalized ID, source identity, chain/type/status, freshness and immutable versions |
| `opportunity_sources` | source key, URL/feed/event identity, trust label, fetch provenance, dedupe keys |
| `opportunity_analysis` | opportunity/version, research/risk links, generated analysis provenance |
| `contract_analysis` | chain/address/code + implementation/config hash + analysis version; block/TTL/unknowns |
| `risk_assessments` | immutable decision/evidence attached to exact action or shared contract analysis |
| `prepared_actions` | identity, owner-era, adapter/policy/grant references, exact action hash, expiry/version/state |
| `simulations` | prepared action hash, provider/block evidence, structured deltas/completeness |
| `authorizations` | exact action hash, owner/epoch, signature scheme/domain/nonce/expiry; unique consumed nonce |
| `executions` | logical action, transaction attempts/replacements, nonce lineage, receipt and reconciliation |
| `activity` | source event unique(chain, tx, log index), identity, block hash/reorg flag, public/private visibility |
| `audit_events` | append-only actor/resource/action/evidence hashes, transition/rejection reasons; immutable references |
| `provider_usage` / `provider_health` / `cost_telemetry` | model/provider/prompt, token/cache/time metrics, cost provenance/currency; no secret/prompt leakage |
| `notifications` | owner-era recipient, consent/channel, delivery idempotency/status, minimal private payload |
| `jobs` / `worker_leases` | shared bounded queue, priority, attempt limit, lease, dedupe, cancellation/dead letter |

Existing strategy/achievement tables become read adapters with explicit source and deployment status. Existing treasury/revenue tables remain separate project accounting; they are never the custody destination for owner funding. Do not duplicate legacy mutable trait or Energy ledgers into new competing sources of truth.

Indexes: chain/collection/token unique identity; opportunity type/status/freshness; source dedupe key; action account/status/expiry; capability policy/expiry; mission next-run/status; audit identity/time; usage provider/time. Enforce foreign keys and unique idempotency constraints. Monetary reservation transitions require database transactions with appropriate row locks/serializable retry, not only application checks.

## Privacy, retention and transfer

Public on-chain activity stays attached to the Droid. Former-owner private chat, identity details and private strategy rationale are not automatically revealed to a buyer. Personality/preferences may be exported only under explicit handover rules. Hard policies/grants are invalidated on transfer; new ownership never implies consent to old spending rules.

RLS/service authorization must scope private rows by verified owner-era access, not user-supplied owner strings. Server service-role access requires the same domain authorization checks. Retention/deletion rules distinguish user text from required financial audit evidence; redaction preserves hashes and transaction facts without retaining unnecessary private content. No secrets in messages, metadata, telemetry or admin dashboards.
