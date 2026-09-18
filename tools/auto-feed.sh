#!/bin/sh
# Local loop for the LAN board and the KOReader slides. Production is fed by
# .github/workflows/edition.yml (every 30 minutes, commit the raw edition).
#
#   sh tools/auto-feed.sh [minutes]      # default: every 10 minutes
#
# The board page reloads itself every 10 minutes (see the meta refresh in the
# layout), so a browser left open on the Kindle picks each new edition up on its
# own. The summaries are written a few at a time per run (summaries_per_run in
# feeds.json), so a board with hundreds of stories fills up gradually instead of
# hammering the free models.
#
# Stop it with Ctrl-C, or in the background:
#   setsid nohup sh tools/auto-feed.sh > /tmp/prophet-feed.log 2>&1 &

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MINUTES="${1:-10}"
LOG="${LOG:-/tmp/prophet-feed.log}"

echo "auto-feed: every ${MINUTES} min (log: $LOG)"

while true; do
    {
        echo
        echo "=== $(date '+%Y-%m-%d %H:%M:%S') feeding ==="
        cd "$ROOT"
        cycle=$(date +%s)

        stage=$(date +%s)
        node tools/fetch-feeds.mjs
        echo "--- fetch: $(( $(date +%s) - stage ))s"

        stage=$(date +%s)
        node tools/summarize.mjs
        echo "--- summarize: $(( $(date +%s) - stage ))s"

        stage=$(date +%s)
        npm run build
        echo "--- build: $(( $(date +%s) - stage ))s"

        stage=$(date +%s)
        node tools/render-pages.mjs
        echo "--- render: $(( $(date +%s) - stage ))s"

        echo "=== done in $(( $(date +%s) - cycle ))s"
    } >> "$LOG" 2>&1
    sleep "$((MINUTES * 60))"
done
