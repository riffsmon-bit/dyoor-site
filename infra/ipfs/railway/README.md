# DYOOR's hosted IPFS node

This service is separate from the Discord bot and Netlify website. Kubo serves
only the collections allowlisted in `Caddyfile`, through `ipfs.dyoor.fun`.
The administration API and unfiltered gateway bind to loopback. Railway
terminates HTTPS. `Gateway.NoFetch=true` prevents arbitrary public requests
from using the node as a recursive IPFS proxy.

## Durable storage

The current account's effective volume cap is **500 MB**, despite its Hobby
label. Large IPFS blocks therefore live in the private `dyoor-ipfs-blocks`
Railway bucket. The persistent volume holds the node identity and metadata
database at `/data/ipfs/s3-node`. Preserve **both** the bucket and volume.
The earlier flat-file bootstrap repository remains outside that subdirectory;
it is not the active S3-backed node and is not a complete artwork mirror.

The Dockerfile builds Kubo 0.43.0 with IPFS's `go-ds-s3` driver, pinned to commit
`e4823540f59b71ce7969213faed4608c237a7296`. A one-line compatibility change uses
virtual-hosted URLs, as required by new Railway buckets. The driver is opt-in
and upstream requests maintainers; upgrades require import, restart, and
retrieval tests, not just a successful build. No unpinned plugin binary is
downloaded at startup.

`transport.go` also bounds the shared S3 connection pool to 64 active / 32 idle
connections per host, with request timeouts. This avoids exhausting outbound
ports during bulk imports. Keep import concurrency at four files; checkpoints
can resume interrupted jobs, but recursive pin verification is still mandatory.
Block hashes are checked on reads, including after a restart, to detect backing
storage corruption instead of serving bytes that do not match their CID.

Secrets are Railway reference variables and are never copied into Git, the
image, public URLs, or Kubo's config. Required service variables:

```dotenv
PORT=8080
IPFS_SWARM_ANNOUNCE=/dns4/hayabusa.proxy.rlwy.net/tcp/26513
AWS_REGION=auto
AWS_ACCESS_KEY_ID=${{dyoor-ipfs-blocks.ACCESS_KEY_ID}}
AWS_SECRET_ACCESS_KEY=${{dyoor-ipfs-blocks.SECRET_ACCESS_KEY}}
IPFS_S3_BUCKET=${{dyoor-ipfs-blocks.BUCKET}}
IPFS_S3_ENDPOINT=${{dyoor-ipfs-blocks.ENDPOINT}}
```

Set `PORT` explicitly: the public swarm TCP proxy must not cause Railway to
select port 4001 for the HTTP health check. Configure `/healthz`, 120 seconds,
one replica, no sleeping, and a 1 GB RAM / 1 vCPU service ceiling. Go's memory
target is 600 MiB. These are resource ceilings, not a fixed-price billing cap.

The public TCP proxy targets container port 4001. Announce its actual public
hostname and port, not an unreachable container address, so external IPFS peers
can retrieve the preserved CIDs. Update `IPFS_SWARM_ANNOUNCE` if the proxy changes.
Railway forwards TCP connections from `100.64.0.0/10`. Startup removes only that
range from the server profile's swarm blocklist; all other private-address
filters and all `NoAnnounce` rules remain. The admin API stays on loopback.
After a network-address change, re-announce the collection roots with
`ipfs provide once CID` and verify peer connectivity from outside Railway.

## Deploy and import

Deploy only this directory using `railway up --path-as-root`, selecting the
`dyoor-ipfs` service explicitly. Never deploy it to `dyoor-discord`. Railway's
legacy `railway.toml` configuration is deprecated; service settings are stored
in Railway. Inspect deployment logs and wait for a successful health check.

Import CAR archives via SSH and the private API. CAR files retain the original
CIDs. The public gateway cannot upload, pin, unpin, or administer content.
For original artwork, `mirror-file.sh ROOT TOKEN.png` supports resumable,
bounded downloads and verifies the complete file through the **non-fetching**
local gateway after import. A directory CAR can contain only a partial DAG:
import success alone is not proof of a complete collection.

After all 3,333 images are imported, recursively pin the image root and run
`ipfs pin verify --verbose`. Repeat checks after restarting the service. Also
verify the metadata, trait images, trait metadata, and bundled base-layer roots
listed in `../dyoor-cids.txt`. Add new public roots to the Caddy allowlist before
using them. Never add private Netlify stores to this manifest or public IPFS.

The manifest also includes Season 1's 1,111 metadata documents and original
images, obtained from the mainnet contract's existing `tokenURI` (without any
contract transaction). Roots themselves are allowlisted for portable CAR
exports as well as individual asset paths. Run `node scripts/check-ipfs-gateway.mjs`
from the repository root for read-only HTTP/image/admin-isolation checks.

For full backups, prefer `ipfs dag export CID` from a completely pinned local
mirror. A long HTTP CAR download can finish with status 200 yet be truncated by
a streaming timeout. Neither HTTP success nor a checksum proves completeness.
Restore the archives into a **new, empty, offline** Kubo repository, require
successful `ipfs --offline dag import --pin-roots=true ...`, and verify every
expected root there. Enable `Datastore.HashOnRead` in that recovery repository.
Stop on any import error; never let a later successful command hide its exit
status. `pin verify` output must say `ok` for every expected root, not merely
return a successful process exit code. Verification against S3 is sequential
and may take substantially longer than an individual-image smoke check.

## Rerolls and recovery

IPFS stores immutable originals and layer assets. Live saved versions, Energy,
active rolls, and rendered reroll PNGs remain in Netlify Blobs. Changing an image
gateway does **not** reset those stores or require a contract transaction.
Do not replace the dynamic metadata API with a static IPFS base URI.

`scripts/backup-netlify-blobs.mjs` exports private stores with a key/file mapping,
SHA-256 checksums, metadata, timestamps, and error reporting. It is read-only.
Treat backups as confidential. Exports of a running application are not an
atomic database snapshot. Restore only explicitly selected stores/keys during
a coordinated recovery; never bulk-upload local development metadata to live
storage. Keep old exports rather than overwriting them.

Storage and server usage are metered on the existing Railway account. Do not
cancel the original pinning provider until full verification and independent
backups are confirmed. A laptop pin is not an always-on hosting guarantee.
