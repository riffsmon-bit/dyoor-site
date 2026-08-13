# D.Y.O.O.R Game Repository Discovery

Date: 2026-07-28
Branch: `agent/dyoor-rpg-prototype`
Repository: `/Users/brandonduke/Projects/DYOOR`

## Executive summary

The production site is a single-package Next.js application, not a monorepo. The
game should therefore live in an isolated nested package at `apps/game` without
adding npm workspaces or moving any existing application code.

The production application already has suitable read-only boundaries for
wallet identity, Season 2 ownership, Monad RPC failover, and current metadata.
The game must consume those boundaries and must not import or duplicate admin,
Trait Lab, Energy operator, Netlify Blob, or deployment secrets.

The canonical Season 2 metadata set is not checked into the repository as 3,333
individual records. The repository contains a collection manifest, a trait
catalog, a small set of render layers, and local development overrides. The
canonical per-token records live at a pinned IPFS CID and the production
metadata API merges those records with runtime overrides. Game tooling must
therefore support a cached, read-only remote scan as well as an explicitly
supplied local metadata directory.

## Baseline before game changes

The following commands were run on the branch before any game files were added:

| Command | Result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed with Next.js 16.2.9; one existing Edge/static-generation warning |
| `npm test` | 110 passed, 1 failed |

