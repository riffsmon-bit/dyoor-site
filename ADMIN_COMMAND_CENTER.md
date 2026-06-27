# DYOOR Admin Command Center

## Route

- `/admin`
- `/admin-command-center`

Both routes load the same owner-only command center.

## Owner Wallet ENV

The owner wallet is read server-side from the first configured value:

1. `ENERGY_ADMIN_ADDRESS`
2. `DYOOR_OWNER_ADDRESS`
3. `ADMIN_WALLET`
4. `OWNER_WALLET`
5. `ADMIN_WALLETS`

Address comparisons are case-insensitive after EVM checksum normalization. No owner address is hardcoded in the app.

## Security Model

Admin UI hiding is not treated as security. Admin API routes verify:

- connected wallet address submitted by the client
- configured owner wallet from ENV
- action-specific signed admin message
- timestamp within a 5 minute window
- nonce length
- in-memory nonce replay protection

The signed message format is:

```text
DYOOR Admin Command
Action: <snapshot|energy-airdrop>
Wallet: <owner wallet>
Timestamp: <unix milliseconds>
Nonce: <uuid>
```

Snapshot signatures cannot be reused for Energy airdrops because the action is part of the signed payload.

## Energy Airdrop

The Energy Airdrop tool credits internal Energy through the existing Energy Bank contract. It does not create ERC20 Energy and does not change Energy math.

Supported input:

- one wallet per line
- comma-separated wallets
- pasted CSV text
- CSV upload

Preview shows:

- raw entry count
- valid wallet count
- duplicate wallets removed
- invalid entries
- Energy per wallet
- total Energy requested
- estimated action count

Execution requires:

- owner wallet connection
- owner signature
- confirmation checkbox
- valid campaign ID
- positive Energy amount

Server execution batches recipients in groups of 150. For multi-batch airdrops, batch campaign hashes are derived from:

```text
<campaign-id>:batch:<index>/<total>
```

Each batch checks `usedAirdropCampaign` before sending. Results include per-wallet success or failure.

## CSV Format

CSV input can be simple wallet-only rows. The parser accepts wallet addresses separated by whitespace, commas, semicolons, or line breaks. Extra CSV columns are ignored unless they contain valid EVM addresses.

Example:

```csv
wallet
0x1111111111111111111111111111111111111111
0x2222222222222222222222222222222222222222
```

## Result Export Format

CSV/JSON result exports include:

- wallet
- status
- Energy amount
- campaign ID
- transaction hash
- block number
- error
- timestamp
- note

## Known Limitations

- Nonce replay protection is in-memory for the current server process. A durable nonce store should be added before high-volume production admin usage on stateless hosts.
- Energy airdrop execution requires the Energy Bank operator private key ENV and `DEFAULT_ADMIN_ROLE`.
- Real airdrop execution should be tested with a small owner-approved wallet list before any large campaign.
