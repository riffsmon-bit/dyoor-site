# ASK training canary — 6 September 2026

This is an additive preview-only slice after the existing audit, not completion of Droid OS Phase 2 or financial autonomy. No contracts, roles, keys, production secrets, rerolls or Energy balances were changed.

## What is wired

Connect the actual owner wallet on `/droid-os`, select a live Droid, open Talk and choose **Load my training**. Sign the explicit, one-request message. **Train Droid**, Strategy, Missions and Settings share the saved training form. Select interests, concise/detailed responses, up to 1,000 characters of soft instructions and five research objectives. Choose **Save training** and sign. Reloading loads the server record, not a browser demo.

Training here means preferences and research-objective drafts, not fine-tuning weights, completed research missions, background monitoring, trading skills or financial permissions. Chat cannot silently save instructions; owners must review the form and sign its exact update. Free mints and memecoin research are interests, not execution capabilities.

The ASK provider adapter can pass this saved context and the last six conversational exchanges into a real model. There is no browser/scraper, live opportunity feed, pricing, portfolio enrichment, simulation or transaction tool in that request. Replies are labelled AI analysis, never chain evidence. No scripted reply is substituted if provider setup is absent or a call fails.

## Provider activation

Initial inspection found no AI provider credential. The operator subsequently created a Groq key and saved `DROID_AI_GROQ_API_KEY` as a Netlify secret, Functions-only with a value only for Deploy Previews. The API masks its value, so local tests cannot use it. Readiness indicates valid configuration, not a successful live provider response. Training persistence works without an AI provider.

Server-only configuration, when the operator chooses to enable a provider test:

| Variable | Purpose |
| --- | --- |
| `DROID_AI_PROVIDER` | Builds-only Deploy Previews: explicit `groq`; omitted retains legacy OpenAI selection, never automatic fallback |
| `DROID_AI_GROQ_API_KEY` | Groq credential, Functions-only Deploy Previews secret |
| `DROID_AI_OPENAI_API_KEY` | Dedicated restricted API-project credential, never `NEXT_PUBLIC_*` |
| `DROID_AI_MODEL` | Builds-only Deploy Previews: `openai/gpt-oss-20b`; other Groq models deny until reviewed |
| `DROID_AI_ENABLED` | Builds-only Deploy Previews: must be exactly `true`; default disabled; production build forces false |

Scope credentials to deploy-preview Functions only, never Builds or production. Non-secret selection/enable settings are Builds-only and inlined explicitly by Next; changes require a rebuild. Do not paste credentials into chat or source control. Normal UX stays provider-neutral. The abstraction now has OpenAI and Groq adapters; Claude/xAI Grok/Bankr are not integrated. Groq (hosting) is not xAI Grok (model). Remain on Groq's Free plan; app code cannot ensure the operator has not upgraded the provider account. Do not enable paid fallback. Enable Zero Data Retention in Groq's dashboard before sharing private conversations; this setting cannot be inferred from a working API key and has not been verified here.

### Groq free-tier boundary

The separate `groq.ts` adapter uses one fixed HTTPS Chat Completions endpoint, rejects redirects, and pins GPT-OSS 20B. Low reasoning effort, no returned reasoning, no tools, non-streaming strict JSON schema, 1,000 maximum completion tokens, 20-second timeout and 64KB response ceiling. Runtime validation rejects wrong models, multiple choices, truncation, refusals, tool calls, invalid usage and unknown reply fields. Errors expose no provider response body or key. There are no retries or fallback calls.

Serialized request size is capped at 6,000 UTF-8 bytes, removing oldest conversation pairs from provider context only. Saved history, training and current message are not truncated. Oversized training/current input denies with a shortening instruction. This is a conservative byte budget, not an exact tokenizer. Groq's actual token quotas can still reject calls, especially near minute boundaries or when this API organization is used elsewhere.

Additional durable, create-only admission slots cap Groq at **one attempt per UTC minute and 25 attempts per UTC day, shared across the preview application**. Existing owner daily caps remain. Failed calls consume reservations; no uncertain attempt is refunded. This conservative initial allowance is below the provider's published request cap to leave headroom for token usage. No production billing or secret is changed. Real owner-signed end-to-end chat still requires owner testing; no synthetic signature substitutes for a user's proof.

