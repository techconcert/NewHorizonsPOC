# Colony Ship: project guide

Working title: **Colony Ship**. A macro 4X "Oregon Trail in space", built as a browser game in TypeScript. The player is a mission director who launches colony ships, reroutes them in flight, and manages planetfall expeditions. The player never controls individual units.

Source of truth: `docs/GAME_DESIGN.md`. If code and design disagree, the design wins unless `docs/DECISIONS.md` says otherwise.

## Pillars (non-negotiable)

1. **Never overly complex.** Few decisions, each one heavy. Complexity budget: `docs/GAME_DESIGN.md` section 10.
2. **Macro only.** The player sets policy. Ships, explorers, colonists and natives act on their own.
3. **Show the odds.** Every decision previews its effect before the player commits. Uncertainty comes from incomplete planet data, never hidden math.
4. **Visuals matter.** Civ6-inspired look, strongest when zoomed into colonies. Inspired by, never copied: no ripped assets, no lookalike branding.
5. **Performance is a feature.** 60 fps target, 30 fps floor, on a mid-range laptop.

## Stack

TypeScript (strict), Vite, Three.js (WebGL2), bitecs (ECS), Vitest, ESLint, Prettier, dependency-cruiser. The simulation runs in a Web Worker. Saves go to IndexedDB. Exact versions are pinned at project creation (D-014).

## Hard rules

- **Sim/render split.** `src/sim` is pure TypeScript with no DOM, Three.js or UI imports. Rendering and UI read snapshots from the worker and never write sim state. Player input becomes typed commands (`docs/ARCHITECTURE.md` section 5).
- **Determinism.** Same seed plus same command log gives the same state hash. Use only the seeded PRNG in `src/sim/rng.ts`. No `Math.random`, `Date.now`, `performance.now` or timers inside `src/sim`. Avoid `Math.sin`, `cos`, `exp`, `pow` and `log` in anything that affects a roll or the state hash (ARCHITECTURE section 4).
- **Limits.** At most 6 loadout dials, 3 choices per event card, 4 resources. A new mechanic must replace or merge with an existing one and needs a `DECISIONS.md` entry.
- **Hot path.** No allocations inside the day tick. Use typed arrays and preallocated buffers. No per-frame object creation in render code.
- **Content is data.** JSON in `src/data/`, schema-validated at build time. See `docs/CONTENT_GUIDE.md`.

## Repo layout

```
src/
  sim/              pure simulation: bitecs systems, formulas, generators, PRNG
  worker/           worker entry: owns the world, runs the tick loop, posts snapshots
  shared/           command and snapshot types used by worker and main thread
  data/             JSON content (hulls, events, terrain, techs, planets) and schemas
  render/           Three.js views: galaxy, planet, colony; interpolation; LOD
  ui/               DOM overlays and CommandBridge
tests/              Vitest suites (sim tests run in Node)
docs/               design, architecture, plan, decisions, balance, content
.claude/agents/     review subagents
```

Boundary rule, enforced by dependency-cruiser in CI: `src/sim` imports nothing from `render`, `ui`, `three` or the DOM.

## Workflow

- Work in the order in `docs/IMPLEMENTATION_PLAN.md`. Build the loop ugly first; visual polish is M6.
- Basic DOM UI is fine until M6.
- Before closing a milestone, run the review gate listed for it in the plan.

## Subagents (`.claude/agents/`)

| Agent | Use it when |
| --- | --- |
| `design-guardian` | Any gameplay change, new mechanic, UI decision, or event content |
| `ecs-performance-reviewer` | Any sim system, worker message, snapshot, or render sync code |
| `qa-determinism-tester` | New formulas or systems, and before closing a milestone |
| `balance-analyst` | After formulas or content change; during M7 |
| `visual-director` | Any render, LOD, camera, lighting, fog or UI look change |
| `content-writer` | New or edited event cards and flavour text |

## Definition of done

- Behaviour matches `docs/GAME_DESIGN.md`, or a decision entry explains the change.
- `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` all pass.
- New formulas have Vitest unit tests.
- No per-tick allocations in the sim; the frame budget in `docs/ARCHITECTURE.md` section 12 still holds.
- Relevant subagent review has no BLOCK findings.
