# Venue/security review and canonical-wallet integration

September 6, 2026 (local operator date; public observations extend into September 7 UTC).

## Decision

**Canonical local integration: implemented and tested. Public deployment and chat financial approvals: blocked, not enabled.** This is an engineering review with explicit limitations, not an independent security audit or a certification of Kuru/USDC. Passing tests does not make the candidate production-safe.

This work follows the request to finish venue/security review and canonical-wallet integration **before** wiring chat approvals or deploying. No owner keystore was opened, no secrets changed, no live transaction sent, and no V1/ASSIST account or NFT moved. The website's ASK, World, Energy, Trait Lab and existing deployed contracts retain their current behavior.

## Evidence and scope

- Public read-only Monad RPC: chain 143, `https://rpc.monad.xyz`.
- Expanded successful snapshot: block **102623374**, hash **0x860d1b543694b0eb978e1d24d6ae74c6ff2503ed7eb93a5e844b3914ed6b9bcc**. [Raw observations](./evidence/kuru-security-20260906.json).
- Kuru source reviewed at public repository commit **2060bb2736080c175d80d568bfdb6226bb5abd04**. Public source is **not** assumed to match deployed implementation bytecode.
- Kuru fork: block **102612438**. Original wrapper/S2-validator regression: block **102588530**. State changes exist only in disposable local VMs, with chain ID switched to 31337 for laboratory guards.
- Scope: fixed MON/USDC direct-router route; canonical local receipt account; owner-approved swaps; existing fixed free-mint runner. No memecoin market, aggregator program, marketplace/snipe adapter or financial runner grant is approved.

## Venue review findings

### 1. HIGH / RELEASE BLOCKER — exact Kuru implementation source not established

