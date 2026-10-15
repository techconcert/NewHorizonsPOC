#!/usr/bin/env bash
# Starts the Vite dev server on the first free port at or above 5273 and prints the link.
# Usage: npm run dev   (or: bash scripts/dev.sh)
cd "$(dirname "$0")/.." || exit 1

PORT=$(node -e '
const net = require("net");
function tryPort(p) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(p, "127.0.0.1");
  });
}
(async () => {
  for (let p = 5273; p < 5373; p++) {
    if (await tryPort(p)) { console.log(p); return; }
  }
  process.exit(1);
})();
')

if [ -z "$PORT" ]; then
  echo "No free port found between 5273 and 5372." >&2
  exit 1
fi

echo ""
echo "  Colony Ship dev server: http://localhost:${PORT}/"
echo "  Debug overlay:          http://localhost:${PORT}/?debug"
echo ""
exec node node_modules/vite/bin/vite.js --port "$PORT" --strictPort --host 127.0.0.1
