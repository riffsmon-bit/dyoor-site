# Opt-in control receipt — local implementation and compatibility

September 6, 2026. The user approved proceeding with investigation/build of the opt-in wrapper design described in report 14. **That approval is not a public deployment, real NFT deposit, collection-validator change or permission to activate financial autonomy.** All implementation and custody mutations in this slice are local test VM operations. The preview still runs ASK only.

## Implemented model

Original Droid identity remains `(143, Season2, tokenId)`. The receipt is a separate control instrument, not a replacement collection pretending to be Season 2. A future application must record the selected wrapper and account version explicitly, never infer authority from arbitrary wrapped NFTs.

| State | Original NFT held by | Account owner authority | Delegated mission authority |
| --- | --- | --- | --- |
| Never wrapped | Original holder | No new account exists | None |
| Wrapped | Receipt contract | Current receipt `ownerOf`, only with verified original custody | Current owner plus exact receipt epoch and bounded grant |
| Receipt transferred | Receipt contract | New receipt owner immediately | All prior grants invalid, including A→B→A |
| Unwrapped | Current receipt owner receives original | Fresh original `ownerOf`, owner transactions only | Disabled |
| Rewrapped | Receipt contract | Current receipt owner | New epoch; fresh launch required, same account/history |

The receipt increments a persistent epoch on mint, every transfer (even A→A), and burn. Unwrap burns the receipt internally without clearing that epoch. Rewrapping reuses the existing account. Old grants cannot revive. Raw NFT transfers while unwrapped do not have an epoch; therefore delegated launch/execution is unavailable in that state. Fresh current-owner withdrawals remain possible for supported assets received after unwrap.

## Contract/module boundaries

All source is in `contracts/droid-os-mission-lab/`:

- `DroidMissionAccountCoreLab`: shared local-only reserve/cap/nonce/cancellation/mint/withdrawal logic extracted from the original fixture account. Its 26 prior tests remain. The original `DroidMissionAccountLab` still uses the pinned epoch fixture and is not repurposed as the wrapper wallet.
- `wrapper/DroidControlReceiptLab`: ERC721 control receipt, explicit owner deposit, authenticated original-NFT receiver, original custody validation, epoch, account mapping, guarded unwrap and metadata URI read-through.
- `wrapper/WrappedAccountFactoryLab`: fixed creator authorized only by its immutable wrapper. Separating creation avoids embedding oversized account creation code in the receipt runtime.
- `wrapper/WrappedMissionAccountLab`: binds to the configured wrapper/factory, checks wrapper code identity and original custody, resolves receipt or raw-NFT authority by state, and disables delegated operations outside wrapped state. It reuses the same fixed free-mint-only execution core.

Every concrete lab constructor and security-sensitive execution path requires chain **31337**. Source does not deploy on Monad 143 as written. No public deployment script, production address, upgrade hook, owner-key loading, generic execution path, token allowance, project withdrawal or admin seizure is added. This is a custom control/account experiment, not a claim of ERC-6551 compatibility or the final production wallet.

The initial combined receipt/factory exceeded the standard 24,576-byte runtime limit (27,126 bytes). It was split rather than tested with a relaxed code-size limit. A unit test asserts receipt, factory and child each stay below EIP-170. Constructor initcode also remains within the standard limit; no chain deployment limit is overridden.

## Actual Season 2 transfer compatibility: pull failed, owner push passed

The first local fork attempt approved the wrapper and had it call `safeTransferFrom(owner, wrapper, tokenId)`. The deployed validator at `0xA000027A9B2802E1ddf7000061001e5c005A0000` rejected this unlisted operator with selector **`0x1de5204e`**. The failure occurred inside `validateTransfer`, before the receiver. This is retained as a negative fork regression, not hidden as a passing wrap test.

The implemented route instead asks the **actual holder** to call the original collection directly:

```text
Season2.safeTransferFrom(holder, approvedWrapper, tokenId, abi.encode(WRAP_INTENT))
```

`WRAP_INTENT = keccak256("DYOOR_LOCAL_WRAP_V1")` in this laboratory. The trusted original contract's receiver callback must identify the holder as both sender and operator, carry the exact explicit intent payload, and show that original custody has already reached the wrapper. Approved operators cannot opt in on someone's behalf. Empty/wrong payloads, unsolicited safe transfers, forged callbacks and duplicate receipts fail atomically. This route needs **no token approval** and no validator configuration change.

After those checks the wrapper creates/reuses the account and safely mints the receipt to the holder. A rejected receipt receiver rolls back the entire original deposit and account creation. No financial authority is created by wrapping or funding: a separate holder-signed launch transaction is required.

The pinned Monad fork uses block **102588530**, exact Season 2 runtime hash `0x2baa62e8fad053a2b59e10eb8dbfc9bbb8ef98c93a55a1114ff7776226ae15fd`, real token 11 and its validator. The positive test switches only the **local VM** to chain 31337 to accommodate lab guards; it is not a final chain-143 deployment/gas/signature test. It exercises the real NFT's owner-initiated deposit and return without changing validator rules. Parent ownership and metadata URI are restored afterward in the VM. No public state is written.

## Exit and asset safety

