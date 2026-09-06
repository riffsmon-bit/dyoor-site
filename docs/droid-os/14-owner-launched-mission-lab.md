# Owner-launched missions — local contract experiment

September 6, 2026. **Implemented locally; no public deployment, financial autonomy activation, new deposit address, or chat launch button.** The deployed ASSIST badge account and current ASK chat are unchanged.

Follow-up: the user subsequently approved building the opt-in wrapper design. [Report 15](15-opt-in-control-receipt-lab.md) records the local implementation, real-collection fork findings and remaining production gates. This does not authorize a live NFT deposit or public deployment.

## Outcome and architecture boundary

The isolated Anvil flow demonstrates an owner signing one bounded launch transaction, followed by a separate runner submitting a fixed free mint without another owner signature. The NFT arrives in the Droid account. Funding is owner → Droid, not a project custody wallet. The runner pays its own local transaction gas. Replay, cancellation, old ownership and ownership round trips deny further runner actions.

This is a **contract/runner foundation**, not completed chat-to-autonomy integration. No AI is invoked by the harness. A text commitment labels a fixture mission; it is not natural-language interpretation or authorization. No real wallet extension is exercised. The local parent is a deliberately different, epoch-enabled fixture, NOT deployed Season 2.

## Current-state evidence and blocker

Read-only Monad observation at block **102588530** confirmed chain 143, Season 2 runtime hash `0x2baa62e8fad053a2b59e10eb8dbfc9bbb8ef98c93a55a1114ff7776226ae15fd`, Droid 11 owner `0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6`, and an unavailable `ownershipEpoch(uint256)` call. This supplements, but does not replace, the verified-source and fork counterexamples in [report 10](10-transfer-authority-decision.md).

The live collection lacks the lifecycle primitive used here. An address-only permission can revive after A → B → A. A background indexer cannot supply atomic on-chain transfer revocation. The existing immutable ASSIST account cannot be upgraded into this experiment or the final autonomous wallet.

**Do not remove the local-only guard, substitute an indexer epoch, or advertise this as compatible with current raw Season 2 ownership.** Deploying an opt-in wrapper/receipt would move the parent NFT and change canonical authority; transfer gating changes collection behavior and still has documented burn/admin limitations. Neither custody change is authorized by a general request to build missions. Independent design/review and explicit product direction are required before either path. No such change was made.

## Added code

`contracts/droid-os-mission-lab/` is separate from production contracts, V2 custody candidates and the deployed ASSIST canary:

- `EpochParentLab`: test NFT with an on-chain monotonic epoch updated on every mint, transfer and burn. Its unrestricted mint is intentionally test-only.
- `MissionMintLab`: one fixed zero-price ERC721 mint fixture with no financial promises or Energy effects.
- `DroidMissionAccountLab`: local wallet/mission experiment that pins both fixture runtime hashes and chain 31337 in constructor and every authority path. This cannot deploy on Monad 143 as written.
- `test/DroidMissionAccountLab.t.sol`: deterministic/adversarial cases and 256-run reserve fuzz test.
- `scripts/test-droid-mission-flow.mjs`: creates its own loopback-only, disposable Anvil, checks client and chain identity, generates fresh test keys in memory, funds them only via the local VM and destroys the node afterward. No external RPC argument, secret loading, real owner key, public-chain fork or key output.

## Holder consent and deterministic execution

1. **Review (future UI):** show identity/account, exact collection/adapter, capability, runner, reserve, total/day action caps, expiry, recipients and fees. A future validated model draft can populate a proposal but never submit or authorize it.
2. **Launch:** current owner submits `launch(limits, expectedNonce, expectedEpoch)`. Nonce and epoch bind against replacement/transfer races. The launch event records exact limits, owner, runner and mission commitment. Only one mission is active in this experiment; relaunch replaces it.
3. **Prepare/simulate:** the local driver reads current state and runs the exact typed call as the runner via `eth_call`. Its evidence hash is a correlation commitment, **not on-chain proof of simulation**. Production simulation validation, durable records and fail-closed worker integration remain unimplemented.
4. **Execute:** the appointed runner calls only `executeFreeMint`. Contract checks chain, exact target/parent code, owner, epoch, grant identity, nonce, start/expiry, short preparation deadline, nonzero evidence commitment, total/day caps and reserve. It constructs the fixed mint call internally with zero native value and no caller-selectable calldata or recipient.
5. **Verify:** native account balance must be unchanged, its NFT count must increase by exactly one, and the returned NFT must belong to the account. Owner and epoch are rechecked after callbacks. State updates and external mint revert atomically on failure. Audit event includes mission, nonce, runner, authorizing owner, mission/evidence commitments and minted token.
6. **Stop/recover:** current owner can cancel and withdraw native currency or the fixed minted NFTs. Runner permissions never include withdrawal. A below-reserve owner withdrawal causes subsequent runner actions to fail. Cancellation requires an owner transaction; chat saying “stop” alone cannot pretend the on-chain grant has been revoked.

