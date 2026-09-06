#!/bin/sh
# Called only by an administrator over SSH, never by a public HTTP route.
set -eu
root="$1"
file="$2"
source_gateway=https://jade-efficient-beaver-697.mypinata.cloud
cid_version=1
case "$root" in
  bafybeidz7htb3digthznwvl4ytdpckq2q3d2ytgxtsie5bcp7a4lgtb2sq|bafybeifz4gwsvqbypeki3wwwmmvng2z2lusqjndevfqemzibisk266vepq|bafybeigzwmixppsb5hff7hioos3j427l7esli742p6p6hvyoxz3jfv7oiu|bafybeidbaema3cr6n7sc3rglryevbtxziqrz3sk2d6equehsssziobcrru) ;;
  QmShXqgZ1eLNGD11PHe4TZyu14T3iqxewp25AEycy252HU|QmTPskHN7uyZbiUKEYmQG9NRjaiELwTYwoko7QQrpaVmCB)
    source_gateway=https://gateway.pinata.cloud
    cid_version=0
    ;;
  *) echo 'Unrecognized collection' >&2; exit 1 ;;
esac
case "$file" in .|..|*[!a-zA-Z0-9._-]*|'') echo 'Unsafe filename' >&2; exit 1 ;; esac
mkdir -p "$IPFS_PATH/mirror-status/$root"
marker="$IPFS_PATH/mirror-status/$root/$file"
if [ -f "$marker" ] && [ "${DYOOR_VERIFY_EXISTING:-0}" != 1 ]; then
  # Import checkpoints are not a completeness assertion: the enclosing job must
  # recursively pin and verify the entire root before traffic is switched.
  exit 0
fi
# Bitswap may already have completed this file while other workers imported.
if curl -fsS --max-time 90 "http://127.0.0.1:8081/ipfs/$root/$file" -o /dev/null 2>/dev/null; then
  touch "$marker"
  exit 0
fi
temporary=$(mktemp /tmp/dyoor-car.XXXXXX)
trap 'rm -f "$temporary"' EXIT
# Pinata serves regular PNGs faster than uncached per-file CAR traversal. A
# normal re-add is accepted ONLY when its CID exactly matches the original DAG.
index="$IPFS_PATH/$root.index.json"
if [ "$root" = bafybeifz4gwsvqbypeki3wwwmmvng2z2lusqjndevfqemzibisk266vepq ]; then index="$IPFS_PATH/originals-index.json"; fi
if [ -f "$index" ]; then
  expected=$(jq -r --arg name "$file" '.Links[] | select(.Name == $name) | .Hash["/"]' "$index" 2>/dev/null || true)
  if [ -n "$expected" ] && curl -fsSL --connect-timeout 15 --max-time 60 \
    "$source_gateway/ipfs/$root/$file" -o "$temporary"; then
    actual=$(ipfs add -Q --cid-version="$cid_version" --pin=false "$temporary" || true)
    if [ "$actual" = "$expected" ] && curl -fsS --max-time 90 "http://127.0.0.1:8081/ipfs/$root/$file" -o /dev/null; then
      touch "$marker"
      exit 0
    fi
  fi
fi
for attempt in 1 2 3; do
  if curl --fail --silent --show-error --location --connect-timeout 15 --max-time 120 \
    "$source_gateway/ipfs/$root/$file?format=car&dag-scope=all" -o "$temporary" && \
    ipfs dag import --pin-roots=false "$temporary" >/dev/null && \
    curl -fsS --max-time 90 "http://127.0.0.1:8081/ipfs/$root/$file" -o /dev/null; then
    touch "$marker"
    exit 0
  fi
done
echo "FAILED $root/$file" >&2
exit 1
