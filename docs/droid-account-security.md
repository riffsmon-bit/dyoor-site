# Droid Account V1 security model

Status: multi-chain V1 threat model. Droid Account V1 is live/source-verified on Robinhood and staged/fork-tested on Monad; it is unaudited and must not be treated as risk-free solely because automated and fork tests pass.

## Security objective

The current owner of the controlling NFT must be the only V1 party able to move otherwise-unlocked assets from its Droid Account. Ownership transfer must remove the old owner's authority immediately. No project administrator, backend, AI, activator, or account private key may bypass that rule.

## Trust assumptions

V1 assumes:

- the configured controlling collection's `ownerOf` implements honest current ERC-721 ownership;
- the exact canonical ERC-6551 registry runtime is used;
- the immutable implementation/facade artifacts and constructor inputs are independently verified;
- each configured native chain's consensus and EVM behavior are correct;
- the owner's wallet and signature prompts are not compromised;
- each external target/token/protocol carries its own contract and economic risk;
- UI inventory allowlists identify contracts, not their future behavioral safety;
- RPC data may be delayed or unavailable but cannot grant contract authority.

None of these assumptions grants a project administrator custody.

## Authority matrix

| Party | Read | Deposit | Owner execute | Configure account | Agent execute | Withdraw user funds |
|---|---:|---:|---:|---:|---:|---:|
| Current NFT owner | Yes | Yes | Yes | No mutable config | No agent path | Yes, through owner execute |
| Previous NFT owner | Yes | Yes | No | No | No | No |
| Third party | Yes | Yes | No | No | No | No |
| Facade/canonical registry | Address/deploy only | No custody | No | Immutable binding | No | No |
| Project admin/backend/AI | Yes | Possible deposit | No | No V1 role | No | No |

Deposits are permissionless by asset design and never confer execution authority.

## Owner authority

`owner()` reads the proxy binding and calls the controlling NFT's live `ownerOf(tokenId)`. It does not use storage for wallet ownership. `execute`, `executeBatch`, `isValidSigner`, and `isValidSignature` resolve that owner when called.

Required transfer behavior is covered by tests:

1. Alice owns #420 and executes.
2. Alice's signature validates.
3. Alice transfers #420 to Bob.
4. Alice execution reverts immediately.
5. Alice's old signature fails immediately.
6. Bob controls execution and signature validation.

V1 has no session authorization, so there is no old agent authority to revoke after transfer.

On Monad Season 2, Ascension custody records are deliberately ignored: live audit shows Ascension holds Season 1 NFTs but no Season 2 NFTs. Using a same-numbered Season 1 `stakeInfo` record would hand authority to the wrong collection's staker. A future Season 2 custodian requires an exact chain/collection/custodian-bound resolver and a new version.

## Admin authority

Neither `DroidAccountV1` nor `DroidAccountRegistry` has an admin role. There is no:

- `adminWithdrawUserFunds` equivalent;
- account implementation setter;
- proxy upgrade administrator;
- owner override;
- emergency account seizure;
- target whitelist controlled by a project administrator;
- pause that traps owner funds.

The tradeoff is that a discovered V1 implementation bug cannot be patched in place. A new version must be deployed and users must explicitly move assets.

## Agent authority and emergency pause

Agent authority is zero because no agent/session execution entry point exists. The UI's `MANUAL`, `OFFLINE`, and `0 session keys` values are statements about contract capability, not mutable frontend security settings.

There is no `pauseAgentExecution()` in V1 because there is nothing autonomous to pause. A future version must separate agent pause from owner execution and must never let agent pause block owner rescue.

## External calls and reentrancy

Owner execution permits ordinary EVM `CALL` and deliberately rejects other operation codes. Calls to the zero address and the account itself are rejected. Failed target calls bubble their revert data. Batches are atomic and capped at 32 calls.

A storage guard covers the entire owner execute/batch path. A malicious receiver/token/protocol callback cannot reenter another owner command. More importantly, callback sender identity still cannot equal the current NFT owner unless the controlling NFT itself is owned by that callback contract.

V1 does not expose `delegatecall`, which avoids target-controlled writes into account storage, storage collisions, implementation destruction, and most plugin-style privilege escalation. It does not expose CREATE/CREATE2.

Reentrancy protection cannot make a malicious external protocol economically safe. The owner must review targets and calldata.

## Malicious assets

### ERC-20

An ERC-20 can lie about balances, return false, omit return values, charge transfer fees, rebase, blacklist, invoke hooks through nonstandard behavior, or deliberately revert. First-class UI actions are limited to configured contracts. Configuration is a discoverability/trust signal, not a protocol guarantee.

Account execution bubbles call failure but cannot force a hostile token to implement honest accounting. Owners should confirm post-transaction balances.

### ERC-721 and ERC-1155 callbacks

