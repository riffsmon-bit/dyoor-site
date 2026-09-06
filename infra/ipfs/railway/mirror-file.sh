#!/bin/sh
# Called only by an administrator over SSH, never by a public HTTP route.
set -eu
root="$1"
file="$2"
case "$root" in
  bafybeidz7htb3digthznwvl4ytdpckq2q3d2ytgxtsie5bcp7a4lgtb2sq|bafybeifz4gwsvqbypeki3wwwmmvng2z2lusqjndevfqemzibisk266vepq|bafybeigzwmixppsb5hff7hioos3j427l7esli742p6p6hvyoxz3jfv7oiu|bafybeidbaema3cr6n7sc3rglryevbtxziqrz3sk2d6equehsssziobcrru) ;;
  *) echo 'Unrecognized collection' >&2; exit 1 ;;
esac
case "$file" in *[!a-zA-Z0-9._-]*|'') echo 'Unsafe filename' >&2; exit 1 ;; esac
mkdir -p "$IPFS_PATH/mirror-status/$root"
marker="$IPFS_PATH/mirror-status/$root/$file"
if [ -f "$marker" ] && curl -fsS --max-time 30 "http://127.0.0.1:8081/ipfs/$root/$file" -o /dev/null; then exit 0; fi
temporary=$(mktemp /tmp/dyoor-car.XXXXXX)
trap 'rm -f "$temporary"' EXIT
for attempt in 1 2 3; do
  if curl --fail --silent --show-error --location --connect-timeout 15 --max-time 120 \
    "https://jade-efficient-beaver-697.mypinata.cloud/ipfs/$root/$file?format=car&dag-scope=all" -o "$temporary" && \
    ipfs dag import --pin-roots=false "$temporary" >/dev/null && \
    curl -fsS --max-time 30 "http://127.0.0.1:8081/ipfs/$root/$file" -o /dev/null; then
    touch "$marker"
    exit 0
  fi
done
echo "FAILED $root/$file" >&2
exit 1
