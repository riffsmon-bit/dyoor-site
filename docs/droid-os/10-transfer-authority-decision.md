# Season 2 transfer authority: verified findings and decision gate

September 6, 2026. Read-only live inspection and local Monad-fork tests. **No production transaction, NFT movement, validator change, secret access or deployment.**
The statement above describes this investigation. The user subsequently approved owner-authorized ASSIST testing; its separate deployment is recorded in [11-assist-canary.md](11-assist-canary.md). These delegated-authority findings remain unchanged and autonomy remains blocked.

## Verified deployed source

The [Sourcify record](https://sourcify.dev/server/v2/contract/143/0x349D8eb480c92cF75371fbA5C6344A4d11b9103A?fields=all) reports exact creation/runtime matches for `DYOORSeason2SeaDrop`, Solidity `0.8.17+commit.8df45f5f`, London, optimizer enabled with one run. The collector independently compared both supplied runtime strings (recompiled and on-chain) with public Monad RPC bytecode at block **102511645**. All three match byte-for-byte:

`0x2baa62e8fad053a2b59e10eb8dbfc9bbb8ef98c93a55a1114ff7776226ae15fd` — 20,852 runtime bytes.

This is stronger than trusting a name, comment or selector list. It is not a new independent recompilation by this agent: Sourcify supplies the recompiled artifact. [Captured evidence](evidence/season2-verified-source.json) includes source hashes, compilation settings, ABI names, storage slots and deployment reference. `scripts/audit-droid-transfer-authority.mjs` reproduces the comparison using fixed public reads and fails on mismatched/unknown evidence.

The deployed top-level source has a 3,333 maximum supply and 610 airdrop reserve. The worktree's same-named source has a 5,555 maximum supply and direct mint phases. **That local file is not the deployed revision.** It was not replaced or deployed. Source lineage remains separate from the new custody candidate.

## Actual transfer path

The matched source shows:

- ERC721A `transferFrom` checks owner/approval, invokes a pre-transfer hook, clears token approval, updates balances and packed ownership, emits Transfer, and invokes an empty post-transfer hook.
- Packed ownership includes a timestamp, but its decoders are internal/private. There is no external transfer counter or ownership-timestamp getter in the deployed ABI. A separate contract cannot issue RPC-style raw storage reads during EVM execution.
- The pre-transfer hook invokes its validator only when **both** endpoints are nonzero: burns and mints skip validation.
- `ITransferValidator721.validateTransfer` is declared `view`; the live invocation is STATICCALL. The validator cannot persist an epoch or call a wallet that writes revocation state.
- **Descriptor mismatch:** `getTransferValidationFunction()` reports `isViewFunction = false` although actual invocation is static. The fork regression checks both facts. Integrations must follow bytecode behavior, not this descriptor.
- The collection owner can replace the validator. Checking only its current address does not prove it was never disabled and restored.
- No deployed derived hook adds Droid-wallet revocation. The preapproved OpenSea conduit is a transfer operator, not wallet execution authority or an epoch service.

## Reproduced counterexamples

`contracts/droid-os-v2/fork-test/MonadTransferRevocationFork.t.sol` pins the verified runtime hash. These diagnostic tests deliberately reproduce rejected designs; PASS **does not mean autonomy is secure**.

1. **Address-only grant revival:** a test-only permission probe accepts A, rejects it after A→B, then accepts the original permission again after B→A. It receives no revocation callback.
2. **Identical current storage:** after normalizing ERC721A lazy initialization and timestamp with an earlier same-block round trip, a second A→B→A leaves every recorded written collection slot equal to its starting value. Forge records six writes including duplicate slots; the validator records no writes. Transfers still emit logs. An invented epoch based solely on current owner/balance/approval/same-second timestamp is insufficient.
3. **Writable validator rejected:** replacing the validator *only in the fork* with a nonce-incrementing fixture makes transfer revert without recording an epoch. Changing the validator's own ABI cannot change the immutable caller's STATICCALL.
4. **Burn bypass:** with that locally installed validator, direct burn succeeds without invoking it. A transfer gate alone cannot protect funded accounts against direct parent burns.

The previous real-collection custody integration also passes: **five fork tests total**. Fresh current-owner transactions remain viable. Indexing is useful for cleanup but cannot replace final on-chain authorization. The same-block race must remain in scope.

## Decision before changing the authority model

New wallet addresses were approved; changing how NFTs transfer or who holds them was not. No inspected drop-in grant implementation satisfies the original strict transfer invariant.

| Path | What it permits | Tradeoff / remaining boundary |
| --- | --- | --- |
| Owner-approved ASSIST first | Prepare/simulate reviewed typed actions; current owner submits each transaction | No unattended execution; preserves existing NFT custody and transfer behavior |
| Investigate opt-in transfer gating | Potentially require active grants revoked before the NFT may transfer | Needs collection-validator configuration change and separate authorization. Admin disable/restore and burn bypass remain unresolved; NOT a solved design |
| Investigate opt-in wrapper / receipt | A new controlling receipt can expose an enforceable epoch | Original NFT moves into a contract; authority shifts to the receipt, revising the raw-S2-owner model. World, listings, burns, unwrap and recovery need review |
| Trust backend epoch/oracle | Simpler off-chain bookkeeping | Changes the absolute trust model; can miss/race transfers. Not an acceptable silent fallback |

Recommendation: advance a small **owner-approved ASSIST canary** without changing Season 2 custody. If unattended execution is required for the first canary, obtain an explicit choice to investigate a changed transfer/custody model. Neither wrapping nor transfer gating is preapproved or guaranteed safe.

There is no final V2 deployment address. The custody candidate remains undeployed research, not an upgradeable account or deposit destination. No grant was added merely to make a preview button functional.

## Reproduction

```sh
node scripts/audit-droid-transfer-authority.mjs
npm run test:droid-v2
FOUNDRY_PROFILE=monad_fork forge test --root contracts/droid-os-v2 \
  --fork-url https://rpc.monad.xyz --fork-block-number 102511645 -vv
```

Owner/admin impersonation and mutations occur only in Forge's local VM. No broadcast script or key input exists. The inadequate permission probe is confined to `fork-test/`, not deployable `src/`. This is an audit/test-only follow-up: no application UI, production routes, dependencies, wallet implementation, grants or CI activation changed this turn.
