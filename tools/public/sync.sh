#!/usr/bin/env bash
# Sync the app (without internal ops docs) into the public repository checkout.
#   tools/public/sync.sh /path/to/fishhunter-public-clone
set -euo pipefail
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
DST="${1:?public repo path}"
[ -d "$DST/.git" ] || { echo "not a git checkout: $DST" >&2; exit 1; }
# Replace everything except .git so deleted files disappear too.
find "$DST" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
tar -C "$SRC" --exclude='./ops' --exclude='./data' --exclude='./README.md' --exclude='./.github' -cf - . | tar -C "$DST" -xf -
mkdir -p "$DST/.github/workflows"
cp "$SRC/tools/public/pages.yml" "$DST/.github/workflows/pages.yml"
cp "$SRC/tools/public/README.md" "$DST/README.md"
echo "synced $SRC -> $DST"
