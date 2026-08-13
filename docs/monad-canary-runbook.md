# Monad Droid Account canary runbook

Status: **OWNER DECISION REQUIRED — do not execute**

This is a future real-mainnet canary procedure for Monad chain 143. It is not approval to deploy infrastructure, activate an account, fund an account, transfer an NFT, or enable a feature.

## Owner-filled fields

| Field | Value |
| --- | --- |
| `MONAD_CANARY_TOKEN_ID` | UNSET |
| `MONAD_CANARY_OWNER_A` | UNSET |
| `MONAD_CANARY_OWNER_B` | UNSET |
| `CANARY_MAX_MON_FUNDING` | UNSET |
| `CANARY_APPROVED_TEST_ASSET` | UNSET |
| Infrastructure deployment approval reference | UNSET |
| Canary approval reference | UNSET |

Select a project/operator-owned D.Y.O.O.R with no valuable existing Droid assets, known metadata and reroll state, and no community custody. Wallet A and Wallet B must both be project-controlled, independently secured, funded only to the approved cap, and verified on chain 143. Never select a community holder’s token without their explicit authorization.

## Entry gates

All must pass before step 1:

- a clean release commit and replacement artifact freeze are approved;
- all three immutable Monad artifacts pass independent review with no unresolved critical/high finding;
- the exact three deployment transactions are separately owner-authorized and confirmed;
- post-deploy source, bytecode, constructor, address, ownership, proxy, balance, and deterministic-account assertions pass;
- the canary token and both controlled wallets are approved;
- maximum MON funding and any test asset are approved;
- rewards, strategies, shared treasury, agent, and bridge remain off;
- Trait Lab and portfolio/indexer operators are available to observe the test.

## Procedure

1. Read `ownerOf(MONAD_CANARY_TOKEN_ID)` and confirm Wallet A.
2. Derive the counterfactual Droid Account independently through the canonical ERC-6551 registry and the collection facade; require an exact match.
3. Confirm the account has no code before activation, or document why it is already active and stop for owner review.
4. From Wallet A, submit the separately approved activation transaction.
5. Confirm receipt success, emitted account event, account address, deployed bytecode, token binding, chain ID 143, and current controller Wallet A.
6. Send no more than the approved minimal MON amount to the Droid Account.
7. Confirm the balance through at least two read-only sources and the HoodYØØR portfolio UI.
8. Execute one harmless, bounded owner-authorized call to an approved controlled receiver; record calldata, value, pre/post balances, event, and receipt.
9. Simulate the same authority path from a non-owner and require the exact authorization revert. Do not fund or broadcast a knowingly reverting transaction unless separately approved.
10. If a test asset is approved, deposit only its approved dust amount and verify exact token/chain/address/decimals and balance. Otherwise record `SKIPPED_NOT_APPROVED`.
11. Verify indexer/API/UI identity is `143:0x349D…103A:tokenId`, account address, owner, native balance, token balance, and `Value unavailable` where pricing is absent.
12. Verify Inventory and activity display without inventing values or mixing another chain/token ID.
13. Verify existing Energy display remains unchanged and non-financial.
14. Verify Trait Lab shows a clear fail-closed reason while the account is activated, funded, or asset discovery is incomplete. No burn/reroll should strand access.
15. Reconfirm the token has no valuable unrelated position, then—only under the explicit transfer approval—transfer the parent NFT from Wallet A to Wallet B.
16. Immediately require Wallet A owner execution and signature validation to fail.
17. Immediately require Wallet B to control owner execution and signature validation.
18. Confirm every Droid Account asset stayed at the same account address throughout the NFT transfer.
19. Transfer the NFT back only if the canary approval explicitly includes a return transfer; otherwise leave it with Wallet B and record the approved final state.
20. Record all transaction hashes, block numbers/hashes, addresses, calldata hashes, balances, events, screenshots, API responses, pass/fail results, and observers in a signed canary report.

## Pass/fail criteria

Pass requires every applicable assertion below:

- canonical and facade-derived addresses match;
- account bytecode and binding are exact;
- only current `ownerOf` controls the account;
- stale owner loses authority in the NFT transfer block state;
- new owner gains authority without a project admin action;
- assets remain in the Droid Account;
- no old session/agent authority exists;
- portfolio, Inventory, Energy, and activity remain chain-qualified and internally consistent;
- Trait Lab fails closed with an explicit user explanation;
- no unexpected balance, role, approval, event, RPC, or indexer divergence occurs.

Any discrepancy is a fail. Stop immediately, disable new UI-assisted activation, preserve evidence, and follow `docs/emergency-runbook.md`. Do not “continue to gather data” with more value at risk.

## Observation period

After a successful canary, observe for at least 24 hours; 72 hours is preferable when operationally practical. Inspect events, current-owner authority, UI/indexer consistency, RPC agreement, support reports, and Trait Lab behavior. Do not enable general activation, rewards, strategies, agents, or bridges when the timer expires. Each still requires a separate explicit owner approval.

## Activation recommendation

Use lazy activation. Normal holders pay their small activation gas. Limited HoodYØØR sponsorship may be offered only through separately budgeted campaigns with per-wallet and per-campaign caps, a total budget ceiling, and practical anti-Sybil controls. Never mass-deploy accounts for the collection.
