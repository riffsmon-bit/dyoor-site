# DYOOR self-hosted IPFS

This stack runs a persistent Kubo node plus an HTTPS Caddy gateway. The Kubo
admin API stays inside the Docker network; only the read-only gateway and IPFS
swarm port are public.

The Railway-specific implementation, private object-store backing, current
account limits, and recovery procedures are documented in
[`infra/ipfs/railway/README.md`](../infra/ipfs/railway/README.md). The Compose
instructions below remain an alternative for a conventional VPS.

The contract base URI must be `https://dyoor.fun/api/metadata/`. That API is
the dynamic metadata layer used by rerolls. Moving image CIDs between gateways
does not require an on-chain update because `ipfs://` CIDs are independent of
Pinata, Kubo, or any other gateway.

The live contract still reported the retired Netlify hostname during the
September 2026 audit. Run `npm run preflight:metadata-domain` to validate the
target metadata and simulate the owner call. The separate
`npm run migrate:metadata-domain` command is transaction-bearing and must only
be run after local review with the contract-owner key.

## Host requirements

- An always-on Linux VPS with Docker Compose, at least 2 GB RAM, and enough SSD
  space for the pinned collection plus growth. Start with 100 GB.
- An `A`/`AAAA` record for `ipfs.dyoor.fun` pointing to the VPS.
- Inbound TCP 80, 443, and 4001 plus UDP 443 and 4001.

## Deploy

```bash
cd infra/ipfs
cp .env.example .env
mkdir -p data staging
docker compose up -d
docker compose ps
```

Caddy obtains TLS automatically. `Gateway.NoFetch=true` means the public
gateway serves only content stored by this node. Port 5001 is intentionally not
published; exposing it would give the internet admin control of the node.

## Mirror and verify the current collection

Run this on the VPS after the node is healthy:

```bash
npm run ipfs:pin:dyoor
```

The image directory may take time to retrieve. Verify it afterward:

```bash
curl -fI https://ipfs.dyoor.fun/ipfs/bafybeifz4gwsvqbypeki3wwwmmvng2z2lusqjndevfqemzibisk266vepq/1.png
docker compose -f infra/ipfs/compose.yaml exec ipfs ipfs pin verify
```

Then set these Netlify variables:

```dotenv
IPFS_GATEWAY_URL=https://ipfs.dyoor.fun
NEXT_PUBLIC_IPFS_GATEWAY_URL=https://ipfs.dyoor.fun
DYOOR_S2_METADATA_GATEWAY=https://ipfs.dyoor.fun
```

Keep Pinata as a second pin during the transition. The website also retains
public IPFS read fallbacks.

## Publish a new immutable folder

Copy it into `infra/ipfs/staging` on the VPS, then add and pin it:

```bash
docker compose -f infra/ipfs/compose.yaml exec -T ipfs \
  ipfs add -Qr --cid-version=1 --pin=true /export/FOLDER_NAME
```

Record the returned CID in the release manifest and `dyoor-cids.txt`. IPFS
content is immutable, so updated content always receives a new CID.

## Reroll safety checklist

1. Keep the contract base URI on the dyoor.fun dynamic metadata API.
2. Pin all current image, trait-image, and base-metadata roots on both nodes.
3. Verify representative old and newly rerolled token images through the DYOOR
   gateway before making it the preferred application gateway.
4. Run a reroll preview and confirmation, then confirm `/api/metadata/{tokenId}`
   reflects the new trait version and its image is retrievable.
5. Keep the Pinata copy until a second independent DYOOR node is online.