Sources checked for this adapter: [OpenAI GPT-OSS 20B](https://developers.openai.com/api/docs/models/gpt-oss-20b), [Groq structured outputs](https://console.groq.com/docs/structured-outputs), [Groq API](https://console.groq.com/docs/api-reference), [free-plan quotas](https://console.groq.com/docs/rate-limits), [data controls](https://console.groq.com/docs/your-data). Structured JSON is not financial authority or factual verification.

Before enabling beyond operator testing, isolate the AI workload's deployment credentials from the existing site's Energy/admin signer environment. The new modules import no signer/admin/Energy services, and send only explicit conversation data to the provider, but sharing a serverless deployment is not process-level credential isolation.

## Modules and API

- `lib/droid-os/ask/schema.ts`: closed runtime validation for versioned identity-bound operations, training and conversation state; unknown keys deny. Uses dependency-free validators consistent with existing boundary helpers; this is not the complete future policy schema.
- `ownership.ts`: keyless Monad reads, actual chain ID, pinned Season 2 runtime hash, fresh block, canonical `ownerOf`, block-hash validation and bounded Transfer-log scans.
- `protocol.ts`: shared exact signing-message construction; browser independently checks origin, identity, request digest and expiry before asking the wallet.
- `service.ts`: one-use proof consumption, owner checks, profile isolation, optimistic state revisions, fixed admission slots and usage records.
- `storage.ts`: separate `droid-os-ask-preview-v1` Netlify store, strong reads and conditional writes. A pinned `droid-os-blobs` SDK alias leaves the legacy metadata/Energy SDK untouched. Local Next uses `data/runtime/droid-os-ask` (ignored by Git), mode-0700 directory/mode-0600 files, exclusive locks and atomic rename. A crashed local lock denies until inspected; it is not silently stolen.
- `provider-contract.ts`, `intelligence.ts`, `groq.ts`: shared `DroidAIProvider` boundary, `DroidIntelligenceOrchestrator`, separate OpenAI Responses and Groq Chat Completions adapters, versioned prompts, strict response schema, no tools, bounded response bodies and timeout. No automatic retry of potentially billable timed-out calls.
- `POST /api/droid-os/ask`: `challenge` or `perform`, exact operation (`load`, `save`, `chat`), same-origin JSON, bounded streamed request body, no-store/private responses. `GET` reveals only mode/readiness, no private data.
- `DroidAskWorkspace` and `useDroidAskClient`: loaded/saving/error/missing-provider states, explicit signing actions and mobile-accessible form. The disconnected sample UI stays labelled as a demo.

## Authority and privacy

This first canary supports EOA personal-message signatures only; contract-wallet/ERC-1271 support is not implied. Every load, save and chat has a new server challenge binding operation hash, origin, wallet, chain, collection, token, nonce, observation block and two-minute expiry. No reusable wallet session or signing key is issued. A proof is atomically consumed, including concurrent replay. Unknown owner/storage/RPC denies access.

After signing, verify canonical ownership and scan Transfer events from the observation block, in RPC-compatible 100-block ranges. Any transfer, including A→B→A, invalidates that proof. Reorged, stale or more-than-1,200-block-old evidence denies. A transfer in the initial observation block can cause a conservative retry. After a model call, recheck again before storing/returning its reply.

This is an off-chain authorization snapshot, not an atomic on-chain transaction: an NFT transfer can race the final storage write/response. No wallet execution relies on this path. Delegated financial authority and persistent transfer epochs remain blocked by the earlier audit findings.

Profiles are keyed by `(143, collection, tokenId, wallet)`. A buyer gets a separate empty profile, not the seller's messages. If the same wallet later reacquires the NFT and signs a new proof, it can access its own prior profile. This is wallet-scoped privacy, not fully implemented ownership-era history or automatic personality handover. Private data is not publicly readable or placed in shared research caches.

## Limits and evidence

Immutable conditional-write admission slots cap challenge issuance at 6/owner/minute and 30 globally/minute. Chat attempts cap at 20/owner/UTC day and 100 globally/UTC day, with up to 1,000 output tokens per attempt and bounded input state. Slot reservations are conservative: failed requests consume their admitted slot; no uncertain retry is automatically refunded. These are request/token caps, not a guaranteed dollar budget or financial capital-policy engine. Global admission exhaustion can deny service; production abuse controls need further work.

An immutable STARTED attempt is recorded before a provider call and redacted usage is stored afterward: provider/model, prompt version, tokens, duration, timestamp; USD cost is `null`, not invented. A STARTED record without usage means failed/uncertain, never successful execution. No prompts, keys or signatures are logged to telemetry. Profiles retain at most 12 messages. Challenge/attempt/slot cleanup, full retention/deletion UX, health dashboards and normalized PostgreSQL migration remain follow-up work before broad launch. Separate Blob profiles are a canary storage adapter, not a substitute for the proposed transactional execution database.

## Verification

- Groq addition: 22 ASK/provider tests passed, including shared cross-owner minute/day caps, bounded Unicode input, wrong-model/tool-call/refusal/truncation rejection and zero fallback calls. TypeScript and ESLint passed. Existing roster/UI (19), ASSIST (52), website (71) and Trait Lab (7) tests passed. Rendered fixture load/save/reload/chat passed at 1440/390/360px with no horizontal overflow; the 390px screen was visually inspected. These are mocked provider/UI checks, not a successful live Groq reply.
- Local optimized webpack production build passed with existing optional Privy Stripe/Farcaster module warnings. No Groq endpoint or Groq secret environment-variable reference appeared in the browser JavaScript. The actual Groq secret is unavailable locally and was not part of that build or a value-based local secret scan.
- First hosted upload hit Netlify legacy Lambda's 4KB environment limit. The three newly added, non-secret AI selection/enable variables were moved to Builds-only scope and explicitly inlined by Next, with production forced disabled. The Groq credential remains Functions-only and no existing runtime secret was removed or rescaled. An additional regression test checks this boundary (23 ASK/provider tests total).
- ASK unit tests: closed schemas, owner save/reload with provider absent, wrong signature/origin/identity, expiry, concurrent replay, stale revisions, owner transfer/private-state separation, mocked A→B→A proof rejection, quotas, durable local store, strict provider config, malformed/refused/tool-call/incomplete output, oversized output, storage HTTP errors, no fake fallback or automatic paid retry.
- Live read-only check: Droid 11, chain 143, owner `0xc7f55ce6a7df9a79cc4a643a5081230f890c7aa6`, block 102561073 / hash `0xc5f3cc3cf0615bbc47004ab587929a76347cf0ccd16199967cb3512bc0172f1f`; unchanged check passed. This is a timestamped observation, not ongoing authority.
- `scripts/test-droid-ask-ui.mjs`: actual rendered components at 1440, 390 and 360 pixels; fixture load/save/reload/chat, hit-tested buttons, no horizontal overflow. Screenshots visually reviewed. Browser tests use explicit UI fixtures and perform **zero real wallet signatures, AI calls or production writes**; Backpack end-to-end testing still requires the owner.
- Existing website, roster/artwork, ASSIST and Trait Lab regression suites pass. TypeScript, lint and local webpack production-build checks are run before handoff. Existing optional Privy Stripe/Farcaster module warnings are unrelated.
- Dedicated Netlify storage QA: three concurrent create-only writes produced exactly one winner; ETag update succeeded and a stale ETag update was rejected. The temporary QA object was deleted afterward. No user profile, metadata or Energy object was touched.
- Initial hosted challenge test exposed Netlify's internal request-host rewrite. The guard now pins the exact public deploy-preview audience at build time from `DEPLOY_PRIME_URL`, without trusting forwarded host headers or opening other preview origins. Regression tests cover the proxy-host case and lookalike/production origins.
- Hosted/local storage selection also uses an explicit build-context constant, not optional runtime Netlify environment markers. Hosted SSR must never attempt local filesystem persistence. Local loopback aliases are permitted only in the explicitly local build mode.

Provider schema followed [official OpenAI Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs). Storage conditional-write semantics were checked against [Netlify Blobs documentation](https://docs.netlify.com/build/data-and-storage/netlify-blobs/). Passing tests is not an independent security audit or production-safety claim.