- Only current receipt owner may unwrap. NFT-approved operators and the runner cannot unwrap, withdraw, cancel or launch as the owner.
- Unwrap is denied until **native balance and the fixed test-mint NFT balance** are zero. This is explicitly not proof that all conceivable ERC20/NFT/ERC1155 assets are absent. Arbitrary assets and their recovery are not implemented by this free-mint lab; do not deposit them.
- The separate drain-then-unwrap sequence can be griefed by third-party dust deposits. A dedicated regression reproduces this limitation. A bounded atomic asset-recovery/exit design is required before production; fail-closed refusal is not a complete exit guarantee.
- Unwrap burns the receipt and returns the original atomically. Original-receiver failure restores receipt and custody. Authority reads/actions during deposit/unwrap callbacks fail closed.
- Parent burn cannot be invoked by the receipt holder while wrapped, and the wrapper has no parent-burn, approval or arbitrary-call method. Once unwrapped, raw owner can burn; later/unsupported deposits can still be stranded. That is not claimed solved.
- Receipt transfers into the wrapper or any known child account are rejected. Unknown external contracts, cross-system custody cycles and incompatible receivers require further production review.
- Unsolicited **unsafe** ERC721 `transferFrom` cannot be rejected by a recipient. Such a deposit has no receipt and no reliable authenticated original sender available to a recovery method. No admin “rescue” authority is invented. This remains a release/UX/recovery limitation.
- Mission execution remains one exact free test minter, zero value, receipt-epoch authorization, caps, reserve checks and receiver/account postconditions. ERC20 trading, marketplace purchases, prices and yield do not exist here. Simulation commitments remain audit references, not on-chain proof of simulation.

## Existing-system compatibility — production gates

| Existing system | Verified/inspected consequence | Required work before public opt-in |
| --- | --- | --- |
| V1 wallet | Fork confirms `owner()` becomes the wrapper while wrapped; V1 code and balance do not change; unwrap restores original-holder authority | Explicit V1 inventory/migration/recovery UX; no automatic asset move. External V1 approvals remain a separate risk |
| Reroll/Trait Lab | Server current-owner checks still see original NFT owned by wrapper | Trusted receipt-aware identity adapter and transfer-proof validation, preserving fail-closed rules. No blanket acceptance of wrapper claims |
| ASK training | Existing owner reader and challenge transfer scan use original Season 2 ownership | Receipt-aware epoch-bound challenge protocol and private state ownership-era policy; existing sessions must not inherit new authority |
| dYØØR World/holder roster | Original balance/ownership-based discovery does not automatically credit receipt holders | Index receipts for discovery, verify canonical custody/owner for authorization, avoid double credit |
| Metadata | Receipt reads original `tokenURI`; original contract URI remains unchanged | Render current metadata in app; wrapper listing/collection identity and marketplace policy need separate review |
| Energy | Current ledger remains non-monetary and wallet-scoped | No conversion into wallet funds, gas or authorization; any receipt-aware entitlement change needs explicit tests |
| Deployed ASSIST canary | Immutable separate wallet, unchanged | Display versioned accounts; never silently replace its address or advertise an upgrade |

Receipt-aware production services were **not** switched to an unreviewed wrapper address. No operator roles, signing keys, secrets, domains, reroll metadata, Energy records, collection settings or original account balances were changed. Do not enable real deposits until the compatibility and recovery gates are met.

## Testing

```sh
npm run test:droid-missions          # original core + wrapper unit/fuzz tests
npm run test:droid-mission-flow     # original disposable signed local flow
npm run test:droid-wrapper-flow     # owner deposit → launch → runner → transfer → exit → rewrap
npm run test:droid-wrapper:fork     # explicit public READS, all mutations in local VM
```

The signed Anvil harness uses its own loopback port, checks Anvil and chain ID, generates test-only keys in memory, and destroys the node afterward. It does not accept public RPC overrides, load real owner keys, or call AI. Wrapper flow verifies the original NFT is restored, account address persists, old grants stay invalid after rewrap, and the holder can recover supported assets. Gas figures are local test evidence, not a Monad deployment quotation.

Final local results: **50 unit tests passed** (26 existing mission-core and 24 wrapper), including 256-run reserve and 256-run receipt round-trip fuzz cases. **Two pinned Monad-fork tests passed**: the positive owner-push lifecycle and the negative unlisted-pull-operator regression. The original 12-transaction and new 17-transaction signed Anvil flows passed; the wrapped flow preserved 50 local native units during the mint and returned them through an owner-authorized withdrawal before unwrap. Real MON spent and public deployments were zero. TypeScript, lint, optimized webpack build, ASK/provider (30), ASSIST JS (52), V2/ASSIST contracts (34), website, roster/UI (19), and Trait Lab (7) regressions passed. The build retained only the previously observed optional Privy dependency warnings. No rendered application UI changed in this slice.

Passing tests is not an independent security review. The positive fork test is compatibility evidence under the documented local-chain setting, not authorization to deploy or a claim that the mainnet lifecycle is production-safe.

## Next stage

Build receipt-aware read-only identity/discovery and a versioned mission-review flow, with explicit wrapper custody disclosure. Keep real launch disabled until protocol/account review, asset recovery, original/V1 migration guards, canonical receipt authorization, durable simulation/execution records and exact production artifacts are complete. A later owner-approved zero-value canary precedes broader NFT or token capabilities. Current chat remains ASK; nothing says “agent deployed” until an actual authorized launch is confirmed.
