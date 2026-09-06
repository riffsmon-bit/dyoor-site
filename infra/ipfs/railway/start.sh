#!/bin/sh
set -eu
mkdir -p "$IPFS_PATH"
if [ ! -f "$IPFS_PATH/config" ]; then
  ipfs init --profile=server
  # This is only valid for a NEW empty repo. Never rewrite a populated datastore.
  test -n "${IPFS_S3_BUCKET:?Set the private backing bucket}"
  test -n "${IPFS_S3_ENDPOINT:?Set its S3 endpoint}"
  jq --arg bucket "$IPFS_S3_BUCKET" --arg region "${AWS_REGION:-auto}" --arg endpoint "$IPFS_S3_ENDPOINT" \
    '.Datastore.Spec.mounts[0] = {child:{type:"s3ds",region:$region,bucket:$bucket,regionEndpoint:$endpoint,rootDirectory:"blocks",accessKey:"",secretKey:"",workers:8},mountpoint:"/blocks",prefix:"s3.datastore",type:"measure"}' \
    "$IPFS_PATH/config" > "$IPFS_PATH/config.s3"
  mv "$IPFS_PATH/config.s3" "$IPFS_PATH/config"
  jq -cnS --arg bucket "$IPFS_S3_BUCKET" --arg region "${AWS_REGION:-auto}" \
    '{mounts:[{bucket:$bucket,mountpoint:"/blocks",region:$region,rootDirectory:"blocks"},{mountpoint:"/",path:"datastore",type:"levelds"}],type:"mount"}' > "$IPFS_PATH/datastore_spec"
fi
# Kubo compares this file byte-for-byte with canonical JSON, not parsed JSON.
# Reformatting is safe on existing stores; never replace a bucket's identity.
jq -cS . "$IPFS_PATH/datastore_spec" > "$IPFS_PATH/datastore_spec.canonical"
mv "$IPFS_PATH/datastore_spec.canonical" "$IPFS_PATH/datastore_spec"
if [ "$(jq -r '.Datastore.Spec.mounts[0].child.type' "$IPFS_PATH/config")" = s3ds ]; then
  test "$(jq -r '.Datastore.Spec.mounts[0].child.bucket' "$IPFS_PATH/config")" = "$IPFS_S3_BUCKET"
  jq --arg region "${AWS_REGION:-auto}" '.Datastore.Spec.mounts[0].child.region = $region' "$IPFS_PATH/config" > "$IPFS_PATH/config.region"
  mv "$IPFS_PATH/config.region" "$IPFS_PATH/config"
  jq -cS --arg region "${AWS_REGION:-auto}" '.mounts[0].region = $region' "$IPFS_PATH/datastore_spec" > "$IPFS_PATH/datastore_spec.region"
  mv "$IPFS_PATH/datastore_spec.region" "$IPFS_PATH/datastore_spec"
fi
# Administration and the unfiltered gateway never listen publicly.
ipfs config Addresses.API /ip4/127.0.0.1/tcp/5001
ipfs config Addresses.Gateway /ip4/127.0.0.1/tcp/8081
ipfs config --json Gateway.NoFetch true
ipfs config --json Gateway.ExposeRoutingAPI false
ipfs config --json Gateway.NoDNSLink true
ipfs config Datastore.StorageMax "${IPFS_STORAGE_MAX:-20GB}"
ipfs config Datastore.GCPeriod 12h
ipfs config --json Swarm.ConnMgr.LowWater 40
ipfs config --json Swarm.ConnMgr.HighWater 100
ipfs config Plugins.Plugins.telemetry.Config.Mode off
ipfs daemon --enable-gc &
daemon_pid=$!
cleanup() {
  kill "$daemon_pid" "${proxy_pid:-}" 2>/dev/null || true
  wait "$daemon_pid" "${proxy_pid:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
until ipfs id >/dev/null 2>&1; do
  kill -0 "$daemon_pid"
  sleep 1
done
caddy run --config /opt/dyoor/Caddyfile --adapter caddyfile &
proxy_pid=$!
while kill -0 "$daemon_pid" 2>/dev/null && kill -0 "$proxy_pid" 2>/dev/null; do
  sleep 5
done
exit 1