Safe receiver callbacks update state and emit inventory events. Callback-triggered owner execution is reentrancy-guarded and still owner-gated. Arbitrary NFTs may contain hostile metadata; V1 does not fetch arbitrary remote metadata for trusted inventory.

The account rejects every safe ERC-721 transfer from its controlling collection to prevent normal Droid nesting, not just its own token ID.

### ERC-777 and other hooks

V1 has no ERC-777-specific integration. Hook-bearing assets are treated as malicious external-call surfaces. The execution guard and live owner check reduce privilege escalation, but do not remove token-specific economic or denial-of-service risk.

## Signature and replay risks

ERC-1271 answers whether the current owner validates a supplied hash/signature. The account itself does not execute from that signature and does not consume a nonce.

Any external application relying on ERC-1271 must construct a domain-separated authorization containing at least chain ID, account, intended target/action, expiry, and an application nonce. Otherwise that application can create replay risk. V1's owner transfer invalidates an old EOA/contract-owner signature by changing the validating owner, but does not repair a poorly designed external protocol.

No `UserOperation`, permit, meta-transaction, or session signature path exists in V1. Cross-chain and session replay are therefore deferred rather than silently assumed solved.

## NFT transfer risks

Transferring the parent NFT transfers account control without moving account assets. The new owner receives control of unlocked inventory; the old owner receives nothing automatically.

Risks include:

- seller forgets to withdraw assets;
- buyer/marketplace does not discover contents;
- contents change between listing and settlement;
- fiat valuation is incomplete or stale;
- approvals/positions inside external protocols remain account-specific;
- malicious deposits make the account look more valuable than it is.

The first-party UI always shows underlying configured balances and a prominent warning. It does not promise that external marketplaces understand token-bound accounts.

### Parent burn risk

The Monad Season 2 collection permits owner burn. Once burned, `ownerOf` reverts and V1 returns zero owner, permanently failing closed. Caching the previous owner would violate the core transfer rule and is not used.

The first-party Trait Lab blocks burn if account discovery is incomplete or the account is active/detectably funded. That guard cannot prevent a direct call to the existing NFT contract, and direct RPC discovery cannot prove the absence of every arbitrary token. Never burn a parent NFT before withdrawing and independently checking all account assets.

## Nested ownership and cycles

### Prevented paths

V1 prevents:

- safe transfer of any controlling-collection NFT into a Droid Account;
- account-executed transfer of its own controlling NFT into itself through standard ERC-721 transfer selectors;
- authority resolution through a graph that returns to the same account;
- authority resolution deeper than eight nested token-bound accounts.

Cycles and excessive depth return `owner() == address(0)` and all execution/signature authority fails closed. Resolution is iterative and bounded, avoiding unbounded recursive calls.

### Irreducible unsafe-transfer limitation

The existing ERC-721 `transferFrom` method does not call `onERC721Received`. A user or external marketplace can deliberately send a parent NFT to its own account using raw `transferFrom`, bypassing the account's receiver rejection. Two accounts can similarly be placed into a cycle through raw transfers.

Once a controlling NFT is owned by its own account, live ownership says the account is owner while cycle protection intentionally returns zero authority. There may be no entity capable of commanding the account to transfer the NFT back. Assets and control can be permanently locked.

This cannot be completely prevented inside a token-bound account without changing or wrapping the already-deployed NFT's transfer semantics. Caching the previous wallet as a recovery owner would violate current-ownership authority and could give a seller stale access after a legitimate transfer.

Controls are therefore defense in depth:

- safe receiver rejection;
- self-transfer calldata rejection on account execution;
- bounded cycle detection and fail-closed authority;
- first-party destination validation and warnings;
- tests documenting both prevented and unavoidable cases;
- future first-party marketplace contracts must reject parent-to-account/circular destinations before settlement.

Never transfer a parent HoodYØØR to any Droid Account address.

## Counterfactual and CREATE2 risks

Address derivation includes canonical registry address, implementation, salt, chain ID, token contract, and token ID. Changing any input changes the account. The canonical registry is not yet deployed on Monad; account activation and official funding remain disabled there until exact runtime verification.

The activation facade cross-checks the canonical result, and the API verifies:

- canonical registry runtime hash;
- facade code and implementation code;
- facade canonical registry, collection, implementation, chain, and salt getters;
- per-account token binding and live owner after deployment.

The canonical registry returns an existing account for duplicate creation. A third party can deploy the same account first but cannot choose its authority or initialization because V1 has no initializer.

Counterfactual funding is technically possible. The first-party V1 UI requires deployed code before deposit so a configuration error is caught before value is sent.

## Implementation and initialization

Direct calls to the implementation's token/execution paths revert, and direct signature validation returns failure. Proxies need no initializer and contain no activator-supplied owner, eliminating proxy initialization races.

