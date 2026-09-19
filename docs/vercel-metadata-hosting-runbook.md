# Vercel metadata hosting handoff

This runbook moves the D.Y.O.O.R dynamic metadata API to Vercel without
changing the September site redesign, the Monad contract, or the contract's
base URI.

## What remains unchanged

- `https://dyoor.fun/api/metadata/{tokenId}` remains the public metadata URL.
- The D.Y.O.O.R S2 contract and its base URI are unchanged.
- The current production UI, `/reroll` route, wallet flow, and Trait Lab costs
  remain unchanged.
- Immutable metadata and artwork remain addressed by their existing CIDs.

## Vercel runtime requirements

The Next.js metadata route is already `force-dynamic` and sends `no-store` for
the public response. Configure the S2 variables in
`docs/vercel-migration-environment-inventory.md` before creating a preview.
Keep the dedicated S2 metadata source ahead of generic IPFS gateways.

During the transition, the existing Netlify Blob store can remain the durable
read/write adapter by carrying `NETLIFY_BLOBS_SITE_ID` and
`NETLIFY_BLOBS_TOKEN` into Vercel as encrypted server variables. This keeps
accepted rerolls available while the replacement store is built. Do not remove
or rotate those credentials until a complete state export and read-through
verification has succeeded.

## Immutable artwork infrastructure

The self-hosted Kubo/Caddy stack is in `infra/ipfs`. Before making
`ipfs.dyoor.fun` the preferred gateway, provision the node and run:

```bash
npm run ipfs:pin:dyoor
```

Verify every CID in `infra/ipfs/dyoor-cids.txt` through HTTPS. Keep the Pinata
gateway configured as a fallback until two independent reads succeed for the
metadata root, image root, trait-asset root, and representative token images.

## Cutover order

1. Create a Vercel preview from `fix/trait-lab-metadata-regression`.
2. Add public build variables and encrypted server variables.
3. Verify `/api/metadata/11`, accepted override persistence, and the reroll
   fail-closed behavior.
4. Verify the self-hosted CID reads while Pinata remains available.
5. Point the production domain at the verified Vercel deployment.
6. Only after manual approval, retire Netlify hosting and later migrate the
   mutable store.

No step in this handoff calls `setBaseURI`, sends an on-chain transaction, or
mutates production metadata.
