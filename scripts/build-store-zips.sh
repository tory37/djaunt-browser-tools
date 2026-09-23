#!/usr/bin/env bash
# Builds Chrome Web Store-ready zips: manifest.json at the ZIP ROOT (the dashboard
# rejects a zip with the extension folder as a prefix, which is what
# <ext>/downloads/<ext>.zip deliberately has for the "unzip and Load unpacked" flow).
# Output goes to <ext>/store-zips/, which is gitignored — these are upload artifacts,
# regenerate them any time, don't commit them.
set -euo pipefail

cd "$(dirname "$0")/.."

extensions=(host-swap query-params header-editor prettifier storage-inspector tab-volume dark-mode color-picker net-mock clock-tools)

for ext in "${extensions[@]}"; do
  version=$(node -pe "require('./${ext}/manifest.json').version")
  rel_zip="store-zips/${ext}-${version}.zip"
  zip_path="${ext}/${rel_zip}"
  mkdir -p "${ext}/store-zips"
  rm -f "$zip_path"
  (
    cd "$ext"
    # Excludes the other publishing-only files living alongside the code now, plus
    # this zip's own output path (it lands inside the tree it's zipping).
    zip -rX -q "$rel_zip" . \
      -x '*.DS_Store' \
      -x 'test.mjs' \
      -x 'README.md' \
      -x 'API.md' \
      -x 'downloads/*' \
      -x 'store-listing.md' \
      -x 'store-assets/*' \
      -x 'store-zips/*'
  )
  echo "built $zip_path"
done
