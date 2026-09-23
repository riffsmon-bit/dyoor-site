# Droid OS — proposed architecture

Status: design, not deployed functionality. Read [AS-IS audit](00-current-state-audit.md) first. dYØØR: **Directive: Yield Opportunity Optimization Robots**. Monad 143 is explicit; no implicit fallback to another chain.

## Trust boundaries

Owner supplies funds, rules and authorization. AI supplies interpretation and explanation. Protocol code validates and constrains. Droid Wallet holds assets and supplies final on-chain authority.

```text
Language → AI interpretation → structured intent → runtime validation
         → deterministic policy → capability → deterministic risk
         → approved typed builder → Droid-specific simulation
         → owner authorization → canonical Droid Wallet → execution record
```

Initially the pipeline ends at read-only responses. Later preparation is not execution. An AI response, strategy selection, preference, conversation or opportunity score cannot grant permission. Fund means owner wallet → canonical Droid account, never a pre-funded project wallet.

## Additive directory structure

```text
lib/droid-os/
  domain/                 identity, schemas, capabilities, amounts, errors
  identity/               resolver, authority checks, account bindings
  portfolio/              holdings and pricing completeness adapters
  activity/               indexed read models, reorg-aware ingestion
  intelligence/           provider interface, orchestrator, prompts, validators
    providers/            vendor-specific server-only adapters
  policy/                 pure evaluators, reservations, capital accounting
  risk/                   deterministic checks and evidence normalization
  simulation/             provider interface, state-diff parser, verification
  adapters/               closed capability/DEX/marketplace registries
  opportunities/          shared ingestion, deduplication, enrichment, matching
  missions/               bounded one-off/scheduled jobs
  repositories/           strict interfaces, transactional PostgreSQL adapters
  audit/                  immutable event schemas and reconciliation
  integrations/           Energy, Trait Lab, World, achievements, strategy catalog
components/droid-os/
  roster/ cockpit/ talk/ portfolio/ missions/ activity/ confirmations/ primitives/
app/droid-os/              feature-gated new UI; existing routes retained
app/api/droid-os/v1/       versioned authenticated HTTP endpoints
services/droid-os-worker/  shared queue consumers, no keys in research workers
services/droid-os-mcp/     authenticated narrow protocol tools
test/droid-os/             pure, integration, adversarial and browser suites
```

These are proposed paths, not a claim the modules exist. Integrate existing readers through wrappers; do not copy ownership logic into every route or rewrite Trait Lab. Introduce a runtime schema dependency deliberately in the website workspace; the Discord app's Zod dependency is not automatically available to it.

## Identity and account compatibility

Canonical identity is `(chainId, collectionAddress, tokenId)` with the existing ABI-encoded key. The resolver independently verifies chain, configured registry/implementation, predicted address, deployed code, account footer/token tuple and current `ownerOf`. Results include block number/hash, observation time and a typed failure state. An undeployed counterfactual account is not an active wallet; missing balance is not zero.

Portfolio returns exact token amounts and discovery completeness. Prices are optional, source/time-stamped; no fabricated fiat totals. Funding and withdrawals must rederive the account from the selected Droid. Withdrawals remain owner-authorized, separate from capabilities and never available to AI. Existing V1 ordinary owner transactions are preserved but are outside any claim of protocol-enforced autonomous limits.

