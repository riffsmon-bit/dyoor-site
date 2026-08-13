# Monad D.Y.O.O.R Droid Security Notes

Date: 2026-08-12

Status: implemented and tested locally/forked, but **not independently audited and not deployed on Monad**.

## Security boundary

The parent NFT remains authoritative. For native chain ID 143 and collection `0x349D8eb480c92cF75371fbA5C6344A4d11b9103A`, the account resolves the current ERC-721 `ownerOf(tokenId)` on every authorization. It does not cache the activating wallet.

Consequences:

- transferring the NFT immediately transfers Droid Account control;
- the old owner immediately loses execute and ERC-1271 authority;
- the new owner immediately gains it;
- burning the NFT makes ownership resolution fail closed;
- there is no Droid private key;
- project admins and agents have zero account authority.

## Staking trust assumption

The audited Ascension contract custodies Season 1 only. Live checks showed 503 Season 1 tokens and zero Season 2 tokens at Ascension. Season 2 therefore uses direct `ownerOf` control.

Never use a Season 1 `stakeInfo(tokenId)` result to control a Season 2 account. Token IDs are not globally unique. A future custody resolver must bind the exact chain, collection, and custodian and must be introduced as a new account/resolver version after dedicated state-transition tests.

## Parent burn risk

The Season 2 NFT exposes owner burn. After burn, `ownerOf` reverts and no wallet can execute from the Droid Account. This is a deliberate fail-closed result; remembering the previous owner would create stale authority.

Mitigations in the first-party application:

- prominent burn warning;
- pre-burn chain-qualified Droid snapshot;
- fail closed if the snapshot or any configured asset read is incomplete;
- block if the account has already been activated;
- block if detectable native, configured ERC-20, or configured NFT inventory exists.

Limitations:

- the NFT contract itself is unchanged, so a holder can call `burn` directly outside the first-party UI;
- arbitrary unconfigured token balances cannot be exhaustively discovered by direct RPC;
- assets sent directly to a counterfactual address before activation may not be visible to the official UI.

Users must withdraw assets before any external burn. An activated account remains blocked from first-party burn even when visibly empty because unknown assets may exist.

## Transfer and marketplace risk

Transferring or selling the parent NFT transfers control of the entire account and all unlocked assets inside it. Assets are not automatically returned to the seller. External marketplaces may not discover or price account contents. The first-party UI displays underlying balances and does not depend solely on fiat value.

## Account execution

The NFT owner has ordinary `CALL` execution and bounded atomic batch execution. V1 has no `delegatecall`, CREATE, CREATE2, agent gateway, session key, admin executor, or implementation upgrade path.

Risks that remain owner-controlled:

- calling a malicious external protocol;
- granting ERC-20/ERC-721 approvals;
- interacting with fee-on-transfer, callback-heavy, or otherwise hostile tokens;
- approving a legitimate protocol that is later compromised;
- signing malicious calldata in a spoofed frontend.

The account blocks self-targeting, direct implementation use, controlling-collection nesting through receiver hooks, transfer of its own controlling NFT through account execution, reentrant owner execution, and detected/bounded account-ownership cycles. Raw ERC-721 transfers can bypass receiver checks; recursive authority therefore also fails closed during owner resolution.

## Signatures and replay

ERC-1271 validation delegates to the current owner. An EOA signature is evaluated against the present owner, and a contract owner is checked through its ERC-1271 interface. Ownership transfer immediately invalidates the old owner's signature path.

V1 does not create a new signed meta-transaction format, so it introduces no account-specific nonce or cross-chain signature domain. Applications using owner signatures must still bind their own messages to chain ID, account, purpose, nonce, and expiration.

## Registry and deterministic-address risk

Monad currently lacks code at the canonical ERC-6551 registry address. The release requires the exact standard deterministic deployment transaction and exact runtime hash before deploying the facade.

The account address depends on registry, implementation, salt, chain ID, collection, and token ID. A different implementation or salt intentionally produces a different address. The facade pins one exact V1 tuple and has no setters, preventing silent implementation replacement.

Never encourage deposits to a counterfactual address until:

1. canonical registry runtime is verified;
2. implementation source/runtime and constructor immutables are verified;
3. facade wiring is verified;
4. activation succeeds and account code exists.

## Ownership cycles and nesting

ERC-6551 accounts can own NFTs, including other account-controlling NFTs. The implementation rejects the controlling collection in safe receiver callbacks and blocks execution that transfers its own parent into itself. Owner resolution traverses account owners with a strict depth bound and returns zero on a detected cycle or excessive depth.

Safe nesting of unrelated NFTs remains supported. A raw transfer can create malformed nesting, but it cannot create a privileged fallback owner; affected authority fails closed.

## Energy separation

Monad Energy is an existing non-transferable, 18-decimal internal progression ledger. It is not an approved ERC-20 balance, has no fiat price, and is not converted into rewards. This integration only reads existing balances. It does not grant Energy roles, mint Energy, move balances, or change reroll/build economics.

## Asset, price, and inventory trust

Prominent fungible assets are configured by chain ID and contract address, never ticker alone. Initial candidates WMON and USDC were checked live, but enabling them still requires release review. Unknown price is displayed as `Value unavailable`, not `$0`.

Direct RPC inventory discovery is incomplete by nature. A scalable indexer may later add event-derived inventory, but on-chain balances remain authoritative. Malicious token metadata must be treated as untrusted display input.

## Admin and agent authority

The account implementation, canonical registry, and facade have no project-admin withdrawal or upgrade function. The deployer retains no role. Economic module roles, when separately deployed, cannot execute from Droid Accounts.

`DROID_AGENT_ENABLED=false` and `CROSS_CHAIN_BRIDGE_ENABLED=false` remain hard release gates. V1 contains no agent/session execution path. Future agent capability requires a separate reviewed version with on-chain target, selector, asset, amount, expiration, revocation, and ownership-epoch enforcement.

## Frontend/RPC risks

The client must verify chain ID after a wallet switch, show the exact account destination, and never trust client-supplied ownership. Server APIs validate supported chain and token input and resolve ownership on-chain. A compromised RPC or frontend could spoof balances or calldata, so users should verify chain, address, asset, and transaction intent in their wallet.

Private RPC keys belong only in server environment configuration. No user key, seed phrase, or unrestricted session key is stored.

## Emergency posture

There is no global pause capable of trapping owner funds. This is intentional: an immutable owner rescue path stays available. Before feature enablement, rollback is leaving both Monad account flags false. After deployment but before activation, keep flags off and publish an incident notice. If a defect is found after activations, do not replace V1 silently; publish the issue, disable new activation/funding surfaces, preserve owner withdrawals where safe, and introduce only a separately reviewed version.

## Unreviewed and residual risks

- no independent audit has been completed;
- canonical registry deployment on Monad has not occurred;
- final mainnet deployment transactions have not been signer-simulated from the approved operational wallet;
- parent burn can still be called outside the official UI;
- owner arbitrary calls expose users to external-protocol risk;
- direct-RPC inventory cannot prove absence of every arbitrary token;
- contract verification/indexing availability on Monad must be confirmed during deployment;
- all estimates and live ownership/staking balances are point-in-time observations.

Do not enable account activation, rewards, strategies, bridge, or agents until their applicable review gates are closed.