The single existing test failure is
`test/dyoor-world-social.test.js` ("the whitepaper positions dYOOR World as the
holder home and social apps as onboarding"). It expects the removed literal
heading `Holder-Exclusive Community Layer`. This is a pre-existing stale
whitepaper assertion and is not caused by the game branch.

The initial working tree also contained unrelated untracked reconciliation,
deployment, archive, wallet export, and report files. They are user-owned and
are intentionally excluded from this work.

## Application architecture

- Framework: Next.js `16.2.9`, React `19.2.7`
- Router: App Router (`app/`)
- Language: strict TypeScript with ES2022 and bundler module resolution
- Package manager: npm with a root `package-lock.json`
- Deployment: Netlify Next.js runtime
- Production build: `npm run build`
- Production output: `.next`
- Server routes: Next.js route handlers under `app/api`
- Additional legacy/serverless surfaces: `netlify/functions`
- Contracts/tooling: Hardhat 3 and Foundry/SeaDrop sources
- Styling: application CSS/Tailwind utilities and shared D.Y.O.O.R UI components

The root `tsconfig.json` currently includes every `*.ts` and `*.tsx` file below
the repository. The isolated game package must be excluded from the root
Next.js type-check and must own its own TypeScript configuration.

## Existing application routes

Primary application pages include:

- Homepage
- Ascension
- Blueprint builder
- dYOOR World
- Season 2 mint test
- Swap
- Trait Lab (`/reroll`)
- Whitepaper
- Admin and metadata administration

The production API surface includes:

- Season 2 supply and ownership reads
- Dynamic metadata reads
- Trait Lab preview, confirm, recovery, render, burn, leaderboard, and bounty
  routes
- Energy reads, transfers, credits, and reconciliation
- Ascension blueprint reads
- dYOOR World sessions, messages, direct messages, media, rewards, tips, trades,
  names, push, and automation
- Admin metadata, snapshot, Energy, and reconciliation routes

## Wallet authentication flow

`providers/AppProviders.tsx` configures Privy when
`NEXT_PUBLIC_PRIVY_APP_ID` is present:

- Wallet-only login
- Monad mainnet as the supported and default chain
- Detected EIP-1193 wallets
- WalletConnect through Privy

`providers/WalletServiceProvider.tsx` is the application wallet abstraction. It
uses Privy when configured and has an injected EIP-1193 fallback. It exposes
connect, disconnect, address, provider, signer, message signing, transaction
sending, and Monad chain switching.

`hooks/useActivePrivyWallet.ts` selects the active Privy wallet.

Game integration boundary:

- Guest mode never invokes a wallet.
- Local development can use a nonvaluable mock wallet fixture.
- Hosted wallet mode must receive the authenticated address through a narrow
  host adapter and call the existing read-only ownership endpoint.
- The game must not bundle the Privy app ID as a secret (it is public
  configuration), but it should avoid creating a second competing Privy
  lifecycle.
- A browser-supplied token ID is never sufficient for selection. The server
  ownership response is authoritative at selection and meaningful session
  boundaries.

## Monad configuration

Production chain configuration is centralized in `lib/monad.ts`:

- Chain ID: `143`
- Chain hex: `0x8f`
- Public RPC fallback: `https://rpc.monad.xyz`
- Explorer: `https://monadscan.com`

`lib/rpc.ts` provides:

- Multiple configured RPC URLs
- 12-second read timeout
- Two retries
- RPC failover
- In-flight read de-duplication

Production configuration rejects explicit testnet chain IDs and testnet-like
RPC URLs.

## Contract addresses and ABIs

Canonical addresses are centralized in `lib/contracts/addresses.ts`:

| System | Address |
| --- | --- |
| Season 1 NFT | `0x2c79c9e233fea4b4dcfe6561d9209dc292cd932f` |
| Ascension staking | `0xf9611226c1CcCcCa37951938d6f358D3d5106549` |
| Energy Bank | `0x291a8cC0FCa08EBd64a0e4d67B4455d24e9E6767` |
| Treasury fallback | `0x4D540f7D0Eb841c839334655C9f88313D750c6d5` |
| Season 2 NFT | `0x349D8eb480c92cF75371fbA5C6344A4d11b9103A` |

Reusable ABIs are in `lib/contracts/abis.ts`. Season 2 ownership code also uses
a minimal ABI containing `balanceOf`, `ownerOf`, `tokenOfOwnerByIndex`,
`totalSupply`, `totalMinted`, and `Transfer`.

`contracts/DYOORSeason2SeaDrop.sol` extends OpenSea SeaDrop/ERC721A. The deployed
contract reports a max supply of 3,333 even though the current source constant
in the checked-in historical contract file is not a reliable deployment record.
The inherited SeaDrop implementation starts token IDs at 1 and exposes a
holder-authorized `burn(tokenId)`.

No game work may modify, deploy, configure, or transact with production
contracts.

## NFT ownership lookup

`GET /api/s2/owned-tokens?wallet=0x...` is the reusable public read boundary. It:

1. Validates and normalizes the wallet.
2. Applies an in-process rate limit.
3. Reads `balanceOf`.
4. Attempts ERC-721 enumeration.
5. Optionally uses Alchemy transfer history.
6. Optionally uses explorer transfer history.
7. Scans address-filtered `Transfer` logs from deployment block `87,616,887`.
8. Falls back to bounded `ownerOf` reads.
9. Verifies every candidate with `ownerOf`.
10. Rejects incomplete positive-balance discovery instead of returning a
    silently partial result.

The deployment block is also recorded in existing mainnet deployment/report
artifacts. Game classification tooling will use this as a configurable default,
then verify the deployment evidence before accepting a scan.

## Season 2 metadata architecture

`app/api/metadata/[tokenId]/route.ts` serves the public metadata API. It:

- Validates token IDs against runtime max supply.
- Builds metadata through `lib/dyoor-s2-metadata.js`.
- Normalizes dynamic render URLs.
- Returns metadata with no-store caching.

`lib/dyoor-s2-metadata.js` defines:

- Default max metadata ID: 3,333
- Canonical metadata CID:
  `bafybeidz7htb3digthznwvl4ytdpckq2q3d2ytgxtsie5bcp7a4lgtb2sq`
- Canonical image CID:
  `bafybeifz4gwsvqbypeki3wwwmmvng2z2lusqjndevfqemzibisk266vepq`
- Local metadata directory discovery
- Remote metadata fetch and short-lived cache
- Published Blob metadata lookup
- Local-development runtime storage
- Trait override merge logic
- Metadata versioning and validation

The repository file `data/dyoor-s2-collection-metadata.json` is a collection
manifest, not the 3,333-record dataset. It points to the pinned IPFS backup.
The game scan must never silently interpret this collection manifest as token
records.

Local development runtime overrides live below
`data/runtime/dyoor-s2-metadata`. Production overrides use the strongly
consistent `dyoor-s2-metadata` Netlify Blob store. The game must not write to
either location.

## Live read-only verification

At Monad block `91,078,830`, a read-only check on 2026-07-28 returned:

| Value | Verified result |
| --- | ---: |
| `totalMinted()` | 1,096 |
| `totalSupply()` | 1,039 |
| Derived burns | 57 |
| `maxSupply()` | 3,333 |
| Token metadata range | 1 through 3,333 |

Metadata ID 0 returned 404. IDs 1, 1,095, 1,096, 3,332, and 3,333 returned
valid records with 11 attributes. These values are a dated snapshot; the
classifier must recompute them and record its block number.

## Burn detection

Season 2 burns emit the standard ERC-721 `Transfer` event with the zero address
as `to`. Existing Trait Lab burn reward code verifies:

- Monad receipt success
- Season 2 contract address
- `Transfer` topic
- Zero-address recipient
- Burning wallet from the indexed `from` topic
- Token ID from the indexed token topic

`GET /api/s2/supply` first uses `totalSupply` and `totalMinted`, then falls back
to recorded burned-Droid gallery entries, and finally to a fixed issued-supply
fallback.

The game classifier will independently scan all Season 2 transfer logs, retain
the latest transfer state per token, and verify surviving candidates with
`ownerOf`. It will not infer burned IDs from a count.

## Token-ID assumptions

- Canonical metadata IDs: 1–3,333 inclusive
- ERC721A/SeaDrop start ID: 1
- Current minted frontier: derived from mint events and `totalMinted`, not
  blindly assumed to be sequential
- Burned token: a minted token whose terminal transfer is to the zero address
- Surviving minted token: a minted token with a current nonzero owner confirmed
  by `ownerOf`
- Unminted metadata token: valid metadata record with no mint evidence
- Invalid/unavailable: malformed metadata, conflicting chain evidence, or
  unresolved reads

## Trait categories and compatibility

`data/dyoor-s2-trait-catalog.json` defines the canonical order:

1. Background
2. Droid
3. Conditions
4. Stickers/Body art
5. Clothes
6. Mouth
7. Eyes
8. Hat
9. Accessories
10. Accessories 2
11. Special

Background and Droid are locked. The remaining categories are mutable under
Trait Lab rules. The catalog contains rarity weights, exact caps, empty-slot
weights, and compatibility rules such as occluding hats, glasses conflicts,
and paired accessory rules.

The game sprite pipeline must preserve this order as the initial composition
order, while allowing explicit per-trait sprite overrides for directional
artwork and special effects.

## Existing images and metadata locations

- Collection manifest: `data/dyoor-s2-collection-metadata.json`
- Trait catalog: `data/dyoor-s2-trait-catalog.json`
- Trait item metadata: `data/dyoor-s2-trait-item-metadata.json`
- Reveal audit: `data/dyoor-s2-trait-reveal-audit.json`
- Legacy/local overrides: `data/dyoor-s2-trait-overrides.json`
- Partial production render layers: `data/dyoor-s2-base-layers`
- Development runtime records: `data/runtime/dyoor-s2-metadata`
- Remote canonical metadata: pinned IPFS CID above
- Remote canonical full-size images: pinned image CID above

The existing render layers are full-image compositing assets, not compliant
four-direction pixel-art layers. They must not be resized and presented as
finished game sprites.

## Environment variables

Environment names are documented in `.env.example`. Relevant read-only game
integration variables are:

- `NEXT_PUBLIC_PRIVY_APP_ID`
- `NEXT_PUBLIC_MONAD_CHAIN_ID`
- `NEXT_PUBLIC_MONAD_RPC_URL`
- `NEXT_PUBLIC_MONAD_FALLBACK_RPC`
- `DYOOR_S2_RPC_URL`
- `NEXT_PUBLIC_DYOOR_S2_RPC_URL`
- `DYOOR_S2_CONTRACT_ADDRESS`
- `NEXT_PUBLIC_DYOOR_S2_CONTRACT_ADDRESS`
- `DYOOR_S2_START_BLOCK`
- `NEXT_PUBLIC_DYOOR_S2_START_BLOCK`
- `DYOOR_S2_MAX_SUPPLY`
- `DYOOR_S2_METADATA_CID`
- `DYOOR_S2_METADATA_BASE_URL`
- `DYOOR_S2_METADATA_DIR`
- `SEASON2_METADATA_DIR`

Sensitive or privileged categories that must never be copied into the browser
game include:

- Deployer/operator/private keys
- Admin API, automation, processor, session, reward, and verification secrets
- Netlify Blob/site/auth tokens
- Pinata JWTs
- Discord and GitHub credentials
- Supabase service roles
- Energy credit and bounty operator credentials

Only variable names were inspected. No secret values were printed or copied.

## Admin and privileged routes

Privileged surfaces include:

- `app/api/admin/**`
- Trait Lab confirmation, bounty processing, and mutation routes
- Energy credit, airdrop, reconcile, reindex, and sync routes
- dYOOR World automation routes
- Metadata upload/publish administration
- Netlify functions that process Energy, bounties, push notifications, and
  OpenSea refresh work

These routes are outside the game prototype boundary. The game may use public
metadata, supply, and ownership reads only.

## Reusable components and utilities

Safe reuse is primarily through interfaces and behavior, not cross-bundling
Next.js React components into Phaser:

- Monad constants from `lib/monad.ts`
- Canonical addresses and minimal ABI definitions
- RPC timeout/retry/failover behavior
- `/api/s2/owned-tokens` server verification contract
- `/api/metadata/[tokenId]` current metadata contract
- Trait order and compatibility data
- D.Y.O.O.R color, typography, and UI motifs as visual reference
- Existing original logo assets where licensing/ownership is clear

The game package will provide framework-neutral ports for wallet, metadata,
ownership, save storage, input, and future networking.

## Systems intentionally untouched

- Production Next.js pages and navigation
- Trait Lab behavior and metadata writes
- Ascension and Season 1 staking
- Energy Bank accounting and rewards
- dYOOR World chat, rewards, trades, names, and notifications
- Admin authentication and routes
- Netlify Blob stores
- Solidity contracts and deployment scripts
- OpenSea refresh processing
- Live metadata and runtime override files
- Netlify deployment configuration

The only expected root integration changes are additive npm scripts, a root
TypeScript exclusion for the isolated package, and ignore rules for game
caches/generated artifacts.

## Recommended integration boundaries

1. Keep `apps/game` independently buildable with Vite.
2. Keep pure game state separate from Phaser scenes.
3. Use ports/adapters for input, storage, metadata, ownership, wallet, and
   networking.
4. Default to guest/mock mode locally.
5. Use the production host wallet adapter rather than starting a second Privy
   session.
6. Recheck server-verified ownership on character selection, resume, map/session
   entry, and before any future valuable action.
7. Treat metadata trait hashes/version as sprite-cache keys.
8. Store nonvaluable prototype progress locally with schema validation.
9. Keep future rewards, inventory, combat outcomes, and trading explicitly
   server-authoritative.
10. Put classifier cache and any owner-address evidence in ignored local files;
    commit only a public registry with `owner: null`.

## Security risks and required controls

| Risk | Existing observation | Game control |
| --- | --- | --- |
| Wallet impersonation | Browser addresses are untrusted | Host/session adapter plus server ownership verification |
| Client token spoofing | Token IDs can be supplied in URLs/UI | Select only from verified server response |
| Expensive ownership fallback | Log and `ownerOf` scans can be costly | Cache, rate limit, bounded concurrency, fail closed |
| In-process rate limits | Serverless instances do not share memory | Do not treat current limiter as abuse prevention for valuable rewards |
| Untrusted metadata | Remote JSON and image URLs are external input | Strict schema, size, URL scheme, timeout, and output escaping |
| Malicious asset paths | Trait names can contain punctuation/path syntax | Hash-based filenames and containment checks |
| Runtime override coupling | Metadata can change after Trait Lab actions | Trait hash/version cache invalidation |
| Secret leakage | Root environment contains privileged systems | Whitelist public config; never copy root env into Vite |
| Local save tampering | Browser storage is user-controlled | Limit it to nonvaluable progress and validate every load |
| Client-authoritative game state | Phaser runs in the browser | Mark combat, inventory, quests, rewards, and trading nonauthoritative |
| RPC instability/rate limits | Existing code requires several fallbacks | Pagination, retries, resumable cache, clear partial-scan status |
| Static owner disclosure | Ownership is public on-chain but still sensitive in aggregate | Omit owners from committed registry |
| Path traversal | Existing generic storage sanitization is not an asset-pipeline sandbox | Resolve against fixed roots and reject escapes |
| Dependency attack surface | A new game package adds dependencies | Minimal pinned dependency set and audit reporting |

## Discovery conclusion

An isolated `apps/game` package is safe and does not require a production-site
rewrite. The first vertical slice can be fully local and nonvaluable. Production
wallet/ownership integration can be represented by a narrow adapter now and
connected to the existing host flow later without changing core game systems.