Limits: fixed **zero native value per mint**; at most 20 actions per grant; explicit UTC-day action cap; maximum seven-day expiry horizon; explicit native reserve in wei; preparation valid for at most two minutes. A UTC-day counter is not a rolling 24-hour window. Owner-approved replacement starts a new grant's counters. Owner-directed withdrawals are not constrained by automation reserve policy. Generic paid-action budgets, shared cross-mission budgets, ERC20 spending, DEX/marketplace routes, slippage, floor verification and exit policies are not implemented.

There is no arbitrary CALL/delegatecall entrypoint, Permit/Permit2, ERC20 allowance, NFT operator approval, privileged project withdrawal, upgrade hook or unrestricted session signer. The runner is a normal test signer that can call only the constrained method, not an LLM with wallet keys. Receiving test native funds does not create permission.

## Explicit limitations

- Parent burn can strand assets: fail-closed denial is not asset recovery. Unsafe self-custody/cycles, wrapping, unwrap, listings, World/holder identity, Trait Lab burn handling and recovery require a production lifecycle design.
- Code-hash checks constrain these exact non-proxy fixtures; they are not a general proxy or marketplace risk engine.
- Evidence hashes do not prove simulation, freshness of marketplace data or independent approval. The local runner actually simulates; no production executor exists.
- No shared scanner, scheduler, queue, model-to-mission parser, persisted grant repository, mission review UI, user notifications, trading adapter or free-mint discovery is wired.
- Local events and receipt output demonstrate reconstructable actions, not a deployed durable activity/indexer system. Node state is discarded after the test.
- No Energy charges/rewards, trait changes, portfolio pricing, existing balance migrations, production environment changes or NFT custody changes.

## Verification and reproduction

```sh
npm run test:droid-missions
npm run test:droid-mission-flow
```

The new workflow steps run these in CI using the existing pinned Foundry installation. The initial isolated flow passed 12 local signed transactions: fixture deployments and mint, direct Droid funding, owner launch, separately signed runner execution, cancel/relaunch, A→B transfer, new-owner NFT withdrawal and B→A transfer. The runner remained denied after the round trip. **50 local test native units remained in the Droid account; real MON spent = 0.** No test deployment is a production funding destination.

Baseline existing V2/ASSIST contract suite: 34 passed before changes. Mission tests cover no grant, NFT-approved non-owner, wrong runner, expiry/start, total/day caps, reserve, replay, replacement, invalid parameters, cancellation, current/old owner, same-block A→B→A, burn/remint, changed code, missing evidence, no arbitrary/value calls, no runner withdrawals, mainnet rejection, reentrancy and callback round-trip rollback. Passing these tests is not a security audit or a solution to the real collection's epoch limitation.

Final local verification: **26 mission contract tests passed**, including 256 reserve fuzz cases; the final formatted artifacts passed the 12-transaction isolated flow. TypeScript, ESLint, optimized webpack production build, ASK/provider (30), ASSIST JS (52), website, roster/UI (19) and Trait Lab (7) regressions passed. Existing optional Privy Stripe/Farcaster dependency warnings remain. There are no rendered UI changes in this slice; the current preview's ASK behavior is preserved, not visually reworked or claimed as a live mission runner.

## Next implementation gates

1. Decide the **production ownership/revocation model** before final autonomous wallet design; do not deploy this laboratory.
2. Add versioned model-output mission drafts and a review UI with missing-field clarification; proposals have no authority. Research and ASK remain available while financial launch is blocked.
3. Implement final account/capability grant storage and explicit owner launch/cancel transactions against the approved lifecycle model.
4. Add deterministic builders, exact-account simulation records, shared opportunity ingestion and a bounded worker queue. Resume/retry paths must be idempotent and recheck canonical authority.
5. Start a separately authorized fixed/free-mint canary. Then review paid mints, NFT purchases/sniping and speculative token modules individually, with native/ERC20 caps, reserve, reliable floor data, route restrictions and exit policy tests.

Until those gates are satisfied, the preview remains **ASK**, not “agent deployed.”
