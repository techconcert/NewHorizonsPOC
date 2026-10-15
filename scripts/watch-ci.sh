#!/usr/bin/env bash
# Watches src/ and tests/ and reruns `npm run ci` whenever they change.
# Writes status to ci-status.txt and full output to ci-last.log (both in the project root).
# Usage: bash scripts/watch-ci.sh   (leave it running; Ctrl+C to stop)

cd "$(dirname "$0")/.." || exit 1
STATUS=ci-status.txt
LOG=ci-last.log
LAST_HASH=""

fingerprint() {
  find src tests -type f | sort | xargs cksum 2>/dev/null | cksum
}

run_ci() {
  local stamp
  stamp=$(date '+%Y-%m-%d %H:%M:%S')
  printf 'RUNNING since %s\n' "$stamp" > "$STATUS"
  if npm run ci > "$LOG" 2>&1; then
    result=PASSED
  else
    result=FAILED
  fi
  {
    printf '%s at %s\n' "$result" "$(date '+%Y-%m-%d %H:%M:%S')"
    printf 'Full output: %s\n\n' "$LOG"
    tail -n 60 "$LOG"
  } > "$STATUS"
  echo "[$(date '+%H:%M:%S')] $result"
}

echo "Watching src/ and tests/ for changes. Status file: $STATUS"
while true; do
  HASH=$(fingerprint)
  if [ "$HASH" != "$LAST_HASH" ]; then
    LAST_HASH=$HASH
    run_ci
  fi
  sleep 5
done
