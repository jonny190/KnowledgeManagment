#!/usr/bin/env bash
set -euo pipefail

SRC="${DRAWIO_SRC:-/home/jonny/drawio}"
DEST="apps/web/public/drawio"

if [[ ! -d "$SRC/src/main/webapp" ]]; then
  echo "drawio source not found at $SRC" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"

cp -R "$SRC/src/main/webapp/index.html"       "$DEST/index.html"
cp -R "$SRC/src/main/webapp/js"               "$DEST/js"
cp -R "$SRC/src/main/webapp/styles"           "$DEST/styles"
cp -R "$SRC/src/main/webapp/images"           "$DEST/images"
cp -R "$SRC/src/main/webapp/shapes"           "$DEST/shapes"
cp -R "$SRC/src/main/webapp/stencils"         "$DEST/stencils"
cp -R "$SRC/src/main/webapp/resources"        "$DEST/resources"
cp -R "$SRC/src/main/webapp/mxgraph"          "$DEST/mxgraph"
cp -R "$SRC/src/main/webapp/plugins"          "$DEST/plugins"
cp -R "$SRC/src/main/webapp/math4"            "$DEST/math4"
cp    "$SRC/src/main/webapp/favicon.ico"      "$DEST/favicon.ico"

SHA=$(git -C "$SRC" rev-parse HEAD)
echo "$SHA" > "$DEST/VERSION"
echo "vendored drawio $SHA into $DEST"
