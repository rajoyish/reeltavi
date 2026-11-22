#!/bin/sh
# Builds the Chrome Web Store upload: dist/reeltavi-<version>.zip containing only extension files.
set -eu
cd "$(dirname "$0")/.."
version=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')
out="dist/reeltavi-$version.zip"
mkdir -p dist
rm -f "$out"
zip -q -r -X "$out" \
  manifest.json LICENSE \
  content.js content.css \
  popup.html popup.js popup.css \
  download-source.js download-worker.js download-mp4.mjs \
  offscreen.html offscreen.mjs \
  icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png \
  vendor/mediabunny/mediabunny.min.mjs vendor/mediabunny/LICENSE
echo "$out ($(du -h "$out" | cut -f1 | tr -d ' '))"
