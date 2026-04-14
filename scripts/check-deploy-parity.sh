#!/bin/bash
# Check plugin repo vs local deployed
set -euo pipefail

REPO_DIST="dist/index.js"
LOCAL_DIST="$HOME/.openclaw/extensions/cortex/dist/index.js"

if ! diff -q "$REPO_DIST" "$LOCAL_DIST" >/dev/null 2>&1; then
  echo "DRIFT: repo dist differs from local deployed"
  echo "Run: cd ~/repos/evaos-cortex-plugin && npm run build && cp -r dist/* ~/.openclaw/extensions/cortex/dist/"
  exit 1
fi

echo "PLUGIN PARITY OK"
