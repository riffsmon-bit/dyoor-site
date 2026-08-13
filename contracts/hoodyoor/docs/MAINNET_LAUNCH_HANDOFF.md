# HoodYØØR mainnet launch handoff

Status: deployed and finalized on Robinhood Chain mainnet; all six contracts are
source verified and match the frozen runtime artifacts; GTD and public mint remain
closed, total supply is zero, and secondary trading remains locked. The owner
explicitly waived independent review and accepted unaudited mainnet deployment
risk. The waiver is not an audit or security approval.

This handoff records the exact HoodYØØR build that passed the complete local
Robinhood-chain rehearsal. It is evidence for review, not transaction authority.

## Mainnet deployment

| Component | Address |
| --- | --- |
| Collection | `0x1Ece69C63F0b49C7a5B02eaf209059B4E2aF69a1` |
| Packed trait store | `0xaD7be6b27efDF619759375aF719A9D69e25818c1` |
| Pixel renderer | `0xb9cB0563013D9741f76a802d2F658EbF3433eE12` |
| Energy Bank | `0x9bA9aa6c6A1CB04bc0477E90f4D93214c6b1D7c3` |
| Trait rules | `0xd4E7F224539e628f58c4A6159A7a0eeE27991640` |
| Reroll controller | `0x69Ec96b8EF47e1f241389260d190b0ce61D67C2B` |

The public verification snapshot is recorded in
`deployments/robinhood/hoodyoor-live-verification-4663.json`. It confirms exact
runtime-artifact matches, frozen configuration, role wiring, sale state, and
Blockscout source verification at Robinhood block `32,324,833`.

## Frozen launch payloads

| Payload | Count / bytes | Frozen hash |
| --- | ---: | --- |
| Onchain pixel art | 201 traits / 586,295 bytes | `0xe6e707009bba6080eeffee21a1dd3ef97d47da5097ef0ea7ffb7f05b71708807` |
| Art catalog | 25 chunks | `0x50e0424b927b0da11b01947b6839070d81b6aa982b214c63f78f4adb8cb756d3` |
| Initial assignments | 3,333 / 59,994 bytes | `0x2b3049a8235d705dba39542b53990e584e3815e4e6a32efae6ecb810b8f506a3` |
| Reroll rules | 329 pairs / 1,974 bytes | `0x14a33149be765254e70441c4ba2674c662f5b3f746fb3ac8a717a4f49b47ab0f` |
| Combined paid GTD | 333 wallets / 733 aggregate max mint | `0x915e9b6ddcfe13a197ade8f6b776d37beb8ce2f766001e6579bd0601ffc5dd31` |
| Energy migration | 126 wallets / 2,023,191 Energy | `0x9b334fcd14b1bd4de1f9d2787124f9d30775e977dfca5e8e6c887ef592a5bf4f` |

The machine-readable manifest hashes every production Solidity source, ABI,
creation bytecode, runtime bytecode, and generated payload. Regenerate it only from
a clean, reviewed source state:

```bash
cd contracts/hoodyoor
forge build --offline --sizes
cd ../..
npm run generate:robinhood:launch-manifest
node --test test/robinhood-launch-manifest.test.js
```

## Reveal and reroll safety

- All assignments are public onchain but are assignment slots, not token mappings.
- Before reveal, minted NFTs return a fully onchain placeholder and `tokenTraits`
  and rerolls are unavailable.
- The reveal secret commitment is frozen before minting. The secret is supplied only
  when minting is closed permanently, before a fixed future block is known.
- Robinhood Nitro exposes the Ethereum-parent height through Solidity `block.number`.
  The 64-block reveal delay is therefore about 13 minutes, not 64 Robinhood blocks.
- `blockhash(target)` returns a canonical Robinhood L2 block hash associated with
  that parent height. The public mainnet canary validated this behavior at target
  parent block 25,719,938. The 256-parent-block hash window is about 51 minutes.
- Anyone can complete reveal. A 16-round swap-or-not permutation creates a bijection
  between token IDs and all 3,333 assignment slots.
- If the target block hash expires, anyone can request a new future reveal block.
- The reroll controller consumes a holder signature and an independent result-signer
  signature, spends non-transferable Energy, and updates traits atomically.
- Every paid GTD or public mint atomically credits 1,000 Energy per NFT to the
  recipient. The free 150-token owner reserve earns no mint Energy. This reward and
  its Energy Bank are permanently frozen before either paid sale can open.
- Background and Droid remain permanently locked through every reroll.

## Secondary-market gate

- Transfers and new token/operator approvals start locked.
- First GTD activation mints the one-time 150-token reserve to the current collection
  owner. It is free, but it increases total minted supply.
- The gate opens automatically at minted supply 1,667, which rounds 50% of 3,333 up
  to the next whole token. The owner reserve counts, leaving 1,517 additional mints
  before automatic unlock.
- The current collection owner can unlock trading earlier through
  `unlockSecondaryTrading()`.
