# Owner-approved ASSIST canary — Monad 143

September 6, 2026. The user approved mainnet testing, an opt-in new wallet address, and ASSIST rather than autonomous execution for the first canary. This is an isolated, fixed test for **Season 2 Droid #11**, not the final autonomous account and not an independently audited production release.

## Actual deployment

- Registry: `0x7918438f0E03C759cc3898543958a844FB63ce43`
- Test badge: `0x5eEb50Fa8C2bD1bAeAB53CAf82A56d952be2f681`
- Predicted account: `0xc3380f0d3a6DC649f92fBdE30aD81ECC26422f5C`
- [Deployment transaction](https://monadscan.com/tx/0xf18fd5910b5e3fae53fd8bb414eefa71dd1419aca4838e2546b65d75980fb5e5), block **102522091**.
- Actual fee **0.49270896 MON**: 4,830,480 gas charged at 102 gwei. Registry constructor deployed the badge in the same transaction.
- Registry and badge both returned Sourcify **exact_match** verification. Compiled with Solidity 0.8.24, Cancun, optimizer 200.
- At deployment, `account()` was zero. The agent did **not** activate an account or mint on mainnet. Those approvals are left to the connected current owner in the preview.

Public launch constraints and the receipt are in `deployments/`. The fixed deployment script consumed only the existing deployer credential, verified its address, pinned chain, nonce, bytecode hash and a 0.6 MON maximum constructor budget. It did not change or publish a secret. **Do not rerun to create another deployment.** No V1 assets, collection roles, transfer validator or existing metadata were changed.

## Preview workflow

Route: `/droid-os/assist`, gated by the existing **build-context-filtered** Droid OS preview switch. Netlify runtime functions need not expose build-only environment variables; the route uses the explicitly inlined constant from `next.config.mjs`, like the existing cockpit. Production/branch contexts cannot enable it. The main cockpit remains read-only.

**Hosted wallet connection blocker observed at 2026-09-06 17:34 UTC:** Privy returned a `frame-ancestors` policy permitting preview #25, dyoor.fun, www.dyoor.fun and localhost:3200, but not preview #29. The browser blocked its embedded-wallet initialization document and the connect button remained unavailable. Add only `https://deploy-preview-29--dyoor.netlify.app` under Configuration → App settings → Domains → Allowed origins, preserving existing restrictions, then reload. No management credential is available in the local project; the dashboard owner must make this change. Do not disable the allowlist, use a broad hosting wildcard, bypass wallet warnings, or rotate keys. [Official configuration instructions](https://docs.privy.io/recipes/dashboard/allowed-domains).

The hosted route and layout were verified after the route-gate fix, with no hydration errors. Real Privy connection and owner-signed mainnet activation/mint remain **unverified and pending this domain configuration**. Mocked-wallet tests do not prove the external Privy integration works.

Follow-up: the owner added preview #29; a subsequent public header check confirmed its origin is allowed. A real mouse click on the hosted Connect button opened the Privy wallet chooser, with no intercepted clicks or browser errors. The user reports connecting with Backpack on mobile. End-to-end mainnet activation/mint remains unverified.

Network UI correction: the old Switch to Monad button was unconditional and did not establish that the wallet was on the wrong chain. It now appears only when the selected provider explicitly reports a different chain. The page displays the wallet name and observed chain, recognizes hexadecimal/decimal 143, and rechecks on provider chain/account changes and return-to-app focus/visibility. Refresh invalidates old prepared reviews. Unknown/mismatched networks continue to block financial preparation; no fallback provider or automatic switch was introduced.

1. Connect the current owner of Droid #11; switch to Monad 143 if needed.
2. Review activation. Inspect target, zero MON value and quoted gas ceiling. Explicitly acknowledge mainnet gas, then approve in the wallet.
3. Wait for the canonical receipt and expected registry event. Two additional blocks are required before UI confirmation.
4. Simulate and review the fixed free badge mint. Confirm the new transaction in the wallet.
5. Verify the account emitted `AssistMintExecuted` and owns the badge. No automatic retry or financial reward occurs.

Gas is paid by the owner wallet. **No account prefunding is necessary.** The wallet's final fee settings determine cost. This badge is a test collectible, not a claim on value or Energy. The public badge contract permits one free badge per calling address; the account's only mint path targets this exact badge.

## Authority and transaction boundaries

`DroidAssistCanaryRegistry` hardcodes chain 143, the verified Season 2 runtime hash, token 11 and the badge. Only the current `ownerOf(11)` may opt in. The CREATE2 account is a separate opt-in address, not a replacement for the existing canonical V1 account.

`DroidAssistAccountCandidate` checks canonical owner on every sensitive call. It has typed owner-only custody withdrawals and one fixed zero-value `mintCanary(expectedNonce, deadline, evidenceHash)` action. No relayer, session grant, executor, arbitrary call, delegatecall, upgrade mechanism or AI signer is present. A fresh owner transaction is legitimate after an A→B→A return; no delegated grant exists to revive.

Mint enforcement includes account nonce, short deadline, exact badge runtime, unchanged current owner after the call, badge count and recipient, and unchanged native balance. The UI validates schema/code identity, exact selector and arguments, gas bounds, current ownership, simulation and pending-request state. Unexpected transaction fields, including authorization lists, are rejected. The same selected provider is used for final checks and the explicit wallet request.

Simulation is an exact account-specific `eth_call` plus the fixed contract's postconditions, **not a generic state-diff service**. The evidence hash commits the preparation inputs for audit; it is **not cryptographic proof that a simulation happened**. A current owner calling the contract directly can bypass UI simulation. This is not suitable evidence for delegated execution.

## Recovery and audit

Pending intent is persisted before the wallet prompt. An unknown wallet response blocks retries; the user can recover the exact transaction hash from wallet activity. Receipts must match sender, target, zero value, calldata, canonical block and the expected contract event. No automatic resubmission occurs. Missing, unconfirmed or reorged receipts remain pending.

On-chain events durably record owner, account/action, nonce and preparation evidence. Public preparation/receipt records are also kept in a bounded local browser history. This is **not** a production audit database or cross-device recovery service. Do not clear an uncertain pending record until wallet activity has been checked.

## Verification

- 34 V2 Solidity unit tests, including two 256-run fuzz cases.
- Six real-collection Monad-fork tests covering custody, ASSIST and delegated-authority counterexamples.
- 38 read-only preparation and session tests cover code/owner mismatch, nonce, expiration, gas, unsupported fields, calldata suffixes, receipt spoofing, reorgs, observed wallet-network diagnostics and the build-filtered preview gate.
- Mocked-wallet browser tests passed desktop/mobile overflow checks, explicit consent, read-only preparation, cancellation, unknown-result recovery across reload and successful mint receipt reconciliation. Zero public transactions; no browser hydration errors in the clean build. Screenshots were visually reviewed at 1440px and 390px. Reproduce with a local preview on loopback port 3204, an isolated headless Chrome on 9224 and `node scripts/test-droid-assist-ui.mjs`.
- Local fork rehearsal of deployment → activation → mint → owner withdrawal passed.
- A second rehearsal started from the **actual deployed registry** at block 102522091 and passed local activation, mint and withdrawal. The pinned account address/runtime fixture comes from that rehearsal; no rehearsal transactions were broadcast publicly.

Commands: `npm run test:droid-assist`, `npm run test:droid-v2`, `npm run test:droid-v2:fork`, `npm run test:droid-assist-flow`. Public RPC fork tests are manual; deterministic tests run in CI. Website, Droid OS UI, World/Trait Lab regressions, TypeScript, lint and production build remain release gates.

## Explicit limits and remaining blockers

### Owner-only badge withdrawal follow-up

Read-only mainnet inspection confirmed the canary is activated and badge #1 belongs to the Droid account. The fixed test-badge contract had `totalMinted = 1` and `hasMinted(account) = true`. The preview now offers step 03, **Return the test badge**, using the existing account method; no new contract or role change is required.

The builder accepts no asset/token/recipient input. It can prepare only `withdrawERC721(fixedBadge, currentOwner, 1)` on the pinned account, with zero attached MON. It independently verifies current canonical owner, contract code/bindings and badge custody, performs an exact `eth_call`, bounds the gas quote, and rechecks immediately before the owner wallet request. The review explicitly displays badge contract, ID and destination. Review state is discarded on a changed wallet/network, including a change while preparation was running.

Receipt acceptance requires the exact submitted envelope, canonical confirmations, the account `Withdrawn` event (owner/asset/recipient/token ID/type/nonce), the badge `Transfer` event, and `ownerOf(1)` at the receipt block. Missing or unexpected evidence stays unresolved; it is never automatically retried. Current badge location is displayed separately from a verified withdrawal receipt.

The existing withdrawal method does **not** take a nonce or deadline argument. Review expiration and observed action nonce are pre-submission checks, not on-chain expiry guarantees. Normal owner transaction authorization, transaction nonce, canonical ownership checks and NFT custody checks remain on-chain. The preparation hash is a local audit commitment; this withdrawal contract does not emit that hash or prove a simulation ran. No generic simulation state-diff coverage is claimed.

Validation: 52 preparation/session tests pass, including 14 withdrawal-specific cases/groups. `node scripts/test-droid-assist-withdraw-flow.mjs` passed against the actually deployed account/badge on an isolated fork at block 102541084: non-owner rejected, exact prepared withdrawal executed locally, both audit/Transfer events verified, badge reached the owner, action nonce advanced, and repeat withdrawal failed. This script uses only local impersonation, never a key or public transaction. Mainnet withdrawal remains for the owner to approve in the preview.

Follow-up verification: the exact withdrawal also passed a read-only mainnet simulation (zero MON attached; no submission). Isolated desktop/mobile browser QA passed activation/mint/withdrawal review, cancellation, uncertain-request recovery, receipt handling and repeat-withdrawal disabling, using only mocked wallet requests. The 390px withdrawal review was visually inspected. The harness now clears only its dedicated localhost mock storage between runs and waits through reload/body and enabled-button transitions. Hosted step 03 is present and deployment/website checks passed for implementation commit `9558e38`.

Do not deposit valuable assets. Burning the parent NFT or creating an ownership cycle can strand custody. This isolated immutable test wallet cannot later be upgraded into the final autonomous wallet. V1 assets remain untouched; migration would need a separate owner decision.

There is no autonomous trading, DEX routing, third-party mint adapter, NFT sniping, AI authority, paid research, Energy earning/spending, or background executor. No new financial authority is derived from traits or Energy. The real collection's missing transfer-lifecycle epoch still blocks the specified delegated-grant revocation model; see report 10. Independent security review, durable preparation records and additional adversarial/integration testing are required before broader financial use.
