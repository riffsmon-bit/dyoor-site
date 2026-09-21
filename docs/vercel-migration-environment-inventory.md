# Vercel migration environment inventory

This is the reviewed runtime inventory for moving the DYOOR Next.js site from
Netlify. It intentionally contains variable names and scopes only; secret
values must be copied from the Netlify project settings into Vercel's encrypted
environment store and must not be committed.

## Required for the S2 Trait Lab and metadata preview

Set these in **Production, Preview, and Development** as appropriate:

```text
NEXT_PUBLIC_PRIVY_APP_ID
NEXT_PUBLIC_MONAD_RPC_URL
NEXT_PUBLIC_DYOOR_S2_CONTRACT_ADDRESS
NEXT_PUBLIC_DYOOR_S2_CHAIN_ID
NEXT_PUBLIC_DYOOR_S2_CHAIN_NAME
NEXT_PUBLIC_DYOOR_S2_RPC_URL
NEXT_PUBLIC_DYOOR_S2_EXPLORER_URL
DYOOR_S2_CONTRACT_ADDRESS
DYOOR_S2_RPC_URL
DYOOR_S2_METADATA_BASE_URL
DYOOR_S2_METADATA_GATEWAY
DYOOR_S2_METADATA_CID
NEXT_PUBLIC_DYOOR_S2_METADATA_CID
DYOOR_S2_IMAGE_CID
DYOOR_S2_MAX_SUPPLY
DYOOR_S2_COLLECTION_NAME
DYOOR_S2_DESCRIPTION
DYOOR_S2_TRAIT_ASSETS_CID
NEXT_PUBLIC_DYOOR_S2_TRAIT_ASSETS_CID
DYOOR_S2_TRAIT_METADATA_CID
IPFS_GATEWAY_URL
NEXT_PUBLIC_IPFS_GATEWAY_URL
PINATA_GATEWAY_URL
NEXT_PUBLIC_PINATA_GATEWAY_URL
MONAD_READ_RPC_URLS
DYOOR_S2_ERC721_ENUMERABLE
DYOOR_S2_ENABLE_ALCHEMY_TRANSFERS
ALCHEMY_MONAD_RPC_URL
MONADSCAN_API_KEY
```

`NEXT_PUBLIC_PRIVY_APP_ID` also requires the Vercel preview and production
origins to be allowed in the Privy dashboard. Keep browser RPC values free of
admin credentials.

## Required server-side Trait Lab state

```text
DYOOR_TRAIT_LAB_SECRET
DYOOR_TRAIT_LAB_TREASURY_WALLET
DYOOR_REROLL_COST_RAW
NETLIFY_BLOBS_SITE_ID
NETLIFY_BLOBS_TOKEN
```

The last two are Netlify Blob credentials. They cannot be carried into a
Vercel-only deployment as the durable storage design. Before switching hosts,
either retain a separately reachable Blob adapter or migrate the Blob-backed
records to the chosen durable store. Do not delete the existing Netlify Blob
data.

## dYOOR World / wallet features

Copy these only when the corresponding feature remains enabled:

```text
DYOOR_WORLD_SESSION_SECRET
DYOOR_WORLD_AUTOMATION_SECRET
DYOOR_WORLD_REWARD_SECRET
DYOOR_WORLD_REWARDS_ENABLED
DYOOR_WORLD_SALES_BOT_ENABLED
DYOOR_WORLD_PUSH_ENABLED
DYOOR_WORLD_VAPID_PUBLIC_KEY
DYOOR_WORLD_VAPID_PRIVATE_KEY
DYOOR_WORLD_VAPID_SUBJECT
OPENSEA_API_KEY
DISCORD_CLIENT_ID
DISCORD_CLIENT_SECRET
DISCORD_REDIRECT_URI
```

## Copy procedure

1. In Netlify, open **Project configuration → Environment variables** for
   `dyoor` and export or copy each variable with its Production, Deploy Preview,
   and Local development scope.
2. In Vercel, add public values to the matching environments and add all secret
   values as encrypted variables. Preserve exact names and capitalization.
3. Add `NEXT_PUBLIC_*` variables before a preview build because Next.js embeds
   them at build time. Add server variables before the runtime deployment.
4. Keep Netlify Blob credentials and the current IPFS/Pinata fallback active
   until the self-hosted metadata and durable mutable-state stores have been
   verified independently.

The repository's `.env.example` remains the full historical variable catalog;
this file is the smaller migration set for the current S2 site.
