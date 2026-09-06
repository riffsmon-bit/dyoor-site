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
if [ -n "${IPFS_SWARM_ANNOUNCE:-}" ]; then
  # Railway's TCP proxy uses a different public port from the container listener.
  ipfs config --json Addresses.Announce "$(jq -cn --arg addr "$IPFS_SWARM_ANNOUNCE" '[$addr]')"
  # The TCP proxy arrives from Railway's CGNAT range. The server profile's
  # default filter rejects it before libp2p can negotiate a secure connection.
  # Keep all other private-address filters and NoAnnounce rules unchanged.
  ipfs config --json Swarm.AddrFilters "$(jq -c '(.Swarm.AddrFilters // []) | map(select(. != "/ip4/100.64.0.0/ipcidr/10"))' "$IPFS_PATH/config")"
fi
ipfs config --json Gateway.NoFetch true
ipfs config --json Gateway.ExposeRoutingAPI false
ipfs config --json Gateway.NoDNSLink true
ipfs config --json Datastore.HashOnRead true
ipfs config Datastore.StorageMax "${IPFS_STORAGE_MAX:-20GB}"
ipfs config Datastore.GCPeriod 12h
ipfs config --json Swarm.ConnMgr.LowWater 40
ipfs config --json Swarm.ConnMgr.HighWater 100
ipfs config Plugins.Plugins.telemetry.Config.Mode off
ipfs config Internal.ShutdownTimeout 10s
ipfs daemon --enable-gc &
daemon_pid=$!
cleanup() {
  trap - EXIT INT TERM
  kill "$daemon_pid" "${proxy_pid:-}" 2>/dev/null || true
  remaining=10
  while [ "$remaining" -gt 0 ] && { is_running "$daemon_pid" || { [ -n "${proxy_pid:-}" ] && is_running "$proxy_pid"; }; }; do
    sleep 1
    remaining=$((remaining - 1))
  done
  is_running "$daemon_pid" && kill -KILL "$daemon_pid" 2>/dev/null || true
  if [ -n "${proxy_pid:-}" ]; then is_running "$proxy_pid" && kill -KILL "$proxy_pid" 2>/dev/null || true; fi
  wait "$daemon_pid" "${proxy_pid:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM
is_running() {
  # kill -0 alone also succeeds for an exited, unreaped child (a zombie).
  kill -0 "$1" 2>/dev/null && [ "$(cut -d ' ' -f 3 "/proc/$1/stat" 2>/dev/null)" != Z ]
}
# `ipfs id` can succeed by reading an offline repository. Require the actual
# daemon's loopback API before publishing the HTTP gateway.
until curl -fsS --max-time 3 -X POST http://127.0.0.1:5001/api/v0/id >/dev/null 2>&1; do
  is_running "$daemon_pid" || exit 1
  sleep 1
done
caddy run --config /opt/dyoor/Caddyfile --adapter caddyfile &
proxy_pid=$!
unhealthy=0
while is_running "$daemon_pid" && is_running "$proxy_pid"; do
  if curl -fsS --max-time 3 -X POST http://127.0.0.1:5001/api/v0/id >/dev/null 2>&1; then
    unhealthy=0
  else
    unhealthy=$((unhealthy + 1))
    [ "$unhealthy" -lt 2 ] || break
  fi
  sleep 5
done
exit 1
