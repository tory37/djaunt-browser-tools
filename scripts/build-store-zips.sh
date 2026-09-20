#!/usr/bin/env bash
# Builds Chrome Web Store-ready zips: manifest.json at the ZIP ROOT (the dashboard
# rejects a zip with the extension folder as a prefix, which is what
# downloads/<ext>.zip deliberately has for the "unzip and Load unpacked" flow).
# Output goes to store-zips/, which is gitignored — these are upload artifacts,
# regenerate them any time, don't commit them.
set -euo pipefail

cd "$(dirname "$0")/.."

extensions=(host-swap query-params tab-volume dark-mode color-picker net-mock)

mkdir -p store-zips

for ext in "${extensions[@]}"; do
  version=$(node -pe "require('./${ext}/manifest.json').version")
  zip_path="store-zips/${ext}-${version}.zip"
  rm -f "$zip_path"
  (
    cd "$ext"
    zip -rX -q "../$zip_path" . \
      -x '*.DS_Store' \
      -x 'test.mjs' \
      -x 'README.md' \
      -x 'API.md'
  )
  echo "built $zip_path"
done
