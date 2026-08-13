#!/bin/sh
set -eu

umask 077

if [ -n "${RAILWAY_VOLUME_MOUNT_PATH:-}" ]; then
  # Railway creates and mounts this path before invoking the container. The
  # initial release already established node ownership, so startup must not
  # mutate or recursively inspect persistent storage.
  test -d "${RAILWAY_VOLUME_MOUNT_PATH}"
fi

echo "DYØØR entrypoint ready"
exec gosu node "$@"
