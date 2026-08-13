# dYØØR Droid Accounts

Status: V1 deployed and source-verified on Robinhood Chain mainnet. The same executable account logic is integrated and fork-tested for Monad mainnet but is not deployed there. Neither release has an independent audit.

## Product model

A Droid Account is a deterministic smart account controlled by the current owner of an existing eligible NFT. It has no private key and does not replace, wrap, remint, or modify the NFT.

```text
Commander wallet
      │ owns now
      ▼
dYØØR / HoodYØØR NFT #420
      │ resolves ownerOf(420) on every command
      ▼
Droid Account #420 ───────► native asset / configured tokens / NFTs
      │
      ├───────────────────► existing HoodYØØR Energy balance
      └───────────────────► future Equipment / Missions / Directives
```

The NFT is the identity. The account is its asset-holding body. The current NFT owner is its commander.

## V1 architecture

V1 has three contract layers:

1. The existing `HoodYOORSeaDrop` collection remains unchanged.
2. The canonical ownerless ERC-6551 registry creates deterministic minimal-proxy accounts.
3. An immutable `DroidAccountRegistry` facade pins the official collection, implementation, chain, and salt and provides the holder activation flow.

Each proxy delegates to the immutable `DroidAccountV1` implementation and embeds this binding in its runtime bytecode:

```text
(implementation, salt, chainId, NFT contract, tokenId)
                         │
                         ▼ CREATE2
              deterministic account address
```

For the same registry and complete binding, `account(...)` returns the same address before and after deployment. V1 uses lazy activation; no account is automatically deployed for an NFT that never uses one.

The implementation and facade have no owner, proxy administrator, upgrade method, fund-moving administrator, or agent executor.

## Canonical bindings

The current eligible Robinhood collection is HoodYØØR SeaDrop V2 at `0x8277F8126722B11D7b44C5C453bcF62A78AAFa25` on chain 4663. The superseded-before-mint collection is not eligible.

The canonical ERC-6551 registry address on Robinhood mainnet and testnet is `0x000000006551c19487814612e58FE06813775758`. Runtime configuration checks the registry code hash as well as the facade's immutable wiring before enabling writes.

The immutable mainnet Droid bindings are:

- `DroidAccountV1`: `0x0FFDc6ACb41D39ee7b535026202AA8fe0054F52A`
- HoodYØØR `DroidAccountRegistry`: `0x190602Aa70199ec3623ad3bc97a10B534b26fE48`
- zero account salt;
- deployment start block `33,356,761`.

The deployment checkpoint is `deployments/robinhood/droid-accounts-4663.json`; the verification record is `deployments/robinhood/droid-accounts-verification-4663.json`.

The staged Monad-native collection is the existing D.Y.O.O.R Season 2 contract at `0x349D8eb480c92cF75371fbA5C6344A4d11b9103A` on chain 143. Its canonical identity includes chain, collection, and token ID; it is not a bridged copy of HoodYØØR. The canonical ERC-6551 registry is absent on Monad, so activation remains feature-gated off until the three-contract deployment and verification sequence in `docs/monad-dyoor-droid-deployment-report.md` is separately authorized.

## Account lifecycle

### Counterfactual

The UI shows a token's deterministic account address before code exists there. The V1 UI requires activation before funding even though the underlying address can technically receive counterfactual transfers.

### Activation

`DroidAccountRegistry.createAccount(tokenId)`:

1. reads current `ownerOf(tokenId)`;
2. requires the caller to be that current owner;
3. calculates the canonical account;
4. returns it unchanged if already deployed;
5. otherwise asks the canonical registry to deploy it;
6. checks returned address and deployed code;
7. emits `DroidAccountActivated`.

The canonical registry itself is permissionless. A third party can harmlessly predeploy the identical account, but cannot gain authority because activation never assigns an owner. Authority always comes from the NFT's live owner.

### Ownership transfer

Alice can execute while Alice owns the parent NFT. Immediately after Alice transfers it to Bob:

- `owner()` resolves Bob;
- Alice's calls revert;
- Alice's ERC-1271 signatures stop validating;
- Bob can execute and validate signatures;
- the account address and its assets do not move.

The account does not cache Alice, the activator, or any authorization epoch. V1 has no session permissions to clean up because agent authority is zero.

## Account capabilities

`DroidAccountV1` supports:

- receiving the native chain asset (ETH on Robinhood, MON on Monad);
- ordinary owner-authorized `CALL` execution;
- a bounded, atomic owner-authorized batch of up to 32 calls;
- ERC-721 safe receipt, except NFTs from the controlling collection;
- ERC-1155 single and batch receipt;
- ERC-1271 validation against the current owner;
- ERC-6551 token binding, signer, state, and execution interfaces;
- indexed native receipt, execution, batch, ERC-721, and ERC-1155 events.

V1 deliberately does not support:

- `delegatecall`, CREATE, or CREATE2 through account execution;
- EntryPoint/UserOperation execution;
- session keys or agent keys;
- admin execution or admin withdrawal;
- implementation upgrades;
- arbitrary backend commands;
- price or oracle logic.