- Every unlock is permanent. The contract has no re-lock function, so holders cannot
  be frozen again after trading begins.
- Minting and approval revocation continue to work while secondary trading is locked.

Generate a reveal secret with a cryptographically secure offline tool. Store the
32-byte secret outside the repository and deployment logs. Put only
`keccak256(secret)` into the assignment-freeze transaction.

## Rehearsal evidence

The full test uses chain ID `4663` and the real generated binaries. It deploys the
25 art data contracts, registers 201 traits, freezes 329 rules, loads 3,333
assignments in 67 batches, wires the Energy Bank and controller, validates the
333-wallet combined GTD payload, mints the 150-token owner reserve, mints through a
real Monad-holder proof, verifies paid-mint Energy and the reserve exclusion,
permanently closes minting, reveals, and settles a relayed EIP-712 reroll.

```bash
cd contracts/hoodyoor
forge test --offline --match-contract HoodYOORLaunchRehearsalTest -vv
```

Expected result: one passing end-to-end test. The reported aggregate gas covers
many simulated transactions; it is not a single-transaction gas estimate.

## Required mainnet order

1. Confirm owner, treasury, deployer, result signer, and relayer addresses on chain
   `4663` using separate controlled wallets where appropriate. If the owner is a
   contract, prove it accepts ERC-721 safe mints before GTD activation.
2. Deploy and freeze the packed art store; deploy the renderer.
3. Deploy the collection and HoodYØØR Energy Bank.
4. Migrate the frozen 126-wallet Energy ledger in three replay-protected batches and
   verify every resulting balance.
5. Deploy and freeze the compatibility registry; deploy the reroll controller.
6. Load all 3,333 assignment slots in 67 batches and verify the provenance hash.
7. Wire and freeze the reroll controller, grant its `SPENDER_ROLE`, grant the
   collection `CREDIT_ROLE`, permanently freeze the 1,000-Energy paid-mint reward,
   freeze assignments with the reveal commitment, then freeze the renderer.
8. Independently reproduce and set the frozen combined GTD root; verify secondary
   trading still reports locked.
9. Open GTD, verify the current owner received exactly 150 reserve tokens once, and
   verify `paidMinted` remains zero before paid minting begins.
10. Run GTD/public sale phases. Trading opens automatically at total minted supply
   1,667—including the reserve—or the owner may execute the permanent early-unlock
   after an announced decision.
11. Permanently finalize minting before revealing the committed secret.
12. Complete reveal permissionlessly inside the block-hash window and enable the
    Trait Lab only after all live wiring checks pass.

Every deployment script must remain resumable and dry-run by default. Mainnet
execution requires an explicit chain-4663 flag and a separate human approval at the
broadcast step.

## Deployment automation

From the repository root, rebuild branding and run the read-only preflight:

```bash
npm run build:robinhood:opensea-branding
npm run preflight:robinhood:mainnet
npm run deploy:robinhood:mainnet
```

The last command is also a dry run unless
`EXECUTE_HOODYOOR_MAINNET_DEPLOYMENT=1` is explicitly supplied. On execution it
resumes these checkpointed stages in order:

1. `deploy-robinhood-onchain-art.js`
2. `deploy-robinhood-core.js`
3. `migrate-robinhood-energy.js`
4. `deploy-robinhood-reroll.js`
5. `finalize-robinhood-launch.js`

The broadcaster must be the configured collection owner. Result-signer and relayer
addresses must be separate from it and each other. The scripts require all review,
control, Energy-ledger, reveal-validation, commitment, chain, and acknowledgement
gates documented in `.env.example`. Never place the reveal secret in an environment
variable used by these scripts—only its bytes32 commitment belongs there.

Successful finalization intentionally leaves both sales closed, total supply at
zero, owner reserve unminted, and secondary trading locked. Opening GTD remains a
separate transaction so the 150-token reserve is not minted accidentally during
deployment.

OpenSea assets and collection copy are packaged under
`data/robinhood/branding/opensea/`. OpenSea's live chain API lists Robinhood Chain,
but automatic import of a custom collection waits until at least one NFT exists.
Because this deployment intentionally has zero supply, its OpenSea page remains
pending the first GTD activation and reserve mint. Editing the imported collection
will require a wallet-authenticated OpenSea Studio session.

## Launch follow-up

Recorded owner decision:

- The owner approved 1,000 Energy per paid NFT and explicitly waived independent
  smart-contract review for source tree
  `0xe1d826b0509fa93d8373e9f8cea20fac2b8015f8dfcebc3d670824923794598c`.
  Deployment remains unaudited; do not describe the waiver as an audit.

Operational follow-up:

- Fund the separate relayer wallet before Trait Lab activation.
- Open GTD only after the mint schedule and communications are final. That separate
  owner transaction atomically mints the 150-token reserve, after which the OpenSea
  import and packaged branding can be completed.

The authoritative blocker list and bytecode hashes live in
`data/robinhood/onchain-128/hoodyoor-mainnet-launch-manifest.json`.
