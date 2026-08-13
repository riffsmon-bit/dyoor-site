# HoodYØØR Dual-Chain Security Model

Date: 2026-08-12

Status: internal review complete; independent audit outstanding. This document is not deployment approval.

## Security boundaries

Four separate boundaries must not be conflated:

1. Parent NFT ownership controls the Droid Wallet.
2. Existing Energy contracts control progression balances and sinks.
3. Chain-local vault/distributor contracts, when deployed and funded, control project reward assets only.
4. Application/indexer data presents and caches state but is never authoritative for custody or ownership.

No project role can execute from a user's Droid Wallet. No AI, bridge, backend, or admin key has an account path in V1.

## Trust assumptions

- The configured chain ID, collection, canonical registry, implementation, facade, and salt are correct and verified against release hashes.
- The parent collection's `ownerOf` truthfully represents the intended controller. V1 assumes no custody staking for the controlling collection.
- Owners understand that transferring the parent transfers account control and that burning the parent can permanently remove control.
- Approved assets behave according to their reviewed contracts. Symbols, metadata, and frontend pricing are untrusted.
- Future epoch managers can publish unfair roots; on-chain contracts enforce funding/replay bounds, not subjective reward policy. Public reproducibility and multisig review mitigate this trust.
- Safe owners, thresholds, recovery, hardware-wallet practices, and timelocks are independently reviewed before economic deployment.

## Owner and transfer threats

The account resolves current `ownerOf` on every execution and ERC-1271 validation. Transfer therefore invalidates the old owner's direct authority immediately. Tests prove old-owner rejection, new-owner success, signature invalidation, and asset persistence.

Risks:

- A malicious marketplace or frontend may hide account inventory.
- An owner may unknowingly sell the NFT with assets inside.
- A raw transfer can bypass an ERC-721 receiver hook.
- A burned parent causes `ownerOf` to revert and intentionally leaves no fallback controller.

Controls:

- persistent, underlying-balance transfer warnings;
- exact chain/collection/account display and explorer link;
- owner revalidation immediately before writes;
- account-side parent self-control and ownership-cycle checks;
- first-party burn block for active/funded/incompletely discovered Monad accounts.

External marketplaces cannot be forced to disclose account contents. Users must withdraw before an external burn and should inspect account inventory before any transfer or sale.

## Staking and stale-controller threats

Monad Ascension holds Season 1 NFTs only; live Season 2 balance at the audited custodian is zero. Reusing a Season 1 `stakeInfo(tokenId)` for Season 2 would create cross-collection privilege and is prohibited.

Direct-`ownerOf` V1 gives a custody contract control if the controlling NFT is deposited there. Therefore:

- Monad Season 2 and Robinhood staking must remain non-custodial for V1;
- any future custodian requires a new exact-collection resolver/account version;
- transitions must test unstaked, depositing, staked, unstaking, recovery, transfer, and stale record states;
- no frontend-only controller override is acceptable.

## Account execution and external calls

Owner V1 supports ordinary `CALL` and bounded atomic batches. It excludes `delegatecall`, CREATE, CREATE2, upgrades, agents, and admin execution. It blocks zero/self targets, reentrant execution, transfer of its own parent into itself, controlling-collection safe receives, and detected/bounded account cycles. Failed calls bubble revert data.

Residual owner-controlled risks include hostile tokens, callback-heavy standards, unlimited approvals, compromised protocols, calldata phishing, and denial of service in nested account graphs. The first-party UI allowlists prominent transfer assets, but the NFT owner retains general call authority and must review every wallet transaction.

## Nested ownership and cycles

Safe nesting of unrelated NFTs is supported. Direct or raw transfers can still build account graphs. Owner resolution walks token-bound owners to a maximum depth and returns no controller on self-cycle or excessive depth. This prioritizes preventing stale/recursive privilege over making every nested graph usable.

Tests cover the account owning its parent, raw receiver bypass, two-account cycles, and bounded resolution. Other third-party account implementations may behave differently and remain an integration risk.

## Deterministic deployment risks

The account address is sensitive to registry, implementation, salt, chain, collection, and token ID. A single mismatch produces another address. On Monad, the canonical registry is currently absent, so its standard deterministic payload and runtime hash must be verified before any other deployment or deposit.

The first-party client requires account code before funding. Counterfactual display is informational until all dependencies are verified. No predicted implementation/facade address is claimed while deployer and nonce are unset.

## Asset-registry threats

Assets are identified by chain and address. Unknown assets fail closed for strategy/reward automation. Registration checks contract code and decimals for ERC-20s; native asset is explicit. Fee-on-transfer deposits are rejected through exact balance accounting.

Allowlisting cannot make a mutable or malicious token safe. A token can revert, consume gas, alter behavior, lie in metadata, block transfers, or invoke callbacks. Asset review must include implementation/proxy/admin risk, transfer restrictions, fee/rebase behavior, compliance constraints, liquidity/acquisition route, decimals, and emergency disable behavior.

## Revenue-vault threats

Threats include unauthorized deposits, replayed revenue IDs, accounting drift, malicious callbacks, reentrancy, destination substitution, allocation abuse, and excess-recovery abuse.

Controls include approved sources, unique IDs, enabled assets, exact ERC-20 receipt, checks-effects-interactions, `SafeERC20`, reentrancy guard, separate project/reward/other accrued balances, fixed release destinations, a two-day destination delay, pause, and excess-only recovery to treasury. Each split leg is in `0..10,000` bps and all three must total exactly `10,000`; the values are fixed per deposit and rounding dust goes to project treasury. The owner must approve the actual split, third destination, and any narrower governance policy.

Allocation and release roles can affect future project revenue but cannot touch Droid Wallet inventory. A compromised allocation role can redirect future deposits among the project, reward, and other-approved buckets; it cannot redirect any configured destination per transaction. Multisig/timelock separation and monitoring remain mandatory.

