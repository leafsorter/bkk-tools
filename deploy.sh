#!/bin/sh
# Sync organizer-views.js from its source of truth (the LeafSorter skill folder),
# commit, and push — the page loader picks the new version up on next load.
set -eu
cd "$(dirname "$0")"
SRC="$HOME/code/LeafSorter/.claude/skills/uf-bt-wa-collections/wa_sites/bosveldkunste/exports/organizer-views.js"
cp "$SRC" organizer-views.js
git add organizer-views.js
if git diff --cached --quiet; then
  echo "no changes"
  exit 0
fi
git commit -m "deploy organizer-views $(date +%Y-%m-%dT%H:%M)"
git push
echo "deployed — loader URL serves the new version (raw CDN cache ≤5 min; loader cache-busts)"
