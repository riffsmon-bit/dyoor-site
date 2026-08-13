# HoodYØØR contracts

This directory contains the first end-to-end contract slice for the 3,333-token
HoodYØØR collection on Robinhood Chain.

The code has not been independently audited or deployed. It includes the original
behavioral prototype and the production bytecode-backed art path for the approved
128×128 collection. A full local chain-4663 rehearsal deploys every component, loads
all generated data, verifies and uses the combined paid-GTD tree, mints the owner
reserve at GTD activation, reveals, credits Energy, and settles a signed gasless
reroll.

## Fixed collection economics

| Setting | Value |
| --- | ---: |
| Maximum supply | 3,333 |
| Owner reserve | 150, minted to the current owner at first GTD activation |
| Paid allocation | 3,183 |
| Combined GTD cohort | 333 wallets / 733 maximum mints |
| Mint price | 0.0025 ETH |
| Paid-mint reward | 1,000 non-transferable Energy per NFT |
| Maximum paid-mint proceeds | 7.9575 ETH |
| Secondary trading | Locked until mint #1,667 or permanent owner early-unlock |
| Royalty | 300 bps (3%) |
| Owner | `0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6` |
| Treasury / royalty receiver | `0xC7f55cE6A7dF9A79cc4A643a5081230F890c7AA6` (same as owner) |

Robinhood Chain mainnet uses chain ID `4663`; testnet uses `46630`. Deployment is
intentionally excluded from this phase.

## Architecture

- `HoodYOOR.sol`: ERC-721 behavior, ERC-2981 royalties, ERC-4906 metadata events,
  paid minting with atomic Energy rewards, the one-time owner reserve, GTD Merkle
  proofs, the one-way secondary-market gate, packed token assignments, renderer
  freeze, and the authorized reroll hook.
- `HoodYOORPackedTraitStore.sol`: production registry for names and packed pixel
  rectangles stored across immutable 24,000-byte data contracts.
- `HoodYOORPixelRenderer.sol`: production 128×128 decoder and fully on-chain SVG /
  Base64 metadata renderer.
- `BytecodeStorage.sol` and `PixelSVG.sol`: immutable data-contract storage,
  cross-chunk reads, packed rectangle validation, and deterministic SVG decoding.
- `HoodYOORTraitStore.sol` and `HoodYOORRenderer.sol`: small contract-storage
  prototype retained for focused collection-behavior tests.
- `HoodYOORPrototypeSVG.sol`: small, representative 1024-viewBox vector fragments
  for storage and rendering measurements. These are not final traced collection art.
- `HoodYOORTraitRules.sol`: permanently frozen registry of the 329 canonical
  pairwise catalog incompatibilities.
- `HoodYOORRerollController.sol`: chain-local Energy settlement, EIP-712 holder and
  result-authority signatures, replay protection, compatibility checks, and atomic
  mutable-trait updates.
- `HoodYOOREnergyBank.sol`: non-transferable, replay-protected Robinhood Energy
  balances with separate credit, pause, and spender roles.

## Packed layers

Each token uses one `uint256`; each layer receives 16 bits.

| Offset | Layer | Launch behavior |
| ---: | --- | --- |
| 0 | Background | Locked |
| 16 | Droid | Locked |
| 32 | Conditions | Rerollable |
| 48 | Clothes | Rerollable |
| 64 | Mouth | Rerollable |
| 80 | Eyes | Rerollable |
| 96 | Hat | Rerollable |
| 112 | Accessories | Rerollable |
| 128 | Accessories 2 | Rerollable |

Trait ID `0` represents `None`. The ten unique Project M.A.D. backgrounds retain
their canonical catalog IDs (`101`, `102`, `103`, `105`, `112`, `115`, `116`,
`117`, `119`, and `120`). INDAHOOD retains ID `122`. The NFT enforces that each
Project M.A.D. ID occurs once and ID `122` occurs exactly 3,323 times before
assignments can be frozen.

The renderer uses the canonical order:

1. Background
2. Droid
3. Conditions
4. Clothes
5. Mouth
6. Eyes
7. Hat
8. Accessories
9. Accessories 2

## Launch safety

Paid minting stays disabled until:

1. All 3,333 packed assignments have been loaded.
2. Background counts pass their exact on-chain checks.
3. Initial assignments are permanently frozen with a provenance hash and reveal
   commitment.
4. The renderer address is permanently frozen.
5. The reroll controller is permanently wired and frozen.
6. The Energy Bank and 1,000-Energy paid-mint reward are permanently frozen.

