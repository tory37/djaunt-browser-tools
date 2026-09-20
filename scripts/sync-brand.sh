#!/usr/bin/env bash
# Vendors brand/ from djaunt-branding into root brand/, then fans it out to
# every extension folder. Extensions ship as standalone zips (Chrome/Firefox
# store packages), so each needs its own self-contained copy — no live CDN
# link at popup-open time, no submodule. This script is how that copy stays
# a deliberate sync instead of hand-edited drift.
#
# Run this, then ./scripts/build-zips.sh, then commit both.
set -euo pipefail

cd "$(dirname "$0")/.."

# Either a local checkout of djaunt-branding (fastest, no network) or its
# jsDelivr base URL (for CI / anywhere without a sibling clone on disk).
SRC="${DJAUNT_BRANDING_REF:-https://cdn.jsdelivr.net/gh/tory37/djaunt-branding@main}"
extensions=(host-swap query-params tab-volume dark-mode color-picker net-mock todo-sync)

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if [ -d "$SRC" ]; then
  fetch() { cp "$SRC/$1" "$tmp/$2"; }
else
  fetch() { curl -fsSL "$SRC/$1" -o "$tmp/$2"; }
fi

fetch "brand/tokens/tokens.css" "tokens.css"
fetch "brand/fonts.css" "fonts.css"
mkdir -p "$tmp/fonts"
for f in archivo-var ibm-plex-mono-400 ibm-plex-mono-500 ibm-plex-sans-var; do
  fetch "brand/fonts/$f.woff2" "fonts/$f.woff2"
done
fetch "brand/logo/djaunt-icon.svg" "dragon.svg"
fetch "brand/logo/djaunt-wordmark.svg" "wordmark.svg"

# components/popup/base.css is written for a repo where tokens.css/fonts.css
# are loaded separately by the consuming page, and it masks the logo from
# ../../brand/logo/. This repo's popup.css files instead @import 'brand/base.css'
# and expect base.css to pull in tokens+fonts itself, with the logo flat
# alongside it — rewrite both to fit that shape.
fetch "components/popup/base.css" "base.css"
sed -i \
  -e "1i @import url('tokens.css');\n@import url('fonts.css');\n" \
  -e "s#url('\.\./\.\./brand/logo/djaunt-icon\.svg')#url('dragon.svg')#" \
  -e "s#url('\.\./\.\./brand/logo/djaunt-wordmark\.svg')#url('wordmark.svg')#" \
  "$tmp/base.css"

sync_into() {
  local dest="$1"
  mkdir -p "$dest/fonts"
  cp "$tmp/tokens.css" "$dest/tokens.css"
  cp "$tmp/fonts.css" "$dest/fonts.css"
  cp "$tmp"/fonts/*.woff2 "$dest/fonts/"
  cp "$tmp/dragon.svg" "$dest/dragon.svg"
  cp "$tmp/wordmark.svg" "$dest/wordmark.svg"
  cp "$tmp/base.css" "$dest/base.css"
}

sync_into "brand"
for ext in "${extensions[@]}"; do
  sync_into "$ext/brand"
done

echo "synced brand/ from $SRC into root + ${#extensions[@]} extensions"

# components/list-row is only used by the extensions built around a
# collapsible row list — vendor it straight (no path rewrite needed, it has
# no asset references of its own).
list_row_extensions=(host-swap query-params net-mock)
fetch "components/list-row/list-row.css" "list-row.css"
for ext in "${list_row_extensions[@]}"; do
  cp "$tmp/list-row.css" "$ext/brand/list-row.css"
done

echo "synced components/list-row into ${#list_row_extensions[@]} extensions"