An owner can use `execute` to recover unlocked ETH, ERC-20s, and NFTs. External protocol positions remain subject to their own lock and withdrawal rules.

## Asset and portfolio model

The reader separates five concerns:

```text
configured discovery → balance reads → optional price source → valuation → Droid OS UI
```

V1 reads:

- the native-chain balance at the account address;
- explicitly configured ERC-20 balances;
- explicitly configured ERC-721 collection inventory;
- existing HoodYØØR Energy at the account address;
- the current commander's separate HoodYØØR Energy balance;
- account and ownership events where the configured RPC provides historical logs.

USDG is the prominent default token on Robinhood mainnet. The staged Monad reader uses address-qualified WMON and USDC candidates. Additional assets require explicit per-chain configuration.

Unknown tokens and NFTs remain owned by the account but may not appear in trusted inventory. This avoids presenting a malicious lookalike asset as equipment or a supported financial asset.

No price source ships in V1. `portfolioValue` stays `null`, and the UI renders `Value unavailable`. A read failure is also surfaced as unavailable rather than fabricated as `$0`.

## Energy

Energy remains each native ecosystem's existing non-transferable ledger keyed by address, not an ERC-20. Robinhood Energy uses integer units; Monad Energy uses 18-decimal internal units. V1 does not create another Energy token, assign a price, change roles/costs, or migrate commander Energy into a Droid Account.

The dashboard displays:

- **Droid Energy**: `energyBalance(droidAccount)`;
- **Commander Energy**: `energyBalance(currentNftOwner)`.

Future missions may credit or spend Droid Energy only after explicit economic and role review.

## Equipment foundation

`IDroidEquipmentResolver` defines a read-only boundary for resolving equipment contract, token ID, slot, type, compatibility, enabled state, and metadata. Frontend inventory records use the same neutral slot model.

No V1 resolver can move assets or rewrite the frozen HoodYØØR renderer. A future implementation can recognize an allowlisted equipment NFT currently owned by the Droid Account and project its effect into a profile or renderer adapter. Removing the NFT naturally removes eligibility.

## Frontend integration

Routes:

- `/robinhood/droids` — connected owner's Droid Squad and direct token lookup;
- `/robinhood/droids/[tokenId]` — Droid Core, portfolio, inventory, Energy, Directive, activity, and security;
- `/monad/droids` and `/monad/droids/[tokenId]` — the same shared UI for the chain-143 D.Y.O.O.R collection;
- `/api/droid-accounts?chainId=...` — common chain-qualified read-only snapshots;
- `/api/robinhood/droid-accounts` — backwards-compatible Robinhood wrapper.

Wallet writes use the existing EIP-1193 provider and the requested native-chain adapter. Each action:

1. checks deployed configuration;
2. switches to the configured native network;
3. re-reads current NFT ownership;
4. verifies the expected deterministic account;
5. estimates gas;
6. requests the owner transaction;
7. waits for confirmation;
8. refreshes current state.

The API cannot authorize writes. It supplies informational state only. Contract checks remain authoritative.

The interface exposes exact destination addresses and prominently states that deposited funds belong to the NFT's account. On iPhone-sized layouts, warnings and owner controls remain full-width rather than being reduced to fine print.

## Parent-NFT transfer behavior

Every detail security panel includes a reusable warning with underlying native, configured token, and NFT balances. It states that transferring or selling the parent NFT transfers account control and does not return assets automatically. Energy is displayed separately from real assets.

The Monad parent NFT is burnable. Burning makes `ownerOf(tokenId)` fail, so the account intentionally has no controller and any remaining assets are locked. The official Trait Lab blocks burns when its chain-qualified account snapshot is incomplete or when the account is active/detectably funded. Direct external burns remain a collection-level risk.

This interface does not claim that a third-party marketplace discovers or values account contents. Account contents may also change before an external marketplace settlement. Marketplace-specific atomic sale protocols are deferred.

## Activity and indexing

V1 derives critical activity from collection, facade, and account events. The small collections permit direct reads with live `ownerOf` verification. Squad discovery first attempts indexed inbound Transfer logs and uses a bounded direct-read fallback when an RPC does not provide archive logs. For the burnable/non-enumerable Monad collection, the issued-token upper bound comes from `totalMinted()`, not live `totalSupply()`.

Production should configure a server-only provider/archive endpoint. Robinhood's public RPC is a rate-limited fallback and is never represented as production indexing infrastructure. If scale or latency requires it later, the same event model can feed an indexer without changing custody.

## Version and upgrade strategy

`DroidAccountV1` is immutable. The facade pins one implementation version and has no setters. A future V2 uses a new implementation and a new immutable facade/configuration.

Because implementation is part of the deterministic binding, a V2 account has a different address. Assets in V1 never migrate automatically. The owner retains the V1 account and can explicitly move assets after reviewing V2. This is less convenient than a proxy upgrade but avoids a project-admin ability to silently alter every existing account.

