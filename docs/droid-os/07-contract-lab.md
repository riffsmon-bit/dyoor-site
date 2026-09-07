# Local mint-permission contract experiment

Status: local-only prototype, not audited, not deployed on any public chain, and NOT an upgrade or replacement for an existing Droid Wallet. The constructors and account authority checks reject chains other than 31337. No stored owner key, production secret, NFT role or metadata was used or changed.

## What exists

- `LabCollection`: a test identity with a monotonic ownership epoch. It is deliberately not Season 2 or a complete marketplace-compatible ERC-721.
- `LabMint`: a fixed inspectable mint fixture, supporting zero or nonzero prices. No approvals, operators or arbitrary external calls.
- `DroidMintAccountLab`: direct NFT-bound custody for this experiment, current-owner grant/withdrawal, one typed `NFT_MINT` permission, separate executor/reviewer, reserve/per-action/daily value/action limits, seven-day maximum grant lifetime, exact-action hash, revision, nonce, short simulation-attestation lifetime, pinned fixture bytecode and post-mint recipient/balance checks.

The executor supplies a nonce only. It cannot select target, calldata, recipient or value. The mint recipient is the account. Default state has no grant. Owner withdrawal is separate and may withdraw the owner's protected reserve; delegated execution cannot. No AI provider or unrestricted signing tool is attached.

## Run without a wallet or real funds

```sh
forge test --root contracts/droid-os-lab -vv
forge build --root contracts/droid-os-lab
node scripts/test-droid-contract-lab.mjs
```

The runner creates a fresh loopback Anvil on an ephemeral port and uses its disposable unlocked accounts. It does not load dotenv, accept a remote RPC argument, read a wallet file or expose private keys. Local RPC transactions deploy the three fixtures, fund directly, grant, attest, simulate and mint; replay and transfer failures are checked. The node is terminated afterward. Its addresses/receipts are local test evidence, not public deployments or preview wallet destinations.

The expanded Foundry suite passed 37 tests including 256 reserve-fuzz cases: default denial, grant roles/expiry/revocation, reviewed actions, reserve/value/action caps, zero-price mint caps, stale simulation, nonce/cross-account replay, bytecode change, wrong recipient, unrestricted-call rejection, native/NFT withdrawals, reentrancy, UTC-day rollover, A→B transfer, A→B→A and explicit mainnet/public-testnet blocking. UTC-day limits are fixed calendar windows, not rolling 24-hour caps; this is now tested explicitly.

## Interactive local console and CI

Run `npm run lab:droid-contracts`, then open **http://localhost:3203** on the same computer. Click **Run local contract scenario** to deploy fresh disposable fixtures and run the full funding/grant/review/mint/revocation/transfer/withdrawal sequence. Actual local receipts and verification results appear only after the runner succeeds. No stored wallet or real funds are needed. Each node is shut down after its run; local hashes are not public explorer links.

The hosted `/droid-os/lab` preview explains the scope and links to the local console and GitHub checks. It does NOT remotely execute tests or connect to a mainnet wallet. On a phone, `localhost` means the phone; public mobile contract testing still requires a dedicated public test environment.

The local server binds 127.0.0.1, validates Host against loopback (DNS-rebinding defense), requires matching Origin and same-origin JSON POST, accepts no run parameters, blocks concurrent runs, limits request/output sizes and execution time, and clears prior success on failure. Six server tests cover cross-site requests, injected RPC/key/transaction parameters, oversized bodies, failures and concurrency. This is a development console, not a production signing service.

GitHub preview CI now installs a commit-pinned official Foundry action and Foundry v1.5.1, runs the contract suite and disposable local transaction flow, as well as server/web tests, TypeScript, ESLint and the production build. The runner checks exact custom revert reasons; RPC outages do not count as successful security rejections.

## Unresolved production boundaries

1. Season 2 does not expose this fixture's ownership epoch. The prototype does NOT solve transfer-epoch verification for the existing immutable collection or V1 wallets. No wrapping, NFT escrow or wallet migration has been chosen.
2. Reviewer attestation is a trusted software assertion, not cryptographic proof of simulation. The runner additionally checks an account-context eth_call. Production needs independently validated effects, provenance, freshness, receipt reconciliation and durable off-chain evidence.
3. The fixed mint fixture is not a Seaport, launchpad or DEX adapter. Memecoin buy/sell, NFT sniping, approvals, token exits, pricing and autonomous discovery are not implemented.
4. Gas is paid by disposable executor/reviewer accounts in the lab, not reimbursed from the Droid. Real relayer funding/reimbursement and gas budgets are unresolved. Native reserve accounting here covers mint value, not a claim about future relayer fees.
5. UTC-day counters persist across grant replacement. Owner-authorized new limits can change the budget; grant renewal cannot erase prior spend. Concurrent nonce use permits only one successful execution. Failed real transactions may still cost executor gas.
6. This minimal fixture account supports native and its specific test-NFT withdrawal, not generic ERC-20/ERC-721/ERC-1155 production custody interoperability. The mock mint is not a full ERC-721. Additional adversarial testing and independent review remain necessary. Do not put real assets into it.

The user has now selected Monad mainnet as the eventual public testing target and approved opt-in V2 accounts at new addresses. The current lab still cannot deploy to Monad testnet or mainnet; its guards remain intact. See [the separate V2 custody candidate](09-opt-in-v2-wallet.md) for real-collection fork compatibility testing and unresolved delegated authority. The existing public preview remains read-only; merely adding these source files cannot activate financial execution.
