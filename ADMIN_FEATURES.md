# D.Y.O.O.R Admin Features And Wallet Architecture

## Wallet Architecture

The app uses a global WalletService provider instead of direct page-level Privy coupling.

Priority:

1. Privy active wallet when `NEXT_PUBLIC_PRIVY_APP_ID` is configured and available.
2. Browser injected EVM wallet fallback.

Supported injected wallet signals:

- MetaMask
- OKX
- Backpack
- Rabby
- TokenPocket
- Phantom EVM
- Generic `window.ethereum`

Interface:

- `connect()`
- `disconnect()`
- `getProvider()`
- `getSigner()`
- `getAddress()`
- `sendTransaction()`
- `signMessage()`
- `switchChain()`

No page should permanently wait on Privy readiness. The wallet button exposes loading, connecting, retry, connected, wrong-network, and error states.

## Security

Owner-only tools are protected server-side. Frontend hiding is treated as a convenience only.

Protected admin APIs require:

- Owner wallet from environment.
- Fresh timestamp.
- Nonce.
- Wallet signature.
- Server-side signature recovery.

Owner env names accepted:

- `ENERGY_ADMIN_ADDRESS`
- `DYOOR_OWNER_ADDRESS`
- `ADMIN_WALLET`
- `OWNER_WALLET`
- `ADMIN_WALLETS`

## Snapshot Tools

Admin panel can generate:

- Staking Snapshot
- Blueprint Snapshot
- Combined Ascension Snapshot

Exports:

- CSV
- JSON

Staking snapshot includes:

- wallet
- token IDs
- staked count
- pending Energy
- harvested Energy
- lifetime Energy
- timestamp

Blueprint snapshot includes:

- wallet
- saved blueprint state
- saved date
- blueprint ID/hash
- image fields
- traits
- eligibility
- timestamp

Owner can search across snapshot tables by wallet, token ID, blueprint ID, trait, or status.

## Energy Airdrop

Location: Admin Panel.

Features:

- Single wallet or bulk wallet list.
- CSV upload.
- Paste wallet list.
- Deduped preview.
- Wallet count.
- Energy each.
- Total Energy.
- Confirmation checkbox.
- Progress/status UI.
- Success/failure output.
- CSV/JSON export.

Execution uses existing Energy Bank `airdropEnergy`. It does not create ERC20 tokens and does not alter Energy math.

Required operator permission:

- Energy Bank `DEFAULT_ADMIN_ROLE`.

## Lend to a Fren

Location: Ascension page.

Features:

- Recipient wallet input.
- Energy amount input.
- Current Energy Bank balance preview.
- Remaining balance preview.
- Recipient preview.
- Connected wallet validation.
- Zero address and self-transfer prevention.
- Positive amount validation.
- Cannot exceed spendable Energy.
- Wallet signature authorization.
- Server-side verification.
- Balance refresh after success.

Execution model:

1. Sender signs a D.Y.O.O.R Energy Transfer message.
2. Server verifies the signature.
3. Server checks spendable Energy.
4. Server spends sender Energy.
5. Server credits recipient Energy with the same transfer ID.

Required operator permissions:

- Energy Bank `SPENDER_ROLE`
- Energy Bank `CREDIT_ROLE`

## Recharge Energy

Recharge remains active:

- 50 Energy = 1 MON.
- MON must go to treasury wallet.
- Server verifies sender, recipient, amount, receipt, and chain.
- Server prevents replay through Energy Bank `usedClaimTxHash`.
- Server credits Energy only after payment verification.

## Ascension Recovery

Ascension now includes:

- Compact Ascension Health dashboard.
- Automatic recovery scan.
- Recoverable token count.
- Token IDs when detected.
- Recovery reason.
- Estimated transaction count.
- One-click `Recover My NFTs`.
- Manual fallback input only when auto-detection is unavailable.

Recovery detection uses S1 start block `54985442` and runs with a bounded timeout so the main dashboard remains fast.

## Future Expansion Notes

- WalletConnect can be added as another WalletService source without changing page code.
- Marketplace, Future Mint, and other wallet flows should use WalletService only.
- Legacy Netlify functions should be converted to ESM or `.cjs` to remove local bundling warnings.
- Consider a durable server-side transfer ledger for Energy transfer history.