V1 cannot execute as a service merely because an off-chain policy allows it. An eventual delegated account version requires separate review, explicit opt-in and an honest address/custody migration design. Never silently repoint the canonical wallet while funds remain in an older account. Reference the [ERC-6551 specification](https://eips.ethereum.org/EIPS/eip-6551) for registry/account distinctions and ownership-cycle concerns.

September 6 decision: the user approved opt-in V2 accounts at new addresses, preserving existing wallets/assets. See [the custody candidate and remaining transfer-revocation gates](09-opt-in-v2-wallet.md). This approves the migration direction, not an unreviewed account implementation or wrapping/escrow architecture.

## Intelligence abstraction

`DroidAIProvider` offers `chat`, `interpretIntent`, `extractStructuredIntent`, `researchProject`, `summarizeToken`, `summarizePortfolio`, `classifyOpportunity`, `explainTransaction`, `explainSimulation`, `summarizeRisk`, `healthCheck` and `getCapabilities` through typed requests/results. Unsupported operations return a typed unsupported result, not invented data.

`DroidIntelligenceOrchestrator` owns provider routing, capability matching, bounded retries, deadlines, rate/token/cost budgets, prompt/schema versions, redacted telemetry, freshness-aware caches and health/circuit breakers. Vendor-specific calls never appear in UI or domain policy code. Adapters may support OpenAI, Anthropic, xAI, Bankr routing, Gemini or DeepSeek after documentation/security review; no paid provider is configured by this design.

Normal UI: `dYØØR INTELLIGENCE / AUTO`. Advanced provider preferences do not weaken validators. Small models handle extraction/classification when capable; larger models are reserved for justified research/explanation. Fallback cannot change capability requirements, simulation rules or schema versions. Financially relevant malformed/refused/truncated output terminates preparation.

The OpenAI Docs skill was used for the OpenAI portion; official [Structured Outputs guidance](https://developers.openai.com/api/docs/guides/structured-outputs) informs the adapter boundary. Provider-side structured output is not a substitute for application validation, domain constraints or authorization. No model name, cost or provider availability is assumed permanent.

## Shared discovery and missions

Use shared ingestion → normalization → deduplication → fast filters → enrichment → security evidence → cached AI research → opportunity store → deterministic Droid matching. Do not create one scanner, process or persistent model context per NFT.

Research cache keys include chain, contract/project identity, content hash and research version. Contract-risk keys also include implementation/proxy/configuration identity and freshness, not just proxy bytecode. Opportunity keys include source identifier and analysis version. Public analysis can be shared; private portfolios, conversations and per-Droid simulation cannot.

Start with manually submitted/approved sources and read-only NFT/token/project research. Future ingestion may consume deployments, pair/liquidity events, launches, claims, listings, social/project feeds and quests. Fetching untrusted URLs is a sandboxed ingestion task, not an AI tool with unrestricted network access.

Missions carry a single execution class: READ_ONLY, SIMULATION_ONLY, OWNER_APPROVAL_REQUIRED or AUTOMATED_WITHIN_POLICY. Initially allow only read-only classes. Scheduled briefs and watches use bounded shared queues, cancellation, leases, idempotency and backoff; no high-frequency execution loop.

## Policy, adapters and simulation

Soft preferences rank results. Hard operating policy, explicit capability grants and observed balances determine eligibility. ASK is the default and cannot execute. ASSIST requires explicit owner approval of an exact prepared action. AUTONOMOUS is never a global override: it eventually means narrow, separately authorized capabilities only.

Capability registry distinguishes intelligence, mission and financial capabilities. Financial capabilities remain disabled until implemented adapters exist. Typed DEX/marketplace interfaces expose inspection, quote, deterministic build and validation—not arbitrary target/calldata. Initial Kuru research may reuse route knowledge, but current approximate simulation is insufficient for money-moving Droid OS.

Every prepared action binds identity, account, owner, policy/grant versions, adapter version, exact call hash, value, recipients, approvals, asset limits, chain, simulation evidence, risk decision, nonce and expiry. Simulation occurs in the actual Droid account context. Unknown balance changes, unsupported simulation or unexpected approval means deny financial preparation/authorization, not silently use a gas estimate.

## Proposed API surface

All paths are under `/api/droid-os/v1`; response envelopes include version, request ID, observation time and completeness. Reads may be public only for already-public on-chain facts; private data requires authenticated per-Droid access.

| Route | Purpose / boundary |
| --- | --- |
| `GET /droids?owner=...` | Indexed discovery, clearly non-authoritative |
| `GET /droids/:identity` | Verified identity/account snapshot |
| `GET /droids/:identity/{portfolio,activity,achievements,energy}` | Typed read adapters with source/freshness |
| `POST /auth/challenge`, `/auth/verify` | Domain-bound one-use wallet challenge; rate-limited |
| `GET/PUT /droids/:identity/preferences` | Owner-era private preferences; fresh canonical authorization on writes |
| `POST /droids/:identity/conversations/:id/messages` | Read-only AI; quotas and injection isolation |
| `POST /droids/:identity/missions` | Initially bounded read-only tasks |
| `GET /opportunities`, `GET /opportunities/:id` | Sources, risk/freshness/confidence explicit |
| `POST /strategies/{draft,validate}` | Draft data only, no policy mutation or wallet calls |
| `POST /policies/prepare-update`, `/policies/authorize-update` | Later explicit signed policy revisions; no chat-authorized write |
| `POST /actions/prepare/{swap,mint,nft-buy,claim,quest}` | Later implemented typed adapters only |
| `GET /actions/:id`, `POST /actions/:id/simulate` | Exact-action evidence, not arbitrary RPC |
| `POST /actions/:id/authorize` | Later explicit current-owner authorization; no server owner key |
| `GET /health` | Minimal public status; detailed telemetry private admin only |

No generic execute, arbitrary calldata, unrestricted transfer, admin withdrawal or signing endpoint. A recorded browser transaction hash is not proof of execution: reconcile chain, sender, account, call and receipt.

## Proposed MCP surface

Expose namespaces `droid.identity.*`, `droid.portfolio.*`, `droid.activity.*`, `droid.research.*`, `droid.opportunities.*`, `droid.strategy.*`, `droid.simulation.*`, `droid.actions.prepare.*`. Tools map to the same domain services and policy enforcement as HTTP; MCP is not an alternate bypass.

First tools: get_my_droids, get_droid, get_droid_wallet, get_droid_balance, get_droid_assets, get_droid_portfolio, get_droid_activity, get_droid_strategy, get_opportunities, inspect_token, inspect_contract, inspect_nft, inspect_transaction, draft_strategy and validate_strategy. Later: estimate_cost, simulate_action, prepare_strategy_update, prepare_swap, prepare_mint, prepare_nft_buy, prepare_claim, prepare_strategy_action and prepare_droid_action. Generic-sounding preparation still dispatches only a closed discriminated capability schema.

Forbidden: get_private_key, get_seed_phrase, sign_any_transaction, execute_arbitrary_calldata, withdraw_anything, admin_withdraw and transfer_any_asset. MCP responses are untrusted data to the assistant; neither prompts nor returned research grant authority.

## UI route and component map

`/droid-os` is Droid Select: owned artwork as the hero, horizontal roster on mobile, keyboard-accessible focus/selection, no fabricated balances or seeded achievements. `/droid-os/:identity` is the cockpit. Subroutes: `talk`, `portfolio`, `strategy`, `missions`, `opportunities`, `activity`, `achievements`, `settings`. Energy and Trait Lab link to existing workflows with explicitly validated context. Funding and withdrawal use dedicated owner confirmation sheets, not conversation-generated buttons with unchecked addresses.

Keep main-site charcoal, cyan and restrained purple. Define tokens for semantic status, spacing, radii, typography and motion. Desktop: prominent selected Droid, deliberate navigation, full-size Talk panel and contextual details. Mobile: horizontal roster, large artwork, bottom navigation, full-screen Talk and accessible sheets. Respect reduced motion; use visible focus, 44px touch targets, readable contrast and real loading/error/empty states. Do not place full-screen background layers above interactive content.

Profile level/class/personality/strategy/mission counts must be sourced or explicitly unset. Existing artwork is the visual hero; no new copyrighted game assets or copied layouts. Rendered desktop/tablet/mobile review is a release requirement, not satisfied by TypeScript passing.
