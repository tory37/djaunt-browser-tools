#!/usr/bin/env bash
# Rebuilds <extension>/downloads/<extension>.zip for every listed extension, so
# index.html's Download buttons work for people who don't use git. Run this and commit
# the result whenever an extension's files change — see CLAUDE.md.
set -euo pipefail

cd "$(dirname "$0")/.."

extensions=(host-swap query-params header-editor prettifier storage-inspector tab-volume dark-mode color-picker net-mock clock-tools)

for ext in "${extensions[@]}"; do
  mkdir -p "$ext/downloads"
  zip_path="$ext/downloads/${ext}.zip"
  rm -f "$zip_path"
  # -X: no extra file attributes (deterministic-ish output); paths keep the "$ext/"
  # prefix so extracting gives a clean named folder instead of loose files. The zip
  # lands inside the tree it's zipping, so its own output path (plus the other
  # publishing-only files that live alongside the code now) must be excluded, or it'd
  # include a stale copy of itself and ship internal store-submission files to users.
  zip -rX -q "$zip_path" "$ext" \
    -x "$ext/*.DS_Store" \
    -x "$ext/downloads/*" \
    -x "$ext/store-listing.md" \
    -x "$ext/store-assets/*" \
    -x "$ext/store-zips/*"
  echo "built $zip_path"
done
