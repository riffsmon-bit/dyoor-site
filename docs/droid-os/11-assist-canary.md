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

Route: `/droid-os/assist`, gated by the existing Droid OS preview switch. The main cockpit remains read-only.

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
- Read-only preparation and session tests cover code/owner mismatch, nonce, expiration, gas, unsupported fields, calldata suffixes, receipt spoofing and reorgs.
- Local fork rehearsal of deployment → activation → mint → owner withdrawal passed.
- A second rehearsal started from the **actual deployed registry** at block 102522091 and passed local activation, mint and withdrawal. The pinned account address/runtime fixture comes from that rehearsal; no rehearsal transactions were broadcast publicly.

Commands: `npm run test:droid-assist`, `npm run test:droid-v2`, `npm run test:droid-v2:fork`, `npm run test:droid-assist-flow`. Public RPC fork tests are manual; deterministic tests run in CI. Website, Droid OS UI, World/Trait Lab regressions, TypeScript, lint and production build remain release gates.

## Explicit limits and remaining blockers

Do not deposit valuable assets. Burning the parent NFT or creating an ownership cycle can strand custody. This isolated immutable test wallet cannot later be upgraded into the final autonomous wallet. V1 assets remain untouched; migration would need a separate owner decision.

There is no autonomous trading, DEX routing, third-party mint adapter, NFT sniping, AI authority, paid research, Energy earning/spending, or background executor. No new financial authority is derived from traits or Energy. The real collection's missing transfer-lifecycle epoch still blocks the specified delegated-grant revocation model; see report 10. Independent security review, durable preparation records and additional adversarial/integration testing are required before broader financial use.