The existing NFT, Energy Bank, renderer, trait store, reroll controller, and holder verification are not migrated.

## Directives, sessions, Missions, XP, and Droid Score

V1 exposes disabled data models only:

- Directive: `MANUAL`;
- Agent authority: `ZERO`;
- session keys: `0`;
- Missions: no on-chain execution;
- XP/achievements/score: no fabricated values.

A future session design must bind authorization to the authorizing current owner or an ownership epoch, include chain/account/domain/nonces, enforce target and selector capabilities on-chain, use token-denominated limits or approved oracles, and invalidate immediately when the parent NFT transfers. It must preserve an owner execution route while agent execution is paused.

Robinhood's account-abstraction support alone is not an implementation. A concrete EntryPoint version, bundler, paymaster policy, replay model, and audited capability module must be selected before V3.

## Deployment

### Local build and tests

```bash
npm run build:robinhood:droid-accounts
npm run test:robinhood:droid-accounts
```

Monad staging uses the same sources and an isolated Cancun fork artifact directory because a live Monad dependency uses newer opcodes while deployment artifacts remain Paris-targeted:

```bash
npm run build:monad:droid-accounts
npm run test:monad:droid-accounts
npm run test:monad:droid-accounts:fork
npm run preflight:monad:droid-accounts
```

The Monad preflight has no signer or broadcast path. See `docs/monad-dyoor-droid-deployment-report.md` before any production action.

### Safe deployment dry-run

```bash
npm run deploy:robinhood:droid-accounts:testnet
```

Dry-run is the default and sends no transaction. Execution requires a dedicated testnet NFT collection, RPC, deployer key, and explicit flag:

```bash
HOODYOOR_DROID_TESTNET_COLLECTION_ADDRESS=0x... \
HOODYOOR_DROID_DEPLOYER_PRIVATE_KEY=0x... \
EXECUTE_HOODYOOR_DROID_DEPLOYMENT=1 \
npm run deploy:robinhood:droid-accounts:testnet
```

Never place a real key in shell history, source control, browser environment variables, or documentation. Use the existing private local environment workflow.

The script verifies the expected chain, controlling collection code, and canonical registry runtime hash before its first transaction. Mainnet additionally requires the exact `ALLOW_HOODYOOR_DROID_MAINNET` and chain-specific acknowledgement gates, checks the live HoodYØØR frozen configuration, estimates both deployments, and requires a 3× ETH balance buffer. Local 1337/31337 deployments are available by selecting `HOODYOOR_DROID_DEPLOYMENT_TARGET=local` and supplying local collection and registry addresses.

The checkpoint at `deployments/robinhood/droid-accounts-<chainId>.json` records addresses, transaction blocks, runtime hashes, exact constructor encoding, compiler, optimizer, IR, and EVM settings needed for verification.

### Robinhood mainnet deployment

Deployment completed on 2026-08-11 after a clean build, 72 local Solidity test passes, five deployment/UI guard-test passes, a fresh Robinhood mainnet fork simulation, and a live non-broadcasting invariant preflight.

- Implementation transaction: `0x1605862ea19f7b5e1944b12aad703657cd24b76c061f1a198bc1fce7f17cb747`
- Registry transaction: `0xe85480a44c56ac02233c87c574f06646f8b607cc831cc205e3435b8c5ccad0c2`
- Total deployment fee: `0.000046840644072 ETH`
- Counterfactual token #1 account: `0xbA23CC9C7C13E6cE599cd1c5E1085904F0Fa6709`

Both contracts are source-verified on Robinhood Blockscout. Independent post-deployment RPC reads confirmed bytecode, immutable wiring, chain/collection binding, the token #1 address, collection supply, and the unchanged reroll controller.

## Emergency procedures

V1 has no autonomous agent to pause and no protocol administrator who can rescue user funds.

For an ordinary asset or malicious external protocol incident:

1. stop interacting with the affected target/token in the UI configuration;
2. current NFT owner uses direct `execute` to recover unaffected, unlocked assets;
3. do not transfer the parent NFT until account contents are reviewed;
4. publish exact affected contracts/selectors and preserve event evidence;
5. ship a new version only after review—never alter V1 in place.

If the NFT is deliberately sent into a self/circular ownership graph with raw unsafe ERC-721 transfers, V1 fails closed and there may be no rescue path. See the security document before any transfer automation is built.

## Known limitations

- The contracts have comprehensive automated tests but no independent audit.
- The mainnet implementation/facade are live but have not received an independent audit.
- Public RPCs can be rate-limited; historical activity may be partially unavailable.
- Inventory is allowlist-based, not arbitrary-asset discovery.
- Prices and total fiat values are unavailable.
- ERC-20 return values and hostile token behavior remain token-specific risk.
- Existing ERC-721 raw `transferFrom` can bypass receiver-cycle prevention.
- No session key, ERC-4337, agent, Mission, score, or on-chain Equipment logic is active.
- Burning a Monad parent NFT outside the first-party guard can permanently remove account control.

Security details and the full threat model are in [droid-account-security.md](./droid-account-security.md).
