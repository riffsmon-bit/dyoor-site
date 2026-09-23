# Opt-in V2 wallet: approved direction and custody candidate

Status: **research implementation; not deployed; not the final autonomous account.**
This describes the original custody candidate. A separate fixed, owner-approved ASSIST registry and test badge were subsequently deployed with explicit authorization; see [11-assist-canary.md](11-assist-canary.md). The test account is not an upgradeable/final autonomous wallet.
Decision recorded September 6, 2026: the user approved an opt-in V2 wallet with a new address per Droid and selected Monad mainnet as the eventual test target. Existing V1 wallets/assets must remain untouched unless an owner separately initiates migration. No wrapping, parent-NFT escrow, collection modification, role change or automatic asset migration was approved by this choice.

## Implemented foundation

`contracts/droid-os-v2/` is additive and separate from both live V1 and the local mint laboratory:

- `DroidOptInRegistryCandidate`: fixed chain 143 and Season 2 collection; explicit current `ownerOf` caller activates a deterministic CREATE2 account. No NFT-approved operator, indexer, session or project admin can opt in for an owner. Repeated activation returns the same account; NFT transfer does not change the address.
- `DroidCustodyCandidate`: immutable chain/collection/token binding, fresh canonical owner checks, direct native funding, typed current-owner native/ERC20/ERC721 withdrawals, reentrancy guard and indexed activity events/nonces. No project wallet sits in the funding path.
- No arbitrary execution, delegatecall, allowances, Permit, operator approvals, session keys, signature relays, capability grants, AI signer, upgrade admin or deployment script. No hidden mechanism can activate autonomy in this candidate.
- ERC20 transfer supports standard bool and empty return values, rejecting false/malformed responses. It does not certify malicious/rebasing/fee-token behavior. ERC1155 is not supported in this slice.
- Safe transfer of the controlling parent NFT into its own account is rejected. Unsafe transfer and indirect ownership cycles cannot be universally prevented by a receiving contract; burning, unsafe self-custody and unsuitable escrow ownership can strand funds. **These remain funding/release blockers, not solved safety guarantees.**