## Reward threats

Threats include underfunded roots, duplicate claims, allocation overflow, stale owner claims, wrong account/version, chain replay, dishonest weights, proof leakage, reentrancy, and malicious payout assets.

Controls:

- epoch reservation is capped by current unreserved balance;
- `uint128` allocation bounds and remaining-allocation check;
- immutable/replay-protected epoch and Droid claim keys;
- leaf binds chain, collection, token, account version/address, strategy, weight, and amount;
- current owner and active official account are checked at claim time;
- effects precede transfer and claim is non-reentrant;
- claims always pay the Droid Wallet;
- no Energy mint/conversion and no distributor admin withdrawal.

An epoch manager can still publish an unfair or exclusionary root. Require a public content-addressed manifest, independent reproduction, dispute window, multisig approval, short epoch, and capped first funding.

## Strategy threats

The current strategy registry stores preferences only and never moves assets. A selection is authorized by the current owner, version-pinned, and chain/Droid-qualified. Changing a preference leaves historical assets unchanged.

No execution adapter is approved. A future adapter adds router, approval, slippage, oracle, deadline, MEV, compliance, and liquidity risks and requires a new audit. If acquisition cannot be proven safe, retain the settlement asset or disable the strategy.

## Admin and Safe model

Economic modules use delayed default-admin transfer and scoped roles. Recommended holders:

| Capability | Holder | Hot wallet allowed? | Delay |
| --- | --- | --- | --- |
| Default admin / role administration | high-threshold protocol Safe | never | built-in two-day transfer; additional Safe policy recommended |
| Treasury destination | high-threshold treasury Safe | never | destination update has two-day delay |
| Allocation/destination/source policy | governance Safe | never | Safe delay/review; destination contract delay applies |
| Asset and strategy managers | configuration Safe | no | timelocked for production changes |
| Epoch manager / release manager | rewards operations Safe | no single EOA | manifest and funding reconciliation before execution |
| Achievement issuer | constrained campaign Safe/service | limited operational signer may be acceptable | revocable, monitored, no treasury authority |
| Pauser | security Safe, optionally a low-threshold emergency Safe | tightly controlled emergency signer may participate | unpause requires incident review |

No single operational wallet should hold default admin, treasury, configuration, epoch, and pause capabilities. Deployment EOAs must lose unnecessary roles after Safe acceptance.

## Pause and recovery model

Economic pauses stop applicable deposits, new epochs, claims, strategy selections, or asset eligibility. They never pause `DroidAccountV1.ownerExecute`. Owner rescue must stay available even during an economic incident.

Incident order:

1. pause the affected economic module;
2. turn off server/public feature flags;
3. disable the affected asset, strategy, source, collection, or account version where safe;
4. stop releases/funding and preserve evidence;
5. reconcile balances, liabilities, reservations, events, roots, and Safe actions;
6. publish affected chain/assets/epochs;
7. introduce a separately reviewed version for future funds only.

There is no rollback of immutable account code and no admin rescue of user assets. A defective account version must be deprecated for new use without silently redirecting existing accounts.

## API, indexer, and frontend threats

APIs validate supported chains and official server configuration, re-read ownership, and derive official accounts. Signed admin mutations bind domain, route, action, payload hash, chain, timestamp, signer, and durable nonce. Protected manifests contain proofs; public endpoints expose commitments/summaries only.

RPC compromise, stale index data, cache collision, frontend replacement, malicious token metadata, and price spoofing remain risks. Mitigations are chain-qualified keys/routes, checksummed addresses, partial-error states, no fabricated prices, direct on-chain revalidation before writes, content security controls, and wallet transaction inspection.

Database balances and owners are caches. A row must never override on-chain authority.

## Trait Lab and burn safety

Monad trait rerolls and layer mutations are safe because they preserve chain, collection, and token ID. Parent burn is unsafe for an account that may hold assets. The official burn flow blocks if:

- the Droid Account API/read fails;
- any configured balance or inventory read is partial;
- the account is activated, even when visibly empty;
- native, configured ERC-20, or configured NFT inventory is detected.

The UI states the reason instead of silently failing. This cannot prevent a direct external `burn` call and cannot exhaustively discover arbitrary unconfigured tokens. The same policy is mandatory if Robinhood ever adds burn/recycle functionality.

## Agent freeze

`DROID_AGENT_ENABLED` is hard-coded false. V1 contains no session key or agent entry point. A future agent must be capability-based and ownership-epoch invalidated; it may never transfer the parent, alter ownership/security, grant itself permissions, call arbitrary targets, use arbitrary delegatecall, whitelist contracts, or create unlimited approvals.

Prompt/backend rules are not financial authorization. Enforce every material limit on-chain.

## Bridge freeze

`CROSS_CHAIN_BRIDGE_ENABLED` is hard-coded false. Only an interface exists. No provider, route, allowance, custody, or automated Monad↔Robinhood transfer is configured. Logical treasury aggregation is read-only.

## Chain-specific open risks

Monad:

- canonical ERC-6551 registry is not deployed;
- Account V1/facade are not deployed;
- collection supports burn outside first-party safeguards;
- final signer/deployer simulation and independent audit are outstanding.

Robinhood:

- collection and Account V1 are deployed but independently unaudited;
- zero-supply/pre-mint state can change through separately controlled launch actions;
- future custody staking would be incompatible with V1;
- all six economic addresses, Safe roles, split, assets, sources, strategies, and reward policy remain unset.

## Audit statement

Repository tests, local simulations, live read-only preflights, and chain forks provide engineering evidence, not an independent security audit. Both chain releases remain held. No transaction was signed or broadcast during this readiness pass.
