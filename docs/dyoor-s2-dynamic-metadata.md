# D.Y.O.O.R Season 2 Dynamic Metadata

The Season 2 contract should use this API base URI when dynamic metadata is
ready:

```text
https://dyoor.xyz/api/metadata/
```

With the SeaDrop token URI behavior, token `1` resolves to:

```text
https://dyoor.xyz/api/metadata/1
```

## Images

Images stay on IPFS. The default image URI format is:

```text
ipfs://bafybeidh5ilyx54iklgazcdzwrzyr3llnj6v7jc3ll2hbrn36mxk2xle7i/{tokenId}.png
```

## Environment

Defaults:

```text
DYOOR_S2_MAX_SUPPLY=3333
DYOOR_S2_IMAGE_CID=bafybeidh5ilyx54iklgazcdzwrzyr3llnj6v7jc3ll2hbrn36mxk2xle7i
DYOOR_S2_COLLECTION_NAME=D.Y.O.O.R
DYOOR_S2_DESCRIPTION=Directive: Yield Opportunity Optimization Robots
```

Optional local metadata directory overrides:

```text
DYOOR_S2_METADATA_DIR=/path/to/metadata-extensionless
SEASON2_METADATA_DIR=/path/to/metadata-extensionless
```

## Admin Upload Flow

The owner-only upload UI lives at:

```text
https://dyoor.xyz/admin/metadata
```

Use it to:

- save runtime metadata config such as max supply, image CID, collection name,
  and description
- select generated metadata JSON files and validate them in-browser
- upload valid metadata in chunks to Netlify Blobs
- keep uploaded metadata staged until the explicit publish action
- edit per-token trait overrides for rerolls or upgrades

Netlify Blobs store the uploaded runtime data under the `dyoor-s2-metadata`
store. The public API reads uploaded metadata only after it is published, so a
partial upload does not automatically affect OpenSea or other consumers.

## Base Metadata

The API looks for published uploaded metadata first. If no published uploaded
metadata exists for a token, it looks for base metadata files in common repo
locations such as:

```text
metadata-extensionless
metadata
public/metadata-extensionless
public/metadata
data/metadata-extensionless
data/metadata
src/data/metadata-extensionless
src/data/metadata
```

Both extensionless files like `1` and JSON files like `1.json` are supported.
If no file exists for a valid token ID, the API returns fallback metadata with
the expected trait structure.

## Trait Overrides

Dynamic rerolls, Energy upgrades, blueprint updates, and marketplace trait
changes should update the override layer. The current file-backed override store
lives at:

```text
data/dyoor-s2-trait-overrides.json
```

Format:

```json
{
  "1": {
    "version": 2,
    "attributes": {
      "Eyes": "Laser Eyes",
      "Hat": "Crown"
    }
  }
}
```

The API merges overrides into the base metadata by `trait_type`, preserves
unchanged traits, and updates `Metadata Version`. The helper functions are
structured so this file can later be replaced by Supabase, Neon, or Postgres.

## Caching

The API responds with:

```text
Cache-Control: s-maxage=60, stale-while-revalidate=300
CDN-Cache-Control: s-maxage=60, stale-while-revalidate=300
Netlify-CDN-Cache-Control: s-maxage=60, stale-while-revalidate=300
```

The standard header covers regular Next.js responses. The CDN-specific headers
let Netlify apply the same short-lived dynamic cache policy at the edge.

OpenSea and other marketplaces may cache metadata separately. After rerolls or
trait updates, use marketplace metadata refresh tools when needed.

## Validation

Run:

```bash
npm run validate:metadata
```

The script checks token IDs `1` through `DYOOR_S2_MAX_SUPPLY`, confirms required
fields and trait types, and reports how many tokens used fallback metadata.
