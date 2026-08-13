# HoodYØØR Economic Droid Security

Status: internal threat model for an unaudited, not-yet-deployed release. Passing automated tests is not a substitute for an independent smart-contract audit.

## Security objectives

1. Existing NFT ownership, metadata, rerolls, staking, and Energy remain unchanged.
2. Only the current NFT owner controls an existing Droid Account.
3. Real rewards are fully funded, single-claim, and sent only to the active Droid Account.
4. Project administrators cannot execute from or withdraw assets held by a Droid Account.
5. Energy remains economically separate from real assets.
6. Bridge and agent authority default to zero.
7. One chain or sibling collection cannot collide with or replay another Droid's identity.

## Trust boundaries

| Actor/role | Can | Cannot |
| --- | --- | --- |
| NFT owner | Select a future strategy; claim a valid allocation; control the existing Droid Account | Alter epoch roots, asset allowlists, or vault accounting |
| Collection manager | Register/disable eligible local collections and add immutable resolver versions | Replace a registered resolver; execute a Droid Account |
| Asset manager | Enable/disable asset metadata and eligibility | Move any asset |
| Strategy manager | Add/disable strategy versions | Execute a strategy or move portfolio assets |
| Achievement issuer | Award configured achievements with evidence | Move assets or exceed contract modifier caps |
| Revenue source | Deposit approved assets with a unique revenue ID | Release or recover funds |
| Allocation/release managers | Configure future project/reward/other splits; release accrued vault shares to fixed destinations | Redirect a release per transaction or access Droid funds |
| Epoch manager | Publish funded roots and close/cancel under defined rules | Change an existing epoch or withdraw distributor funds |
| Pauser | Stop new vault/claim/config operations in its module | Block an owner from executing directly from their Droid Account |
| Delayed default admin | Manage module roles and limited configuration | Seize a Droid Account or recover accounted reward funds |

Production role holders should be separate Safe multisigs. A compromised role can deny service or corrupt future configuration within its scope, so least privilege and monitoring remain mandatory.

## Ownership and NFT transfer

Claims and strategy selection resolve `ownerOf` at transaction time. No activating wallet or cached backend owner is authoritative. After Alice transfers a Droid to Bob:

- Alice cannot claim its pending allocation;
- Alice cannot change its future strategy;
- Alice immediately loses the existing account's owner-execution authority;
- Bob gains those rights under current NFT ownership.

An allocation follows the canonical Droid identity, not a past wallet. A transfer can therefore convey control of both already-held account inventory and an unclaimed Droid allocation. The UI must warn before every in-app parent-NFT transfer or listing flow.

## Nested ownership and cycles

The existing `DroidAccountV1` prevents its account from receiving its own controlling NFT, blocks the controlling collection in receiver hooks, and bounds recursive account-owner resolution to detect cycles. These existing controls are not changed.

Residual risks:

- third-party transfers can sometimes move NFTs without invoking a receiver hook;
- unrelated NFT/account implementations may use different nesting semantics;
- marketplaces may not recognize account contents;
- complex nested ownership can be expensive or unavailable to resolve.

The economic registry never treats an account as the NFT owner and never adds recursive control. A future account implementation must repeat dedicated self-control and A↔B cycle tests before registration.

## Revenue vault controls

- Only approved sources can deposit.
- Every deposit requires a nonzero, never-before-used `revenueId`.
- ERC-20 deposits require the exact requested balance increase, rejecting fee-on-transfer accounting drift.
- Assets must be explicitly enabled by address on the local chain; symbols are metadata only.
- Project-treasury, Droid-reward, and other-approved shares are fixed at deposit time and separately accrued; all three bps values must total 10,000.
- Releases can only pay the three configured destinations; their changes are atomic and delayed.
- Destination changes have a two-day delay; the distributor permanently binds its original funding vault.
- Recovery is available only while paused, covers only balance above all three accounted liabilities, and always pays the configured treasury.
- Checks-effects-interactions, `SafeERC20`, and reentrancy guards protect all transfer paths.

Malicious ERC-20s can still revert, consume unusual gas, or change behavior after allowlisting. Only reviewed, stable contracts should be enabled, and disabling an asset stops new deposits without inventing a way to confiscate already-accounted funds.

## Reward epoch controls

