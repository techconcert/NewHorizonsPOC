# Builder workflow (read this first)

Project: Colony Ship, a browser game. Repo root on the user's Mac: /Users/mac/Development/Claude/NewHorizons/colony-web,
reachable from the device shell as `$HOME/mnt/Claude/NewHorizons/colony-web`.

## Tools

- Load device tools: ToolSearch `select:mcp__remote-devices__device_bash,mcp__remote-devices__device_list_dir`.
- Each device_bash call is a fresh `bash -c`; anchor paths at the repo root; max 180 s per call.
- Write files with heredocs or python scripts. Never retype a file from truncated output. rm is not allowed (overwrite instead).
- Never write into any `.claude` folder. npm cannot reach the registry: install nothing, use only what package.json has.
  Installed: three 0.186.1, bitecs 0.4.0, vite, vitest, typescript, eslint, typescript-eslint, prettier, dependency-cruiser, @types/node, @types/three.

## Automatic CI feedback

A watcher on the Mac reruns `npm run ci` (typecheck, lint, depcheck, vitest, build) about 5 s after any change under src/ or tests/
and writes `ci-status.txt` (first line RUNNING, PASSED or FAILED, then the last 60 log lines) and `ci-last.log` (full output).
After each batch of edits: `sleep 40`, then `cat ci-status.txt`; if RUNNING, sleep 20 and re-check (up to 4 times).
Fix every failure until PASSED, with the PASSED timestamp newer than your last edit (check with `find src tests -newer ci-status.txt`).
Quick checks you can run yourself: `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/eslint/bin/eslint.js .`,
`node node_modules/prettier/bin/prettier.cjs --check src tests`. Run prettier --write on files you touched before finishing.
If the status file stays RUNNING or never updates for over 5 minutes, say so in your report; do not fake a pass.

## Hard rules (CLAUDE.md; enforced by eslint and dependency-cruiser)

- src/sim imports only src/shared, src/data and bitecs. No DOM, no three, no worker.
- src/render and src/ui import only src/shared and three. They never write sim stores.
- No Math.random, Date.now, performance.now, timers, Math.sin/cos/exp/pow/log (or other transcendental) or `**` in src/sim.
- No allocations in the day tick or in per-frame render loops (typed arrays, preallocated buffers).
- Iterate entities in ascending id order. Content is JSON in src/data with hand-written validators.
- Limits: at most 6 loadout dials, 3 choices per event card, 4 resources. No individual unit control. Keep it simple.
- Commands: typed, validated, logged; replay of seed plus command log must reproduce the same state hash.
- Every new stateful store goes into the hashed set; every new rule gets a test with literal expected values.
- Add a `// @vitest-environment node` header to sim tests. Record each decision as a new row in docs/DECISIONS.md (next free number).
- Do not git commit. Do not edit scripts/watch-ci.sh. Do not edit GAME_DESIGN.md unless the task says so.

## Reporting

Final report under 250 words: files created or changed, key choices, final ci-status.txt first line, Vitest test count (from ci-last.log),
what you could not verify (nothing here opens a browser). Be honest about gaps.

## Debug (render cost)

`?debug` shows the overlay (fps, frame ms). `?fx=` takes comma-separated render flags, read once at start; absent means the
normal behaviour (`?fx=nomsaa,scale=0.5` for example):

- `nomsaa`: no antialiasing (it is already off on software GL, SwiftShader/llvmpipe, detected from WEBGL_debug_renderer_info).
- `scale=<n>`: pin the render scale to n (0.25..1) and switch the auto-scaler off. Without it the scale is automatic
  (1, 0.75, 0.5 by frame time; starts at 0.5 on software GL).
- `nonebula`: no nebula backdrop quad (galaxy).
- `noglow`: no star or ship glow quads (galaxy).
- `nofield`: no background star-field points (galaxy).
