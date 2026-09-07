# First real swap adapter — MON/USDC, local fork only

September 6, 2026. The user's “yeah do that” was interpreted as building the real adapter before another disposable deployment. This slice builds and tests a narrowly scoped route; it does **not** authorize or perform a public deployment, real funding, wrapping, trading, key access or production activation.

## Implemented

- `src/swap/KuruMonUsdcAdapterLab.sol`: internal Solidity library; router calls originate from the test Droid account. It creates exactly one route and no caller-selected recipient or calldata. There is no intermediate dYØØR custody wallet.
- `src/swap/DroidSwapAccountLab.sol`: separate **local integration harness**, bound to a selected control receipt and its owner/epoch. It is **not** the canonical account returned by the existing wrapper factory, not an upgrade to V1 or ASSIST, and not a deposit address for real assets. Construction and financial execution require chain 31337.
- `lib/droid-os/swaps/kuru-route.ts`: closed atomic-unit intent parser, exact route builder/validator, conservative slippage rounding, and fresh read-only venue inspection. Its inspection result always reports `executionAllowed: false` and unresolved blockers.
- `scripts/inspect-droid-kuru.mjs`: fixed public RPC, no signer/key/environment-file loading, no endpoint/transaction overrides. It verifies observed identities but never enables execution.

The harness supports **MON→USDC** and **USDC→MON** only. It is an owner-transaction ASSIST experiment, not an autonomous memecoin trader. No NFT marketplace/sniping adapter is implemented in this slice.

## Protocol boundaries

| Control | Enforced behavior |
| --- | --- |
| Owner | Current receipt control before and after each operation; original custody enforced by the receipt |
| Transfer | Policy binds owner plus epoch. A→B→A and unwrap invalidate it; fresh configuration required |
| Authorization | Owner transaction for every swap; no delegate runner, session key or AI signer |
| Replay | Exact account nonce/epoch and a deadline no more than 120 seconds away |
| Input caps | Up to 0.001 MON or 1,000 USDC atomic units (0.001 USDC) per action |
| Daily caps | Three actions total; up to 0.003 MON native inputs or 3,000 USDC atomic inputs per UTC day |
| Reserve | Owner-configured native reserve remains intact during swaps; explicit owner recovery is separate |
| Budget accounting | Requested inputs consume budget conservatively, even if some input is refunded; sales don't replenish spent budgets |
| Reconfiguration | Does not reset account-level daily counters |
| ERC20 allowance | Starts at zero, approves exactly the reviewed input, resets to zero within the same successful transaction |
| Effects | Measures actual native/USDC balance changes, compares output to router return and minimum, rejects excess debit |
| Simulation reference | Required audit correlation only; not proof that simulation ran |

Policy configuration grants no unattended authority. An owner may explicitly recover native/USDC holdings; operators and runners cannot. This harness is not a universal asset-recovery wallet and does not enumerate other holdings.

## Verified route and unresolved trust