The implementation stores the deployment chain as an immutable and rejects a binding for another chain. Account binding comes from canonical proxy runtime bytes at the standardized offset.

The implementation's storage is account-local because execution occurs by delegatecall from each minimal proxy. The only V1 storage is state and the reentrancy status. There is no upgradeable storage layout.

## Upgradeability risks

V1 is immutable and versioned. This avoids:

- admin key compromise changing account logic;
- proxy initialization bugs;
- implementation storage-layout collisions;
- silent new admin/agent paths;
- upgrade transaction front-running.

It introduces:

- no in-place patch for a bug;
- separate V2 address and explicit asset migration;
- possible user confusion between versions;
- continued risk in old accounts holding assets.

The first-party UI must pin and display the official version. A future version must never imply that assets moved automatically.

## Oracle and valuation risks

No oracle or price code exists on-chain in V1. The UI currently reports `Value unavailable` and underlying balances. It never uses a nominal `$0` for unpriced assets.

A future price adapter is informational unless a separately audited on-chain permission module consumes it. Fiat spending limits must not use a mutable frontend price. On-chain limits should use token-denominated units or explicitly reviewed oracle freshness, decimals, manipulation, sequencer, and fallback rules.

## Frontend and RPC spoofing risks

The frontend can be compromised, an RPC can lie, and DNS can be hijacked. Contract authorization still requires the current owner, but a malicious interface can ask that owner to execute harmful arbitrary calldata.

Mitigations:

- exact destination and asset display;
- configured asset list;
- current owner and chain re-read before writes;
- expected deterministic account comparison;
- gas estimation and receipt wait;
- explorer links;
- protected server RPC never returned to the browser;
- no backend transaction signer;
- no client ownership claim trusted for contract execution;
- content security policy and no arbitrary metadata rendering in trusted inventory.

Users must still inspect wallet simulations and transaction details. A valid owner signature authorizes the exact submitted call even if the UI that proposed it was malicious.

## Denial of service

Potential denial paths include:

- controlling NFT `ownerOf` reverts;
- RPC archive log limits hide activity/inventory;
- configured hostile token balance calls revert;
- external positions prevent withdrawal;
- excessive nested ownership fails closed;
- raw-transfer cycle permanently locks authority;
- chain congestion or account lacking ETH at the commander wallet prevents commands.

Balance readers isolate configured asset failures and return partial-error notices. They do not turn missing data into trusted zero balances.

## Emergency response

There is no admin rescue or global account pause.

For a UI/configured-token incident:

1. remove first-class UI support for the affected target without changing account custody;
2. communicate the exact contract and observed behavior;
3. owner directly recovers unaffected unlocked assets using reviewed calldata;
4. preserve logs and deployment artifact hashes;
5. do not deploy a new implementation as an automatic replacement;
6. obtain independent review before recommending migration.

For a suspected implementation issue, stop new activation/funding in the UI while leaving owner recovery visible if safe. A facade cannot be paused, but it also cannot seize assets. Publish a new version only with an explicit migration guide.

For self/circular raw ownership, do not promise recovery. Analyze the exact graph and collection semantics; V1 intentionally has no stale-owner or admin bypass.

## Mainnet verification and remaining audit requirements

Completed evidence for the 2026-08-11 deployment:

- clean reproducible Foundry compilation and local test suite;
- canonical registry and production collection runtime validation;
- Robinhood mainnet fork activation and Alice-to-Bob authority-invalidation simulation;
- malicious target, callback/reentrancy, nested ownership, asset receipt, withdrawal, and ERC-1271 tests;
- exact runtime hashes, constructor arguments, transaction hashes, and start block recorded in the deployment checkpoint;
- public Blockscout source verification and independent post-deployment RPC wiring reads.

Monad staging additionally includes a live chain-143 fork proof for direct Season 2 ownership, immediate Alice-to-Bob authority transfer, metadata/Energy invariants, and the Season 1 Ascension boundary, plus a read-only mainnet preflight. It is not a production deployment or an independent audit. Chain-specific residual risks are recorded in `docs/monad-dyoor-droid-security.md`.

Still required for stronger production assurance:

- independent review/audit of the exact deployed source and compiler settings;
- sustained monitoring for facade activation and account execution events;
- mobile transaction-prompt testing with real wallet combinations as tokens become available;
- continued review of first-party transfer/listing destinations;
- incident communication and explicit version-migration procedures before any successor implementation.

## Automated evidence

`contracts/hoodyoor/test/DroidAccountV1.t.sol` covers deterministic creation, duplicate behavior, binding, direct implementation rejection, ETH/ERC-20/ERC-721/ERC-1155 custody, owner execution/batch behavior, failure bubbling, reentrancy, ERC-1271 smart owners, immediate transfer invalidation, safe nesting rejection, raw self-ownership failure, two-account cycles, and interface support.

These tests are necessary evidence, not an audit.
