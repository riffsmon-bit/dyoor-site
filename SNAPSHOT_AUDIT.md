# DYOOR Snapshot Audit

Last updated: 2026-06-30

## Scope

This audit covers the owner-only admin snapshot tools for:

- Ascension Staking Snapshot
- Ascension Blueprint Snapshot
- Combined Ascension Snapshot

Main route:

- `/admin` and `/admin-command-center`
- API: `/api/admin/snapshots`

## Owner Access

Admin authorization uses the configured owner wallet from environment via `adminOwnerWallet()`.

Accepted env names:

- `ENERGY_ADMIN_ADDRESS`
- `DYOOR_OWNER_ADDRESS`
- `ADMIN_WALLET`
- `OWNER_WALLET`
- first address from `ADMIN_WALLETS`

Server-side checks:

- Owner wallet comparison is case-insensitive.
- Each snapshot API request requires a `DYOOR Admin Command` signed message.
- The signed message includes action, wallet, timestamp, and nonce.
- Snapshot scan and finalize requests consume fresh nonces.
- Timestamps expire after the configured admin window.
- Private env values are never returned to the browser.

## Staking Data Source

Authoritative current-state source:

- S1 `ownerOf(tokenId)` must equal the Ascension staking contract.

Cross-check:

- S1 `balanceOf(ascensionStakingContract)` must equal the number of ownerOf-verified staked token IDs.

Wallet assignment:

- `AscensionStaking.stakeInfo(tokenId)` is used to assign the staker wallet and staking timestamp when available.
- If `stakeInfo` does not return a staker, the token remains counted as currently staked but is flagged as unregistered/warning.

Default contracts:

- S1: `0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f`
- Ascension staking: `0xf9611226c1CcCcCa37951938d6f358D3d5106549`
- Energy Bank: `0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767`

Start block:

- `ASCENSION_START_BLOCK` or `NEXT_PUBLIC_DYOOR_S1_START_BLOCK`
- Fallback: `54985442`

## Event/Indexer Use

The snapshot system may use Goldsky or transfer-log discovery to find candidate token IDs, but exported staking eligibility is not trusted until current S1 ownership is verified with `ownerOf`.

Goldsky fields used when configured:

- `stakeds`
- `unstakeds`

RPC fallback discovery uses S1 `Transfer` logs to the Ascension staking contract.

## Blueprint Data Source

Authoritative source:

- Netlify Blob store `ascension-blueprints`
- Key: `ascension-blueprints.json`

Fallback source:

- `data/ascension-blueprints.json`

Snapshot behavior:

- Wallets are normalized lowercase.
- Invalid wallet records are excluded from latest-wallet CSV rows and reported as warnings.
- If multiple stored records exist for one wallet, the latest timestamp/rank is selected for CSV.
- JSON export includes both latest rows and all stored versions.
- Missing traits export as `None`.

Trait export order:

1. Background
2. Droid
3. Eyes
4. Clothes
5. Mouth
6. Hat
7. Special
8. Accessories

## Energy Fields

Snapshot energy fields are best-effort support columns, not the staking source of truth.

Sources:

- Pending Energy: Ascension staking `pendingPoints(wallet)`
- Lifetime Energy: Energy Bank `lifetimeEnergy(wallet)`
- Energy Bank: Energy Bank `spendableEnergy(wallet)`
- Harvested Energy: `ascension-energy-ledger` blob record with local `data/harvested-energy.json` fallback

Rows include `energyDataSource` so exports show whether harvested Energy came from blob, local fallback, or no record.

## Validation Checks

Staking:

- ownerOf-verified token count equals S1 `balanceOf(stakingContract)`
- no duplicate token IDs after normalization
- no staked wallet row is trusted without token IDs
- active tokens without `stakeInfo` staker are flagged

Blueprint:

- latest Blueprint rows are unique by wallet
- invalid wallet records are counted and warned
- missing image or ID/hash is warned
- duplicate wallet records are warned and latest selected

Combined:

- lowercased wallet matching is used
- every wallet from staking or Blueprint source appears in the combined snapshot

If validation fails, the snapshot is marked `failed` and should be treated as a debugging export, not a trusted eligibility list.

## Export Names

Staking:

- `ascension-staking-snapshot-YYYY-MM-DD-HHMM.csv`
- `ascension-staking-snapshot-YYYY-MM-DD-HHMM.json`

Blueprint:

- `ascension-blueprint-snapshot-YYYY-MM-DD-HHMM.csv`
- `ascension-blueprint-snapshot-YYYY-MM-DD-HHMM.json`

Combined:

- `combined-ascension-snapshot-YYYY-MM-DD-HHMM.csv`
- `combined-ascension-snapshot-YYYY-MM-DD-HHMM.json`

## Known Limitations

- First/last staking block is blank unless an indexer provides block metadata. `stakeInfo.stakedAt` is exported when available.
- Harvested Energy depends on the Energy ledger blob/local fallback. It is included for admin review but does not determine staking eligibility.
- Export history is written to Netlify Blobs when available. If Blob storage is unavailable locally, history may be empty.
- Manual owner-wallet testing is still required before using a fresh production snapshot for rewards.

## Safe Use

A snapshot is safe to use only when:

- Validation status is `verified`.
- Total ownerOf-verified staked token IDs equals S1 `balanceOf(stakingContract)`.
- Blueprint warnings are reviewed.
- The owner confirms the generated timestamp and expected totals.
