# Atomic exit and receipt-bound mission review — local slice

September 6, 2026. Builds on report 15. No mainnet deployment, real NFT custody change, key access, secret change, production authorization change or autonomous financial activation. These contracts still require chain **31337**. Current hosted chat remains ASK-only.

## What changed

### Owner-authorized recovery and exit

`WrappedMissionAccountLab.exitToOwner(mintIds, expectedNonce, expectedEpoch)` authenticates the current receipt owner and wrapped state, cancels the active grant, increments the account nonce, transfers the supplied fixed-minter NFT IDs, and sweeps the complete native balance to that same owner. It then calls the fixed wrapper's account-only `completeAccountExit`. The wrapper rechecks account binding, receipt owner, epoch, custody and supported-asset emptiness before burning the receipt and returning the original. The account verifies the resulting raw owner, unwrapped state and exactly one epoch increment.

The exit has no runner access and no arbitrary recipient. A front-run native dust deposit is included in the sweep; the transaction is not bound to a stale native amount. Rejected transfers, incomplete/duplicate NFT lists, reentrancy, callback-driven receipt transfers and a failed original return roll back the whole transaction, including cancellation and nonce changes. The same account persists after unwrap/rewrap; old grants and old reviewed launches do not revive.

`recoverERC20(asset, recipient, amount)` uses vendored OpenZeppelin SafeERC20's fixed transfer selector. `recoverERC721(asset, recipient, id)` uses a fixed safe-transfer selector and checks the resulting owner. Both require the fresh canonical owner before and after the operation, increment the nonce, and run under the account reentrancy lock. Receipt operators and runners have neither permission. No approval, arbitrary calldata, generic call, delegatecall or administrator recovery authority is added. ERC20 events record the requested amount, not a guarantee about a non-standard token's actual balance effects.

### Receipt-aware local identity

`lib/droid-os/missions/local-authority.ts` accepts an operator/test-owned manifest, never an AI/user-selected wrapper. The executable signed harness constructs it solely from its own disposable deployments. No public manifest exists and chain 143 is explicitly rejected.

At one fresh block, the reader checks:

- Parent, receipt, account factory, child account and minter runtime hashes.
- Original custody in the receipt, current receipt owner, wrapped state and consistent nonzero epoch.
- Parent/hash, minter, factory-to-wrapper and child-to-wrapper bindings.
- Exact token ID, canonical account mapping and child wrapper-code hash.
- Account nonce, native balance and a stable block hash after the reads.

Evidence includes the original collection identity, receipt/account addresses, owner, epoch, nonce and block/hash. Revalidation rejects a different identity, transfer, round trip, nonce change, unwrapped state or reorg. It is not an indexer-owned authorization decision. It does not yet implement public receipt discovery or a deployed-contract manifest review process.

### Structured mission review and simulation

`lib/droid-os/missions/local-review.ts` accepts one closed, versioned schema: `FREE_FIXTURE_MINT`, exact runner, start/expiry, total/day action caps and reserve in decimal atomic units. Unknown fields, arbitrary transaction inputs, financial capabilities, invalid numbers and overflow fail closed. The experiment is bounded to 20 total actions and a maximum seven-day grant, consistent with the contract.

The review binds every rule to the verified collection/token/account/receipt, owner, epoch and nonce in a deterministic mission hash. Its builder constructs only the known account's `launch` call with zero transaction value. It performs a real account-specific `eth_call` from the current owner at the evidence block, decodes the result, and revalidates authority. The returned status is **OWNER_TRANSACTION_REQUIRED**, not launched or executing. This module has no signer, broadcast method, AI provider, market scanner or runner scheduler.

The disposable Anvil harness now uses that exact prepared transaction for its first owner launch. Preparing/simulating alone leaves `missionId` at zero. A separately signed runner transaction can subsequently perform only the fixed free test mint; replay, cancellation and receipt transfer are tested. This proves the local integration path, not a working mobile wallet popup or a live chat launch feature.

## What is deliberately NOT wired into production