The production deployment checklist must also freeze the associated trait store.
While minting is active, every token returns a fully onchain placeholder and the
assignment table cannot be mapped to token IDs. Finalization closes every mint path
permanently, reveals the committed secret, and targets a future block hash. Anyone
can then finalize a fixed 16-round swap-or-not permutation over all 3,333 assignment
slots. Rerolls remain disabled until that reveal completes.

Secondary transfers and new marketplace approvals begin locked. The gate opens
automatically when total supply reaches 1,667, the first whole-token count at or
above 50% of 3,333. The current owner may unlock earlier, but unlocking is permanent:
there is no function that can re-freeze holder transfers. Approval revocations remain
available while locked. The 150-token owner reserve is included in `totalSupply`, so
1,517 additional paid mints after GTD activation reach the automatic threshold.

## Generated production art

`scripts/generate-robinhood-onchain-art.js` converts every retained raster trait
into the exact binary format consumed by `HoodYOORPackedTraitStore`:

| Measurement | Generated value |
| --- | ---: |
| Retained non-None traits | 201 |
| Merged pixel rectangles | 142,849 |
| Names + packed artwork | 586,295 bytes |
| Immutable data contracts | 25 |
| Full 24,000-byte chunks | 24 |
| Final chunk | 10,295 bytes |

The committed catalog hash is
`0x50e0424b927b0da11b01947b6839070d81b6aa982b214c63f78f4adb8cb756d3`.
The full manifest and per-trait hashes live under `data/robinhood/onchain-128/`.
The integration test deploys all 25 chunks locally, registers all 201 traits, checks
the thin-mouth correction, and renders the approved signature combination.

## Generated assignments and combined GTD tree

`scripts/generate-robinhood-assignments.js` deterministically builds 3,333 unique,
renderable, compatibility-safe assignments while preserving every exact rarity and
sequence cooldown. The packed 59,994-byte payload is frozen at provenance hash
`0x2b3049a8235d705dba39542b53990e584e3815e4e6a32efae6ecb810b8f506a3` and loads in
67 batches of at most 50 assignments.

`scripts/generate-robinhood-gtd.js` combines 133 Monad D.Y.O.O.R holders with the
supplied 200-wallet Robinhood top-holder list. Every unique Monad holder receives one
paid GTD mint; imported Robinhood wallets retain their three-mint limit. Duplicate
wallets take the higher allowance rather than stacking. The current frozen tree has
333 wallets, an aggregate allowance of 733, and root
`0x915e9b6ddcfe13a197ade8f6b776d37beb8ce2f766001e6579bd0601ffc5dd31`.
The imported OpenSea price column is deliberately ignored: every HoodYØØR GTD mint
uses the contract price of 0.0025 ETH.

The first GTD activation atomically mints token IDs 1–150 to the current collection
owner at no charge. This reserve can only mint once, leaves `paidMinted` unchanged,
earns no mint Energy, and counts toward the secondary-market unlock threshold. Every
paid GTD or public mint atomically credits 1,000 whole Energy per NFT to its recipient;
if that credit cannot settle, the entire mint reverts.

The Background and Droid bits cannot change through `applyReroll`. The reroll
controller preserves the existing preview → accept UX: an authorized result signer
signs a compatible result, the current token holder signs acceptance, and any
relayer may submit both signatures. The holder pays no gas. The controller consumes
the token nonce, spends Energy, and applies the packed traits in one transaction, so
a downstream failure rolls every state change back.

Single-reroll Energy costs preserve the established Trait Lab tiers: Eyes and Mouth
cost 100; Clothes and Hat cost 200; Accessories and Accessories 2 cost 300. The new
Conditions slot uses the 200 tier. Reroll All costs 1,000, changes every currently
filled mutable slot, and leaves empty slots empty. Background and Droid remain
locked. Holder signatures support both EOAs and ERC-1271 smart wallets.

`scripts/generate-robinhood-reroll-rules.js` deterministically converts the retained
catalog rules and duplicate-accessory rule into a 1,974-byte deployment table. The
329-pair registry freezes with rules hash
`0x14a33149be765254e70441c4ba2674c662f5b3f746fb3ac8a717a4f49b47ab0f`.

## Contract-connected Trait Lab test

The isolated test interface lives at `/robinhood/trait-lab`. It remains in safe
setup mode unless every server-side deployment value is present and the live
contracts pass their wiring checks:

```text
HOODYOOR_TRAIT_LAB_ENABLED=1
HOODYOOR_RPC_URL=...
HOODYOOR_CHAIN_ID=46630
HOODYOOR_COLLECTION_ADDRESS=0x...
HOODYOOR_ENERGY_BANK_ADDRESS=0x...
HOODYOOR_REROLL_CONTROLLER_ADDRESS=0x...
HOODYOOR_RESULT_SIGNER_PRIVATE_KEY=0x...
HOODYOOR_RELAYER_PRIVATE_KEY=0x...
HOODYOOR_EXPLORER_URL=...                 # optional
HOODYOOR_CHAIN_NAME=...                   # optional
```

