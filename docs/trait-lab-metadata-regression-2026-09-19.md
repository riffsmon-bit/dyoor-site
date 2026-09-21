# D.Y.O.O.R S2 Trait Lab metadata regression

## Root cause

Commit `12bf91de46d503452de4c6a9839bb79fa3a78bed` added the generic
`IPFS_GATEWAY_URL` / `NEXT_PUBLIC_IPFS_GATEWAY_URL` lookup ahead of the
dedicated `DYOOR_S2_METADATA_BASE_URL` / `DYOOR_S2_METADATA_URL` settings in
`remoteMetadataBaseUrl()`. The self-hosted gateway is configured for the
collection's immutable assets, but it is not an implicit replacement for the
authoritative S2 metadata source. When that gateway does not serve the S2
metadata CID, the async builder falls through to synthetic fallback metadata.
The fallback contains placeholder values, and the Trait Lab rendered those
values as empty slots.

The July scoped-override change also left historical records keyed only by
token ID. The runtime store currently contains that legacy shape for token 1.
The repair keeps scoped records preferred and reads a legacy record only when
its token/deployment metadata is compatible; it does not rewrite or delete
legacy data.

## Repair direction

The dedicated S2 metadata source is restored as the first explicit source.
Metadata is marked authoritative only when a real base document exists and
contains the required guaranteed traits. The API and Trait Lab reject
non-authoritative metadata with a recoverable error before any reroll charge or
mutation. Existing runtime overrides continue to merge over immutable base
metadata, and the metadata route remains dynamic with `no-store` headers.
