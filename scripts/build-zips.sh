#!/usr/bin/env bash
# Rebuilds downloads/<extension>.zip for every listed extension, so index.html's
# Download buttons work for people who don't use git. Run this and commit the result
# whenever an extension's files change — see CLAUDE.md.
set -euo pipefail

cd "$(dirname "$0")/.."

extensions=(host-swap query-params tab-volume dark-mode color-picker)

mkdir -p downloads

for ext in "${extensions[@]}"; do
  zip_path="downloads/${ext}.zip"
  rm -f "$zip_path"
  # -X: no extra file attributes (deterministic-ish output); paths keep the "$ext/"
  # prefix so extracting gives a clean named folder instead of loose files.
  zip -rX -q "$zip_path" "$ext" -x "$ext/*.DS_Store"
  echo "built $zip_path"
done