The relayer key may be omitted during a local prototype, in which case the result
signer also relays. Separate keys are recommended for a real testnet. Private keys
are server-only and must never use a `NEXT_PUBLIC_` prefix. Chain `4663` additionally
requires `ALLOW_HOODYOOR_MAINNET=1`; the default test path accepts only `46630`.

At startup and periodically thereafter, the API verifies the RPC chain, contract
bytecode, controller-to-collection and Energy Bank wiring, frozen 329-pair rules
hash, result signer, Energy spender role, and relayer gas balance. Preview requests
require a free owner signature (EOA or ERC-1271). The server produces one
deterministic weighted result per token state/action, returns SVG decoded from the
committed onchain-art binary, and stores a five-minute authorization. Acceptance is
the exact controller EIP-712 payload; the relayer preflights and submits it, so the
nonce, Energy debit, and packed-trait mutation settle atomically.

## GTD tree

The contract leaf is compatible with OpenZeppelin `StandardMerkleTree` values of:

```text
["address", "uint256"] => [wallet, maxMint]
```

The leaf is double-hashed as:

```solidity
keccak256(bytes.concat(keccak256(abi.encode(wallet, maxMint))))
```

Wallet signatures are verified off-chain before a wallet enters the final tree.
See `docs/GTD_WALLET_HANDOFF.md` and `docs/gtd-wallet-export.schema.json`.

## Local checks

From this directory:

```bash
forge fmt --check
forge test --offline -vv
forge build --sizes
```

Or run:

```bash
bash script/check-prototype.sh
```

Regenerate and verify the production payload from the repository root:

```bash
npm run generate:robinhood:onchain-art
npm run generate:robinhood:assignments
npm run generate:robinhood:gtd
npm run generate:robinhood:reroll-rules
npm run generate:robinhood:energy-migration
npm run generate:robinhood:launch-manifest
npm run build:robinhood:security-review-bundle
npm run build:robinhood:opensea-branding
npm run preflight:robinhood:mainnet
npm run deploy:robinhood:mainnet
npm run deploy:robinhood:onchain-art
npm run deploy:robinhood:core
npm run deploy:robinhood:reroll
npm run finalize:robinhood:launch
```

The deploy command is a non-networked verification dry run unless
`EXECUTE_HOODYOOR_ART_DEPLOYMENT=1` is explicitly supplied. Execution is restricted
to Robinhood Chain testnet by default and writes a resumable checkpoint after every
transaction. It deploys only the frozen art store and renderer; collection launch is
kept separate until assignments and the reroll controller are finalized.

The reroll deploy command is also a non-networked verification dry run unless
`EXECUTE_HOODYOOR_REROLL_DEPLOYMENT=1` is explicitly supplied. Its execution path
loads the 329 rules in gas-bounded batches, freezes their hash, deploys the controller,
and writes a resumable checkpoint. Granting the Energy spender role and permanently
wiring the controller into the collection remain explicit launch-ceremony actions.

The full mainnet command composes all five stages and remains a read-only dry run
unless `EXECUTE_HOODYOOR_MAINNET_DEPLOYMENT=1` is supplied. Mainnet broadcast also
requires every named launch gate in `.env.example`, the exact acknowledgement
`HOODYOOR_MAINNET_ACK=HOODYOOR-4663-IRREVERSIBLE`, and a deployer key whose address
matches the configured collection owner. The result signer and relayer must be
separate addresses. These assertions document completed work; they are not bypasses.

The finalization stage loads the 3,333 assignments, wires and freezes the reroll
controller, grants the Energy spender role, freezes the reveal commitment and
renderer, and sets the combined GTD root. It never opens GTD, mints the 150-token
owner reserve, or unlocks secondary trading. Those remain separate launch actions.

The OpenSea-ready desktop/mobile banners, profile image, overview art, pixel-art
preview, copy, dimensions, and checksums are under
`data/robinhood/branding/opensea/`; see
`data/robinhood/branding/OPENSEA_HANDOFF.md` for the upload map.

## Recorded mainnet risk decision

- The owner approved the permanent 1,000-Energy paid-mint reward and explicitly
  waived independent review of the frozen source tree. The contracts remain
  unaudited; this waiver is not a security approval.
- Fund the separate relayer wallet before Trait Lab activation and retain enough
  owner ETH for the complete checkpointed deployment.