No existing ASK, World, Trait Lab, Energy or roster authorization call site imports these local modules. Existing ownership rules and private training state are unchanged. The mainnet ASSIST wallet is unchanged. UI appearance is unchanged in this slice.

Before connecting a real receipt to these consumers:

1. Select and independently review exact public artifacts and an approved immutable deployment manifest. Local artifacts/addresses are not deposit instructions.
2. Introduce a versioned authority-proof protocol explicitly binding original identity, receipt, epoch, account and requested operation. Old ASK challenges must not be reinterpreted as receipt proofs or mission authorization.
3. Decide private-state ownership-era retention, preserve owner-private conversations, and test transfer revocation before and after asynchronous provider/storage work.
4. Add receipt discovery for rosters/World with canonical custody verification and no duplicate holder credit. Do not simply OR arbitrary receipt ownership into existing gates.
5. Adapt Trait Lab ownership checks while preserving every existing fail-closed guard and keeping metadata mutations separate from financial capabilities. Test saved rerolls and recovery.
6. Render exact mission limits and custody/V1 effects for holder review; request only the intended transaction after simulation and fresh checks. Persist review, simulation, authorization, receipt and execution audit records before any worker is enabled.

Only then should an explicitly approved zero-value canary move beyond local rehearsal. No chat text, training preference, Energy score or simulation hash itself grants financial authority.

## Remaining release blockers

- Atomic exit enumerates at most 100 **fixed-minter** NFT IDs, not all possible wallet assets. Missing IDs or a newly spammed NFT can still block supported-balance emptiness. Native dust grief is fixed; general NFT spam is not.
- Other ERC20/ERC721 assets require separate typed owner recovery. Unsupported/reverting/malicious tokens and ERC1155 recovery are not solved. Unknown asset absence cannot be proved by `knownAssetsEmpty`.
- Original NFT burn after unwrap can still strand remaining/later assets. Unsafe original deposits into the receipt have no authenticated sender proof; no admin seizure shortcut is added.
- V1 wallet authority becomes the wrapper during custody, as the fork test demonstrates. V1 inventory/recovery/migration must precede real opt-in; no existing assets were moved.
- Simulation is evidence, not a guarantee; local launch simulation is not a comprehensive asset-delta execution simulator. Audit references are not trusted simulation attestations.
- No DEX or marketplace adapter, memecoin trading, floor feed, NFT sniping, paid mint or durable autonomous worker is enabled.
- These tests are not an independent security audit. Pinned fork mutations occur only in the local VM, with its chain ID changed for lab guards; they do not establish final mainnet deployment behavior.

## Verification

Commands: `npm run test:droid-missions`, `npm run test:droid-mission-review`, `npm run test:droid-wrapper-flow`, `npm run test:droid-mission-flow`, `npm run test:droid-wrapper:fork`, plus ASK, ASSIST, website, Trait Lab, TypeScript, lint and optimized build checks.

Passed locally: **59** mission/wrapper unit tests (26 original core, 33 wrapper), **9** mission-review/identity tests, **2** pinned Season 2 fork tests, the **17-transaction** signed wrapper rehearsal and original **12-transaction** rehearsal. Contract tests include 256-run reserve, receipt-round-trip and failed-exit-callback fuzz cases. The wrapper rehearsal verifies a third party's one-wei deposit is swept with the owner's 50 local native units, leaving the account at zero and the original NFT back with its owner.

Existing regressions passed: ASK/provider **30**, ASSIST JS **52**, V2/ASSIST contracts **34**, website/Energy/World **71**, Trait Lab **7**. TypeScript and the optimized webpack build passed; the build retained only the previously known optional Privy Stripe/Farcaster dependency warnings. No rendered UI changed, so this slice does not claim a new visual/browser review.

Current contract runtime sizes: receipt **14,445 bytes**, factory **21,882**, account **15,739**. Receipt initcode is **42,338 bytes** before its 64-byte constructor arguments. Tests check both standard runtime and initcode limits without overrides. These measurements are not a mainnet deployment/gas quote.

ESLint and `git diff --check` also passed. The unrelated untracked Ascension read-only script was left untouched.
