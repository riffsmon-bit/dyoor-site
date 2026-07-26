# dYOOR World architecture

Date: 2026-07-23

Status: application and registry contract built and tested locally; **registry not deployed to Monad mainnet**.

## Scope

dYOOR World is an unlisted, holder-only social surface inside the DYOOR site. Its
node-and-stream interaction model is adapted from the owner's M3SH repository at
`riffsmon-bit/mesh` commit `dfc908d19537c4766b2ff35f254b51184b8e0a93`.
The DYOOR implementation rebuilds the storage and authorization boundaries
instead of carrying over M3SH's mock client-side gates.

The upstream repository does not contain a license file. This adaptation was
performed under the repository owner's explicit instruction to integrate a
custom DYOOR version into this site.

## Access boundary

The discovery glyph is intentionally absent until a connected address passes an
S2 `balanceOf` read against Monad mainnet contract:

`0x349D8eb480c92cF75371fbA5C6344A4d11b9103A`

The hidden glyph is a discovery device, not the security boundary. A user who
guesses `/dyoor-world` still cannot load World data. Protected access uses:

1. A server-generated, five-minute, one-time challenge.
2. A wallet signature over the wallet, chain ID, S2 contract, host, nonce,
   issue time, and expiry.
3. A signed, `HttpOnly`, `SameSite=Strict`, secure-in-production session cookie.
4. A fresh or short-cached S2 ownership read on the page and every protected
   profile/message API.

No World write trusts a wallet address supplied by the browser. The server takes
the writer from the verified session.

## Message persistence

Messages use one Blob record per message:

`messages/{channel}/{timestamp}-{uuid}.json`

This is deliberately different from an array stored in one Blob. Concurrent
writes cannot overwrite a previously loaded array. The current client polls
every four seconds and loads the latest 100 records per stream.

Current preview limitations:

- Polling is not websocket realtime.
- In-memory request throttles are defense-in-depth, not a distributed rate
  limiter.
- Moderation and reporting workflows are not included yet.
- High-scale chat should move to a transactional database/realtime service.

## `.dYOOR` names

`.dYOOR` is a Monad-native World identity. It is not an ICANN DNS suffix,
Ethereum ENS name, or NNS `.nad` name. The canonical on-chain form is lowercase
(`riffs.dyoor`); the product display form is `riffs.dYOOR`.

`DYOORWorldNames.sol` enforces:

- Direct S2 `balanceOf(msg.sender) > 0` at claim time.
- One name per wallet.
- One wallet per label.
- Three-to-24-character ASCII labels.
- Lowercase letters, numbers, and interior single hyphens only.
- Owner-reserved protocol labels before claims open.
- Soulbound ERC-721 ownership; names cannot be transferred or sold.
- Forward resolution from a name/node to a wallet.
- Reverse resolution from a wallet to its `.dYOOR` name.
- Batched protocol-label reservation, a live claimed-name count, availability
  reads, and a combined wallet record helper.

World access continues to check current S2 ownership. A wallet that later
transfers or burns its final S2 cannot enter World, even though its historical
name token remains bound to that wallet.

### Preview mode

Before a verified Monad registry address is configured, the deploy preview uses
append-only Blob reservations so the flow can be tested without pretending an
on-chain name was issued. The UI labels these records `Preview reservation`.
They are not tokens and are not presented as DNS or ENS.

When these variables point to the audited mainnet deployment, the client
switches to the wallet transaction flow:

```text
DYOOR_WORLD_NAMES_CONTRACT=
NEXT_PUBLIC_DYOOR_WORLD_NAMES_CONTRACT=
```

The server validates that the configured registry itself points back to the
production S2 collection before accepting it.

## Deployment runbook

Do not open claims in the deployment transaction.

1. Compile and test `DYOORWorldNames`.
2. Set a stable production metadata base URL ending in `/`.
3. Deploy to Monad mainnet with claims closed.
4. Verify the deployed bytecode and constructor arguments on a Monad explorer.
5. Reserve every protocol label.
6. Confirm `S2_COLLECTION`, `ROOT_NODE`, owner, metadata base URI, and
   `claimsOpen == false`.
7. Lock metadata forever only after confirming the stable metadata endpoint.
8. Add the verified registry address to
   `NEXT_PUBLIC_DYOOR_WORLD_NAMES_CONTRACT` in Netlify Builds scope. The server
   bundle uses that same public address.
9. Test a real holder claim and confirm a transfer reverts with
   `SoulboundName`.
10. Open claims from the owner wallet.

The deployment helper is intentionally default-closed:

```bash
npm run deploy:dyoor-world-names
```

It requires an explicit `DYOOR_WORLD_OPEN_CLAIMS=true` to open claims after
reserving protocol labels.

Post-deployment configuration is performed separately so explorer verification
can happen before claims open:

```text
DYOOR_WORLD_NAMES_CONTRACT=0x...
DYOOR_WORLD_CONFIGURE_ACTION=status
npm run configure:dyoor-world-names
```

Supported actions are `status`, `open`, `close`, `reserve`, `metadata`, and
`lock-metadata`. The permanent metadata lock requires the exact
`DYOOR_WORLD_CONFIRM_LOCK_METADATA` confirmation phrase printed by the script.

## DNS, ENS, and NNS paths

- A true `.dyoor` DNS top-level domain requires the ICANN new-gTLD process and
  operation of a DNS registry.
- A standards-compatible ENS route would be `riffs.dyoor.eth` after acquiring
  and configuring `dyoor.eth`.
- The native Monad ecosystem service is NNS (`.nad`). The World UI can resolve
  and display existing `.nad` names later, but NNS does not currently document
  project-controlled subname issuance.

Those systems can be added as adapters without changing the World holder
session or the Monad `.dYOOR` registry.
