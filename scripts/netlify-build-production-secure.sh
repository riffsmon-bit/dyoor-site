#!/usr/bin/env bash
set -euo pipefail

DYOOR_PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DYOOR_ENV_BACKUP_DIR="$(mktemp -d)"
DYOOR_SHARP_STAGING_DIR="$(mktemp -d)"
DYOOR_STAGED_SHARP_LINUX=0
DYOOR_STAGED_SHARP_LIBVIPS=0

restore_local_environment() {
  if [ "$DYOOR_STAGED_SHARP_LINUX" = "1" ]; then
    rm -rf "$DYOOR_PROJECT_ROOT/node_modules/@img/sharp-linux-x64"
  fi
  if [ "$DYOOR_STAGED_SHARP_LIBVIPS" = "1" ]; then
    rm -rf "$DYOOR_PROJECT_ROOT/node_modules/@img/sharp-libvips-linux-x64"
  fi
  rm -rf "$DYOOR_SHARP_STAGING_DIR"
  for DYOOR_ENV_NAME in .env .env.local; do
    if [ -f "$DYOOR_ENV_BACKUP_DIR/$DYOOR_ENV_NAME" ]; then
      mv "$DYOOR_ENV_BACKUP_DIR/$DYOOR_ENV_NAME" "$DYOOR_PROJECT_ROOT/$DYOOR_ENV_NAME"
    fi
  done
  if [ -f "$DYOOR_ENV_BACKUP_DIR/hoodyoor-mainnet.env" ]; then
    mkdir -p "$DYOOR_PROJECT_ROOT/data/game/private"
    mv "$DYOOR_ENV_BACKUP_DIR/hoodyoor-mainnet.env" \
      "$DYOOR_PROJECT_ROOT/data/game/private/hoodyoor-mainnet.env"
  fi
  rmdir "$DYOOR_ENV_BACKUP_DIR" 2>/dev/null || true
}

trap restore_local_environment EXIT INT TERM HUP

for DYOOR_ENV_NAME in .env .env.local; do
  if [ -f "$DYOOR_PROJECT_ROOT/$DYOOR_ENV_NAME" ]; then
    mv "$DYOOR_PROJECT_ROOT/$DYOOR_ENV_NAME" "$DYOOR_ENV_BACKUP_DIR/$DYOOR_ENV_NAME"
  fi
done

if [ -f "$DYOOR_PROJECT_ROOT/data/game/private/hoodyoor-mainnet.env" ]; then
  mv "$DYOOR_PROJECT_ROOT/data/game/private/hoodyoor-mainnet.env" \
    "$DYOOR_ENV_BACKUP_DIR/hoodyoor-mainnet.env"
fi

cd "$DYOOR_PROJECT_ROOT"

# Netlify Functions run Linux x64, while reviewed prebuilt deploys are commonly
# assembled on a developer Mac. Sharp is an external native package, so npm only
# installing the host binary would produce a bundle that builds successfully but
# fails the moment Trait Lab composes an image in production. Stage the exact
# locked Sharp version's Linux packages for tracing, then remove them locally.
DYOOR_SHARP_VERSION="$(node -p "require('./node_modules/sharp/package.json').version")"
npm install \
  --prefix "$DYOOR_SHARP_STAGING_DIR" \
  --package-lock=false \
  --ignore-scripts \
  --include=optional \
  --no-audit \
  --no-fund \
  --os=linux \
  --cpu=x64 \
  --libc=glibc \
  "sharp@$DYOOR_SHARP_VERSION"

mkdir -p "$DYOOR_PROJECT_ROOT/node_modules/@img"
for DYOOR_SHARP_PACKAGE_NAME in sharp-linux-x64 sharp-libvips-linux-x64; do
  DYOOR_SHARP_SOURCE="$DYOOR_SHARP_STAGING_DIR/node_modules/@img/$DYOOR_SHARP_PACKAGE_NAME"
  DYOOR_SHARP_DESTINATION="$DYOOR_PROJECT_ROOT/node_modules/@img/$DYOOR_SHARP_PACKAGE_NAME"
  if [ ! -d "$DYOOR_SHARP_SOURCE" ]; then
    echo "Blocked: npm did not install @img/$DYOOR_SHARP_PACKAGE_NAME for Netlify Linux." >&2
    exit 1
  fi
  if [ ! -d "$DYOOR_SHARP_DESTINATION" ]; then
    cp -R "$DYOOR_SHARP_SOURCE" "$DYOOR_SHARP_DESTINATION"
    if [ "$DYOOR_SHARP_PACKAGE_NAME" = "sharp-linux-x64" ]; then
      DYOOR_STAGED_SHARP_LINUX=1
    else
      DYOOR_STAGED_SHARP_LIBVIPS=1
    fi
  fi
done

npx netlify build --context production

for DYOOR_FUNCTION_ARCHIVE in .netlify/functions/*.zip; do
  DYOOR_ZIP_LIST="$DYOOR_ENV_BACKUP_DIR/$(basename "$DYOOR_FUNCTION_ARCHIVE").txt"
  unzip -Z1 "$DYOOR_FUNCTION_ARCHIVE" > "$DYOOR_ZIP_LIST"
  if rg -q '(^|/)\.env($|\.)' "$DYOOR_ZIP_LIST"; then
    echo "Blocked: an environment file was bundled in $DYOOR_FUNCTION_ARCHIVE" >&2
    exit 1
  fi
  rm "$DYOOR_ZIP_LIST"
done

DYOOR_NEXT_HANDLER_ARCHIVE="$(find .netlify/functions -maxdepth 1 -name '*server-handler*.zip' -print -quit)"
if [ -z "$DYOOR_NEXT_HANDLER_ARCHIVE" ]; then
  echo "Blocked: the Netlify Next.js server-handler archive was not produced." >&2
  exit 1
fi

DYOOR_NEXT_HANDLER_LIST="$DYOOR_ENV_BACKUP_DIR/netlify-server-handler.txt"
unzip -Z1 "$DYOOR_NEXT_HANDLER_ARCHIVE" > "$DYOOR_NEXT_HANDLER_LIST"
if ! rg -q '^node_modules/@img/sharp-linux-x64/lib/sharp-linux-x64\.node$' "$DYOOR_NEXT_HANDLER_LIST"; then
  echo "Blocked: the Netlify server bundle is missing Sharp's Linux x64 native module." >&2
  exit 1
fi
if ! rg -q '^node_modules/@img/sharp-libvips-linux-x64/lib/libvips-cpp\.so' "$DYOOR_NEXT_HANDLER_LIST"; then
  echo "Blocked: the Netlify server bundle is missing Sharp's Linux x64 libvips runtime." >&2
  exit 1
fi
rm "$DYOOR_NEXT_HANDLER_LIST"

echo "Secure Netlify production build complete; no .env files are present in function ZIPs and Sharp's Linux runtime is bundled."