The repository's router, MON/USDC market and USDC addresses match [Kuru's published mainnet addresses](https://docs.kuru.io/contracts/Contract-addresses). The typed call follows its [router interface](https://docs.kuru.io/contracts/Router). Public bytecode/storage observations are recorded in [the evidence file](./evidence/kuru-adapter-20260906.json).

At fork block **102612438**, both router and market use a 141-byte EIP-1967-style proxy. Their implementation slots point to different implementations. The TypeScript reader checks both proxy runtimes, both implementation slots, implementation runtime hashes, and USDC's proxy/implementation getter and runtime hashes at one fresh block; it checks the block hash again afterward. A changed/unknown identity fails closed.

**This does not solve the execution-time upgrade race.** A Solidity account cannot directly read another contract's arbitrary storage slot. The harness pins venue runtime hashes, which alone do not detect a changed proxy implementation. A fork regression deliberately changes the router's implementation slot while leaving its runtime hash unchanged. The read-only inspector detects the mismatch; no oracle/signer bypass is invented to pretend this is an on-chain guarantee.

Sourcify v2 `fields=all` requests returned 404/no match for the observed router and market implementations. That is not a claim that verified source is unavailable everywhere. Exact source/reproducible-build review, upgrade authority/configuration review, and full downstream dependencies remain pending. The fork trace includes Kuru's MarginAccount and its implementation; the inspector does not yet certify that complete graph. USDC issuer/admin controls remain a separate dependency risk.

Passing identity checks yields **OBSERVED_IDENTITY_MATCH**, not “safe.” No production financial path consumes this result as approval.

## Failures found and fixed during development

1. Initial compilation exceeded the compiler stack limit. Router-call construction and audit-event recording were split into small helpers; the existing compiler pipeline was retained without switching the project to via-IR.
2. The first reverse-route fork simulation reverted with selector `0xead59376`: it incorrectly marked the USDC input as native, causing the router to pass native value to a token-input market buy. The fixed route uses `nativeSend=false` for USDC input and `true` for MON input. Both Solidity and TypeScript builders now agree. No public transaction was attempted.
3. Existing simulation-only quote code rounded minimum output **down**. At tiny outputs, that can exceed the selected slippage (27 atomic units with 1% tolerance could become 26, about 3.7% lower). The shared helper rounds **up** instead; the existing quote endpoint now uses it. Broadcast/autonomy flags remain false.

## Actual fork result

Only in the local VM, a receipt-controlled test account was assigned 0.01 native units with a 0.009 reserve. Account-specific swap simulations used snapshots/reverts before exercising the actual calls:

- Buy: spent **1,000,000,000,000,000 wei** (0.001 MON), received **27 USDC atomic units** (0.000027 USDC).
- Sell: consumed those **27 units**, received **998,114,600,000,000 wei** (0.0009981146 MON).
- Final test-account native balance: **0.0099981146**, above reserve. USDC balance and account→router allowance: zero.

This round trip incurred a loss; it is not profit, a price feed, a forecast, or a memecoin sellability guarantee. Gas is excluded from those local account deltas because the owner transaction pays gas externally. The fork test switches the VM to 31337 for laboratory guards; it is not a final chain-143 deployment/signature/gas rehearsal. Real MON spent: **zero**.

## Verification and rollout

Commands:

```sh
npm run test:droid-missions      # Includes the new swap unit/fuzz tests
npm run test:droid-kuru          # Closed intent/route/slippage/inspection validation
npm run inspect:droid-kuru      # Public read-only fresh identity snapshot
npm run test:droid-kuru:fork     # Fixed public block; all writes in local VM
npm run test:droid-wrapper:fork # Existing wrapper regression, separate pinned block
```

The wrapper fork script now selects its own test contract explicitly so the two pinned-block suites cannot accidentally run against each other's state. Unit tests run in PR checks; public fork tests remain explicit, not background trading jobs.

Local results: **76** mission-lab contract tests, including **17** new swap tests; **4** swap fork tests; **2** existing wrapper fork tests; **6** route/inspection tests. Reserve and malicious-router/epoch-callback cases each include 256-run fuzz coverage. The swap harness runtime is **6,742 bytes** and creation code **7,944 bytes** before constructor arguments; standard size limits are tested without overrides.

Additional regressions passed: ASK/provider **30**, local mission review **9**, ASSIST JS **52**, website/Energy/World **71**, Trait Lab **7**, V2/ASSIST contracts **34**, and the existing **17-transaction wrapper** and **12-transaction original mission** signed Anvil rehearsals. ESLint and the initial standalone TypeScript check passed. The optimized build's final result is recorded separately below. No rendered UI changed; no new browser-interaction validation is claimed.

Before deployment: finish venue/source/upgrade policy review; decide the canonical wallet integration without silently issuing another replacement address; complete wrapper/V1 migration and recovery gates; add durable account-specific simulation/action records; then build the owner-review preview flow. Memecoin markets need additional explicit adapters/allowlists, token risk checks, reliable quotes, sell simulations and bounded position/exit policies. Autonomous capabilities remain disabled until separately tested grants enforce those rules on-chain.

Final validation: the optimized webpack build completed successfully, including its TypeScript pass and route generation. Only the previously observed optional Privy Stripe/Farcaster dependency warnings remain. `git diff --check` passed. External-drive build temporary storage was used; unrelated work, including the untracked Ascension read-only script, was preserved.
