#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${OPENCLAW_CORTEX_EXTENSION_DIR:-$HOME/.openclaw/extensions/cortex}"

cd "$ROOT_DIR"
npm run build

mkdir -p "$TARGET_DIR"
rsync -a --delete dist/ "$TARGET_DIR/dist/"
cp openclaw.plugin.json package.json package-lock.json README.md "$TARGET_DIR/"

SOURCE_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
DEPLOYED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
DIST_HASH="$(shasum -a 256 dist/index.js | awk '{print $1}')"
MANIFEST_HASH="$(shasum -a 256 openclaw.plugin.json | awk '{print $1}')"
PACKAGE_HASH="$(shasum -a 256 package.json | awk '{print $1}')"
PACKAGE_LOCK_HASH="$(shasum -a 256 package-lock.json | awk '{print $1}')"

cat > "$TARGET_DIR/.deploy-manifest.json" <<JSON
{
  "deployed_at": "$DEPLOYED_AT",
  "source_repo": "$ROOT_DIR",
  "source_commit": "$SOURCE_COMMIT",
  "target": "$TARGET_DIR",
  "files": {
    "dist/index.js": "$DIST_HASH",
    "openclaw.plugin.json": "$MANIFEST_HASH",
    "package.json": "$PACKAGE_HASH",
    "package-lock.json": "$PACKAGE_LOCK_HASH"
  }
}
JSON

echo "Deployed Cortex plugin to $TARGET_DIR"
cat "$TARGET_DIR/.deploy-manifest.json"