MonadScan marked the currently observed [router implementation](https://monadscan.com/address/0xf1635175914acf4db170395d524323225e1f1a04#code), [market implementation](https://monadscan.com/address/0x5e3446c600524be453bbcefd46a9e4c9be8899a0#code), [margin implementation](https://monadscan.com/address/0x351525073afa933720329756716fcf7d741e7ff0#code) and [vault implementation](https://monadscan.com/address/0x17eccb57f292d8e41ccf40432f91b6b8dcfe7a3c#code) **Unverified** during this review. Sourcify returned no match for router/market. These are observations of those services, not proof that matching source cannot exist elsewhere.

Runtime metadata advertises IPFS metadata CIDs for router (`Qme7K7GyXMAhXtC6eeWE4ZKnvzMW18d4pfsUz8y38Lv3BX`) and market (`QmSbTfkghMmgsHZpwiZfAdNKYWG36YVmENxd5D9QX4QRyX`). Retrieval attempts returned gateway 429 responses or timed out. No metadata was substituted or invented. A matching standard compiler input/dependencies/build is still needed to certify the actual implementation behavior.

The published [Router source](https://github.com/Kuru-Labs/Kuru-contracts-dex-public/blob/2060bb2736080c175d80d568bfdb6226bb5abd04/contracts/Router.sol) uses owner-authorized UUPS upgrades, configurable future market/vault implementations, batch upgrades of existing proxies, market pausing and downstream ownership transfer. Its swap pulls token input from the caller, uses registered markets, and returns output to the caller; its router-to-market approvals are a separate dependency from our account's exact temporary allowance. This explains the intended route and trust surface, **not** a byte-for-byte attestation of the live router.

The published [OrderBook source](https://github.com/Kuru-Labs/Kuru-contracts-dex-public/blob/2060bb2736080c175d80d568bfdb6226bb5abd04/contracts/OrderBook.sol) has an internal owner, owner-gated upgrades/pause/ownership transfer, and a trusted forwarder. Absence of a public `owner()` getter on the live market therefore does not imply absence of an owner. The current market's exact stored owner has not been certified from a matched storage layout.

Published [MarginAccount](https://github.com/Kuru-Labs/Kuru-contracts-dex-public/blob/2060bb2736080c175d80d568bfdb6226bb5abd04/contracts/MarginAccount.sol), [vault](https://github.com/Kuru-Labs/Kuru-contracts-dex-public/blob/2060bb2736080c175d80d568bfdb6226bb5abd04/contracts/KuruAMMVault.sol), and [forwarder](https://github.com/Kuru-Labs/Kuru-contracts-dex-public/blob/2060bb2736080c175d80d568bfdb6226bb5abd04/contracts/KuruForwarder.sol) code expose additional owner/upgrade/configuration boundaries. These public files were inspected as architecture evidence, not treated as verified implementations.

### 2. HIGH / RELEASE BLOCKER — execution-time upgrade race

Router, market, margin, vault and forwarder have EIP-1967-style implementation slots behind the same short proxy runtime. The inspector now pins observed implementation slots **and implementation code hashes** across these dependencies at one fresh block. That detects a changed snapshot, not a change occurring between inspection and inclusion.

The Solidity adapter still checks venue **proxy runtime hashes**, not arbitrary foreign implementation slots. Solidity cannot directly `SLOAD` another contract's storage. A passing RPC check or simulation hash is not an atomic guarantee; the fork regression explicitly changes the router's implementation slot while its proxy code stays unchanged.

No privileged signer/oracle override, unrestricted delegatecall module, or "trust the AI" exception was added. A defensible execution-time venue trust/upgrade strategy is required before a financial deployment. Merely removing the chain-31337 checks is prohibited.

### 3. HIGH / EXTERNAL TRUST — observed governance and downstream contracts

| Component | Observed public address / control |
| --- | --- |
| Router | `0xd651346d7c789536ebf06dc72ae3c8502cd695cc` |
| MON/USDC market | `0x065c9d28e428a0db40191a54d33d5b7c71a9c394` |
| Margin | `0x2a68ba1833cdf93fa9da1eebd7f46242ad8e90c5` |
| Market vault | `0x838c2d3fd4db5eb2f185cbe7697fbaace52b34d7` |
| Trusted forwarder | `0x974e61bba9c4704e8bcc1923fdc3527b41323faa` |
| Router/margin/forwarder owner | `0x8b736dce2071783fd9db0a423dad17cc8ed5788b` |
| Vault owner | Router address |

The observed owner contract reports Safe version 1.4.1, threshold **3**, and **5** owners. Its module enumeration returned empty with the terminal sentinel; the inspected guard slot was zero and fallback-handler slot nonzero. The reader pins the observed owner proxy, implementation, threshold, signer list, modules and guard/fallback slots. This does **not** certify signer independence, key custody, fallback-handler behavior, absence of every alternative authority, or a timelock. No enforced upgrade delay was established. Transitive dependency review remains incomplete.

### 4. HIGH / ASSET TRUST — USDC admin, pause and blacklist controls

Unlike the Kuru implementations above, MonadScan exposed verified source for the [USDC implementation](https://monadscan.com/address/0xbd520ea8cbb4f81b62aff3c3ffe7affd69800b6d#code) and [USDC proxy](https://monadscan.com/address/0x754704bc059f8c67012fed69bc8a327a5aafb603#code). The explorer's FiatTokenV2_2 source uses pause/blacklist checks around transfers and contains issuer/minter roles. Its verified proxy source exposes admin-only upgrade methods and a public implementation getter, using legacy Zeppelinos slots rather than EIP-1967. This was source inspection, not our own reproducible compilation.

Observed token admin: `0xc66bf3ef02d30e942bbab7f871d07b14d0ccc619` (no runtime code at the inspected block). Token owner, admin, pauser, blacklister, master-minter and rescuer are distinct concepts. Their observed values, decimals, pause state and venue-address blacklist states are now checked. A future account-specific preflight must also check the selected Droid and recipient, not just venue addresses.

Issuer controls can make a token transfer or exit fail; matching balances do not guarantee future recoverability. The wallet cannot neutralize token-level governance. The generic owner recovery path remains available independently of swap-route health, but it cannot make a paused/blacklisted token transfer succeed.

## Canonical wallet integration

```text
Original S2 Droid (local fork/fixture)
  -> opt-in control receipt: current owner + monotonic epoch
      -> accounts(tokenId): ONE persistent WrappedMissionAccountLab
          -> shared owner checks / actionNonce / reentrancy lock
              -> fixed free-mint mission
              -> owner-approved bounded MON/USDC swap
              -> explicit owner recovery / atomic exit
```

`DroidSwapAccountLab` remains a standalone adversarial adapter test harness. It is no longer the account used by the real Kuru fork integration test. The actual account comes from `DroidControlReceiptLab.accounts(11)` and the existing fixed factory.

New `DroidBoundedSwapCoreLab` inherits the existing mission account core. It does not introduce a second nonce, a second lock, another custody address, an upgradeable wallet, arbitrary calldata, or a financial runner permission. Calls still originate directly from the Droid account.

- `configureSwapPolicy` and `swap` require the current canonical receipt owner, wrapped custody and epoch. The owner sends **each** swap transaction. Funding/configuration alone does not dispatch an agent.
- All swaps, mission launches/executions, cancellations, withdrawals, recovery and exit share `actionNonce`. Changes invalidate previously prepared swaps and mint actions. Ownership is rechecked after external calls; a callback transfer/self-transfer reverts the whole operation.
- The effective swap reserve is the **greater** of the configured swap reserve and any live same-owner/same-epoch mint-mission reserve. Lowering the swap setting cannot silently consume a mission reserve. Expired/cancelled/stale missions do not impose active authority.
- Input caps remain 0.001 MON or 1,000 USDC atomic units per action; three swaps total per UTC day; daily requested-input caps 0.003 MON/3,000 USDC atomic units. Requested input consumes budget even on a partial fill/refund. Reconfiguration, owner transfer and rewrap do not reset counters.
- Exact temporary account-to-router approvals are cleared within the transaction. Invalid output, excess debit, failed cleanup, wrong chain, wrong venue or missing evidence reverts balances, nonce and counters.
- `exitToOwner` cancels the free-mint grant and swap policy, returns supplied fixed-mint NFTs, sweeps the configured USDC balance and **all** MON, and then returns the original Droid. Any failed transfer/callback rolls everything back. USDC-only balances now block direct unwrap.
- Unsupported tokens/NFTs remain separately recoverable where their contracts permit it. ERC1155 support, unknown-asset enumeration, unsolicited NFT grief and post-unwrap original-NFT burn risks are not solved by this change.

The local wrapper constructor now accepts an operator/test-owned `Venue` tuple (three addresses and three expected runtime hashes). It is fixed at construction, with no setter/admin override. All-zero is explicit mint-only mode; partially empty or mismatched configurations fail. This configurability exists for controlled local fixtures/forks, not an AI/holder venue allowlisting interface. A production manifest must pin the chosen constructor configuration as well as bytecode.

The minter fixture's exact runtime is validated at construction and its hash stored immutably for subsequent comparisons. This avoids embedding the entire fixture runtime in each wallet's runtime and keeps the integrated candidate below standard size limits without a new proxy/delegatecall mechanism:

| Artifact | Runtime bytes | Creation bytes before arguments |
| --- | ---: | ---: |
| Canonical account | 15,345 | 21,030 |
| Fixed account factory | 21,524 | 21,646 |
| Receipt wrapper | 14,686 | 43,161 |

The receipt now has 256 bytes of constructor arguments. Tests enforce 24,576-byte runtime and 49,152-byte initcode limits. The factory still has limited headroom; adding future modules needs another size/security review.

**Compatibility boundary:** these are new disposable local deployments, not upgrades of a previously deployed wrapper, V1 wallet or ASSIST wallet. New local manifests are generated from their own artifacts. Existing production identities/authentication still use the original S2 ownership path. Live receipt-aware ASK/World/Trait Lab authorization and a V1 asset/migration plan remain prerequisites to a public opt-in wrapper; they were not silently switched here.

## Verification

- **94** mission-lab Solidity tests passed: 26 core, 33 receipt/recovery, 17 standalone adapter, **18 canonical integration**. Reserve and adverse-effect cases include 256-run fuzz tests.
- **5** Kuru fork tests passed using the actual canonical account, including buy/sell, nonce rollback, receipt round-trip revocation, and one-account trade→mint→exit→same-address rewrap.
- **2** existing real-S2/validator wrapper fork tests passed, including the approved-pull rejection and V1 isolation checks.
- Signed disposable Anvil rehearsals passed: original mission **12 transactions**, mint-only wrapper **17**, canonical swap+mint wrapper **25**. The latter uses explicit mock liquidity; the separate fork uses real Kuru state. Neither claims browser-popup validation or a live Monad gas rehearsal.
- ASK/provider 30, local mission review 9, ASSIST JS 52, website/Energy/World 71, World security 6, Trait Lab 7, and V2/ASSIST contracts 34 passed.
- Expanded dependency/route tests: **9**. Every one of the 47 expected dependency observations is tested for missing/changed evidence; injected extra evidence and RPC failures are denied.
- Successful fresh inspection still reports `executionAllowed: false`. Missing source and the upgrade race are not converted into warnings that allow execution.
- TypeScript, ESLint and the final optimized webpack build passed, including route generation and the build's TypeScript pass. The existing optional Privy Stripe/Farcaster dependency warnings remain. No rendered UI was changed or claimed visually retested in this slice.

During implementation, the new test fixture initially had an invalid payable-contract cast; compilation caught it and it was corrected. A copied market max-size hex word was also initially mis-transcribed; the fresh inspector rejected it. The value was independently ABI-decoded as 2,000,000,000,000,000,000, corrected, regression-tested, and rechecked against the network. A build started before that correction was deliberately stopped and restarted against the final source. No live action was attempted during either failure.

Reproduce locally:

```sh
npm run test:droid-missions
npm run test:droid-kuru
npm run inspect:droid-kuru          # Public reads only, never approval
npm run test:droid-canonical-flow  # Isolated loopback Anvil + mock assets
npm run test:droid-kuru:fork        # Pinned public state, local writes only
npm run test:droid-wrapper:fork
```

CI now includes the signed canonical mock rehearsal alongside the existing suites. It has no public RPC override, owner key access or real venue broadcast option.

## Gates before the next activation step

1. Obtain and match exact deployed Kuru source/build artifacts, or review a different explicitly selected venue. Do not substitute the public repository without a bytecode match.
2. Resolve the execution-time upgrade trust boundary and complete the remaining dependency/governance review. Snapshot monitoring alone does not satisfy it.
3. Finish opt-in receipt compatibility, original/V1 asset handling, unsupported-asset recovery risks, manifest validation and independent contract review. Do not expose this local candidate as a deposit address.
4. Build durable **account-specific** simulation, risk, policy and authorization records. The current on-chain simulation reference is audit correlation, not proof of simulation.
5. Only after those gates: wire the owner-review preview flow with exact chain, Droid/account, epoch, nonce, input, minimum output, reserve, caps, expiry and recipients. Chat interpretation alone still grants nothing.
6. Separately design/test financial capability grants and narrow canaries. This work does not enable unattended swaps, arbitrary memecoin buys, NFT sniping, Energy-funded trading, or profit-based Energy rewards.

**Current disposition: local/fork candidate only; chat financial approvals OFF; deployment OFF; financial autonomy OFF.**