- An epoch ID is immutable and cannot be reused.
- Epoch creation requires a nonzero root, bounded integer allocation, minimum duration, enabled asset, and available unreserved backing.
- The double-hashed leaf includes epoch ID, current chain ID, collection, token ID, account version/address, strategy, weight, and amount.
- Claims require the current NFT owner and deployed account bytecode.
- Claim state is set before the external transfer and guarded against reentrancy.
- Each `(epochId, droidKey)` can claim once.
- A claim cannot exceed the epoch's remaining declared allocation even if an operator published a malformed root.
- Expiry releases the reservation but leaves funds in the distributor for future reward epochs. There is no admin withdrawal.

The epoch manager remains trusted to publish fair weights and correct inclusion/exclusion decisions. Contract checks prevent underfunding and double claims, not dishonest policy. Public manifests, independent reproduction, content hashes, pre-publication review, and a dispute window are required operational controls.

## Replay and chain mismatch

- Droid keys bind chain ID, collection address, and token ID.
- Merkle leaves additionally bind epoch, resolver version, account address, strategy, and allocation.
- Admin requests bind domain, route, action, payload, Robinhood chain ID, timestamp, signer, and a durable one-time nonce.
- Transaction receipt verification checks the expected chain, distributor address, event root, manifest hash, asset, total, and epoch ID before a manifest is marked on-chain.

The admin status endpoint is not authentication: a caller can claim any wallet query parameter. It therefore returns only public manifest summaries. Mutations always require signature verification and allocation proofs remain in protected storage.

## Reentrancy, callbacks, and external calls

Economic modules do not support arbitrary call or `delegatecall`. Transfer-capable functions use reentrancy guards and update accounting before calling recipients. Tests cover a malicious ERC-20 callback and native-recipient reentry.

No DEX, router approval, permit, ERC-777-specific hook, oracle, bridge, or agent call path exists in V1. Any adapter implementation is a new security boundary requiring target/selector/asset allowlists, exact approvals, minimum output, deadlines, token-denominated caps, revocation, and separate tests.

## Admin and upgradeability risk

The modules use `AccessControlDefaultAdminRules` with a two-day admin-transfer delay and are intentionally not proxies. This avoids proxy initialization/storage-collision risk and prevents silent behavior changes. It also means bugs require a new version and careful handling of future funding.

Admins can pause modules, disable future configurations, and cause denial of service. They cannot transfer assets from Droid Accounts. Distributor rewards have no admin recovery path, so a critical bug may leave funded rewards unavailable until the original claim path is safe again. Fund only short, reviewed epochs and grow limits gradually.

## Backend, database, and frontend risks

- On-chain ownership and balances are authoritative; database rows are caches/indexes.
- Full manifests contain claim proofs and must not be publicly listed before policy permits.
- Admin signing uses nonces, expiration, payload hashes, and chain binding; private keys and seed phrases are never stored.
- APIs validate official resolver-derived accounts and minted NFT ownership rather than trusting client fields.
- RPC/indexer partial failure must produce explicit unavailable states, never fake zero balances or prices.
- UI address/network spoofing is mitigated by checksummed configured addresses, chain checks, explorer links, and transaction simulation in the user's wallet.
- Fiat portfolio values are informational and absent without a reliable source; no contract uses frontend prices.

## Emergency procedures

1. Pause the affected vault/distributor/config module using its dedicated Safe role.
2. Keep existing Droid owner execution available; do not pause the independent Account V1 system.
3. Disable affected assets, strategies, revenue sources, or collection/account versions where necessary.
4. Stop releases and new epoch publication. Do not publish replacement roots over an existing ID.
5. Reconcile on-chain balances, reservations, events, manifests, and Safe actions.
6. Publish an incident statement identifying affected chains/assets/epochs.
7. If replacement is required, deploy a versioned module, independently verify it, redirect only future revenue after the destination delay, and keep historical data readable.

An emergency must never be used to add an admin withdrawal from user Droid Accounts.

## Required pre-production review

- Independent audit of all six economic contracts and the existing account integration boundary.
- Multisig addresses, thresholds, hardware-wallet policy, and role separation approved in writing.
- First asset/source/strategy list reviewed contract-by-contract.
- Reward-weight policy reproduced independently from source events.
- Mainnet fork/fork-equivalent simulations against final constructor inputs and fee data.
- Explorer source verification and bytecode comparison.
- Small funded canary epoch with a non-treasury test Droid, followed by transfer-before-claim verification.
- Incident monitoring for role changes, pauses, destination schedules, deposits, releases, epoch roots, and claims.

## Explicitly unaudited or disabled

The implementation is internally tested but independently unaudited. Rewards, strategies, Monad Droid accounts, shared treasury aggregation, bridge execution, and agents remain disabled. `CROSS_CHAIN_BRIDGE_ENABLED` and `DROID_AGENT_ENABLED` are code-locked false.