This is a custom factory candidate, **not a claim of ERC-6551 compatibility**. The existing standard registry/V1 remains authoritative for its own wallet. A candidate address must never silently replace it in readers. Final registry/implementation choice remains open; candidate addresses are not future production deposit addresses. The [ERC-6551 specification](https://eips.ethereum.org/EIPS/eip-6551) describes deterministic identity, account-interface requirements and ownership-cycle risks; merely deriving an address is insufficient for standards compliance.

An immutable owner-only custody account cannot later gain autonomous execution. **Do not deploy/fund this candidate as the promised final V2 wallet.** The purpose is to test opt-in, legacy compatibility and custody boundaries before freezing a complete implementation.

## Transfer authority: solved and unsolved

Direct custody transactions are authorized by the canonical owner *during that transaction*. A→B immediately rejects A and enables B. If the NFT returns B→A, a fresh transaction from A is legitimate. There are no persistent signatures, policies or grants in the candidate that can revive on that round trip.

This does **not** solve delegated authority. A grant tied only to an owner address can revive A→B→A. An indexer, API cache, backend owner watcher, wallet action nonce or simulation attestation cannot prove all transfers were observed. Nor can a new account simply assume it receives a callback on every transfer of the existing NFT.

At mainnet block **102511645**, public `eth_call` probes of Season 2 `ownershipEpoch(11)` and `explicitOwnershipOf(11)` both reverted with empty data. `getTransferValidator()` returned `0xA000027A9B2802E1ddf7000061001e5c005A0000`. The fork trace calls that validator with `STATICCALL`. This observed view-only path is not a writable transfer-epoch hook. No claim is made that selector probes alone fully reverse-engineer the collection.

Before enabling grants, prove a transfer-lifecycle primitive against verified deployed bytecode, including same-block round trips and callback races. If a solution would require changing the collection/validator, wrapping the NFT, moving the parent into escrow, or trusting an authority beyond the specified model, disclose that design change and obtain separate direction. Do not weaken the invariant to make deployment possible. Owner-approved custody can be tested without such grants; autonomous trading cannot.

## Migration / UI contract

Keep separate records for identity and account versions:

```text
Droid (143, Season 2, tokenId)
  V1 account: existing derivation, assets unchanged
  V2 account: not activated | activated at reviewed registry
  selected account: explicit user context, never an implicit asset move
```

Future preview integration must show:

1. Both versioned addresses and independently read balances; never combine them as one spendable balance.
2. Exact new account binding, code identity, registry/version and chain before presenting any funding action.
3. Owner opt-in as its own transaction; do not bundle NFT custody/approval or asset migration into activation.
4. Owner → chosen Droid account funding, with no central project balance.
5. Optional, explicitly reviewed per-asset transfers from V1; V1 address/history remain visible after migration. No blanket approvals.
6. Current owner and burn/escrow/cycle warnings before funding or using Trait Lab; existing fail-closed protections remain unchanged and must eventually include both wallet versions.
7. ASK as default. No autonomous toggle or claim that the current candidate supports future upgrades.

This turn deliberately adds **no UI funding button, live account address, environment variable or production activation**. Wiring a not-final account as if it were deployed would misrepresent custody.

## Verification

Commands:

```sh
npm run test:droid-v2
npm run test:droid-v2:fork
# Reproduce the recorded mainnet snapshot locally (requires archive RPC availability):
FOUNDRY_PROFILE=monad_fork forge test --root contracts/droid-os-v2 \
  --fork-url https://rpc.monad.xyz --fork-block-number 102511645 -vv
```

- 21 unit tests, including 256 withdrawal-accounting fuzz cases: deterministic addresses, opt-in authority, direct funding, current/old/contract owners, A→B→A without stored delegation, custody persistence, malformed token responses, NFT withdrawal, reentrancy, transfer during withdrawal, chain/code changes, burn/self-cycle rejection and absence of arbitrary/signed execution.
- 1 mainnet-fork integration test passed using the real deployed Season 2 NFT #11 and its live transfer validator: opt in locally, fund locally, withdraw as owner, transfer locally, deny old-owner withdrawal, permit new owner, return NFT, preserve account/address/activity and verify V1 balance/code and metadata URI remain unchanged.
- Recorded canonical owner at that fork: `0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6`. It is evidence at a block, not an authorization cache.
- Initial fork run failed inside the live transfer validator with EVM `NotActivated` under the copied Paris harness setting. Cancun execution resolved it; the candidate's compiler/test setting is now Cancun. The original mint lab remains unchanged. [Monad's official compatibility description](https://www.monad.xyz/announcements/how-monad-works) includes Cancun opcode support. This is a test configuration correction, not a production contract fix.
- Fork impersonation and balance provisioning occur **only inside Forge's local VM**. No private key, public transaction broadcast, real token movement or real MON expenditure is involved. Ordinary CI runs deterministic unit tests; the explicit fork command requires public RPC availability and is not silently skipped as a passing test.

Passing these checks is compatibility evidence, not an independent security audit or proof of full Monad transaction/gas semantics. Fork gas figures are not a deployment quote.

Regression verification for this slice also passed: the 37-test existing mint lab, its 13-transaction ephemeral flow, 6 local-console tests, 18 Droid OS UI/data tests, 61 website tests, 13 World/Trait Lab security regressions, TypeScript and ESLint. The production webpack build completed successfully using the documented external-drive workspace workaround. It still reports optional Privy imports for `@stripe/crypto` and `@farcaster/mini-app-solana`; no unrelated dependencies were changed. No rendered UI changed in this slice. GitHub execution of the added V2 CI step requires publishing these local changes; local results must not be presented as a new hosted deployment.

## Next gates

Follow-up inspection matches verified source to live runtime and reproduces the round-trip/static-validator limitations. See [the transfer-authority decision report](10-transfer-authority-decision.md); a new account address alone does not resolve them.

1. Settle the provable transfer-revocation design and final account/registry standard. Keep delegated execution blocked meanwhile.
2. Implement/review narrow capability modules, deterministic caps/reserve, adapter validation, simulation binding and durable execution records. Retest against real target bytecode, not mint fixtures.
3. Include V1+V2 accounts in burn, escrow, portfolio and migration safety handling before any funding UX is enabled.
4. Freeze exact deployment artifacts, review them independently, estimate mainnet gas, identify a bounded canary Droid/mint and deployer, and publish an explicit deployment manifest.
5. Only then deploy the reviewed mainnet canary, verify bytecode/identity, wire preview addresses, and start tightly bounded tests. User approval of a new address is not approval to hide unresolved custody/authority requirements.

No final V2 address, deployment hash, deployment cost or autonomous capability is available yet. Reroll metadata, Energy, achievements, V1, World and production secrets were not modified.
