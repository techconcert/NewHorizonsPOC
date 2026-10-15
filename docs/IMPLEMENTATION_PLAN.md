# Colony Ship: implementation plan (web)

Build the loop ugly first, then make it beautiful. The game is playable end to end at M4; the visual pass is M6. Sizes are relative effort: S, M, L. Each milestone closes only when the subagents named in its review gate report no BLOCK findings.

## Order at a glance

| Milestone | Delivers                                                 | Size | Review gate                                                      |
| --------- | -------------------------------------------------------- | ---- | ---------------------------------------------------------------- |
| M0        | Project setup, worker scaffold, boundary check, CI       | S    | ecs-performance-reviewer                                         |
| M1        | Simulation skeleton, galaxy, commands, placeholder map   | M    | ecs-performance-reviewer, qa-determinism-tester                  |
| M2        | Mission Command: six dials, derived numbers, launch      | M    | design-guardian, qa-determinism-tester                           |
| M3        | Ships in Transit: travel, supplies, events, rerouting    | L    | design-guardian, ecs-performance-reviewer, qa-determinism-tester |
| M4        | Planetfall: expeditions, natives, founding (loop closes) | L    | design-guardian, qa-determinism-tester, balance-analyst          |
| M5        | Colony, research, win and lose, save and load            | M    | design-guardian, qa-determinism-tester                           |
| M6        | Visual pass: Civ6-inspired colonies, zoom, LOD           | L    | visual-director, ecs-performance-reviewer                        |
| M7        | Content, balance, tutorial                               | M    | balance-analyst, content-writer, design-guardian                 |
| M8        | Polish, performance pass, hosting                        | M    | all                                                              |

Parallel track **Spike V** (after M1): a throwaway Three.js scene with chunked hex terrain and 5,000 instanced props, to check the Civ6-inspired look against the budget before M6. Run `visual-director` and `ecs-performance-reviewer` on it.

## M0: Project setup (S)

- [ ] Vite + TypeScript (strict), ESLint, Prettier, Vitest, dependency-cruiser, Three.js, bitecs.
- [ ] Folder layout per `ARCHITECTURE.md` section 2.
- [ ] Boundary rule: CI fails if `src/sim` imports `render`, `ui`, `three`, or DOM globals.
- [ ] Worker scaffold: worker starts, receives a message, posts a snapshot back.
- [ ] Dev overlay behind `?debug`: fps, frame ms, worker tick ms.
- [ ] CI: typecheck, lint, boundary check, test, build.

**Acceptance:** `npm run build` and `npm test` pass; a deliberate bad import in `src/sim` fails the boundary check.

## M1: Simulation skeleton (M)

- [ ] Fixed-step tick loop in the worker with speeds 0, 1x, 2x, 4x and a game clock.
- [ ] Seeded PRNG in `src/sim/rng.ts`; per-entity RNG state; state hash.
- [ ] Component stores for all entities in the design.
- [ ] JSON content and schemas: hulls, speed settings, terrain tables.
- [ ] Seeded galaxy generator: systems, planets, habitability, hazard, native presence.
- [ ] Seeded region map generator: 7 to 19 regions per planet.
- [ ] Command pipeline: typed commands, validation, accept or reject with reason, command log.
- [ ] Homeworld as colony 0 with population, stockpiles and homeworld clock.
- [ ] Placeholder galaxy view: `InstancedMesh` dots, select, pan and zoom.

**Acceptance:**

- Two runs with the same seed and no commands produce the same state hash after 5,000 days (Vitest; the homeworld clock is 8,000 days since M7c).
- Galaxy view holds 60 fps with about 60 systems.
- Empty tick takes under 0.5 ms.

## M2: Mission Command (M)

- [x] `LoadoutMath` pure functions (ETA, range, supply margin, founding odds band) with unit tests.
- [x] Hull classes: Scout, Ark, Heavy Ark, with cargo cap enforcement.
- [x] Mission Command UI (DOM, basic): destination card, six dial sliders, speed selector, live derived numbers, red warning under 100% supply margin, Launch.
- [x] `LaunchShip` command: spawns the ship, deducts passengers and Production from the launching colony.
- [x] Ship appears on the galaxy view.

**Acceptance:** derived numbers match design formulas under test; the cargo cap cannot be exceeded; any dial change updates the preview in the same frame; no screen has more than 6 dials.

## M3: Ships in Transit (L)

- [x] `TravelSystem`: movement along the route, fuel burn.
- [x] `SupplySystem`: 1 supply per colonist per day; attrition when empty.
- [x] Event framework: JSON cards, `EventRollSystem`, `PendingEventCard`, auto-pause, basic card UI. (Sim side in part A; card UI in part B: `src/ui/eventCardModel.ts`, `eventCardPanel.ts`. Needs an eye check in a browser.)
- [x] The six starter events from the design.
- [x] `SurveySystem`: survey improves on approach.
- [x] Rerouting: range ring, new ETA and margin preview, fuel penalty, unload at own colony. (Command and math in part A; range ring in `src/render/galaxyView.ts` and the preview panel in `src/ui/reroutePanel.ts` in part B. Needs an eye check in a browser.)
- [x] Transit view: instanced ship markers, route lines, trails, ship list with margins, speed controls. (Part B; the drawing itself needs an eye check in a browser.)
- [x] Ship states and Lost conditions.

**Acceptance:**

- Scripted tests: out of supplies kills colonists daily; out of fuel drifts and the ship is Lost; reroute cost matches the formula.
- 200 ships stay within the 2 ms worker budget. (Part A: tested, about 0.2 ms per day.)
- Each event card shows the cost of every choice before commit.

## M4: Planetfall (L), the loop closes

- [x] (M4b, UI) Planet view loads on demand; orbit camera; hex region map with fog.
- [x] (M4b, UI) Expedition formation UI: explorers, supplies, kit, stance.
- [x] Exploration rounds (about 10 days), exploration roll, terrain tables, hazards, mystery cards on the event framework, split teams. (M4a: simulation and snapshot done, tests in `planetfall.test.ts`.)
- [x] Natives: disposition, contact event, ambush rolls, Security effect. (M4a: simulation done.)
- [x] Founding roll with factor breakdown, three outcome tiers, re-embark. (M4a: simulation and snapshot done.)

**Acceptance:** a full launch-to-colony path is playable; every roll shows its factors; seed plus command log replays identically; no mechanic requires controlling individual units.

## M5: Colony, win and lose, save and load (M)

- [x] `ColonyEconomySystem`: one district per explored region, daily production, population growth.
- [x] Spaceport: build and launch ships from any colony with one.
- [x] Colony stances vs natives (Coexist, Defend, Push out) and raids.
- [x] Research: about 10 techs wired into formulas.
- [x] `WinLoseSystem`: homeworld collapse, all colonists dead, score, end screen, restart.
- [x] Save and load to IndexedDB: world, command log and seed.
- [ ] Playwright smoke test: start, launch, save, reload, resume.

**Acceptance:** a scripted bot completes a headless run; both lose conditions are tested; save, load and 500 days matches an uninterrupted run's hash.

## M6: Visual pass (L)

- [ ] Interpolation for all moving objects.
- [ ] Civ6-inspired hex terrain, district models, instanced props, native settlements and crowds, DataTexture fog.
- [x] Zoom pipeline: galaxy, system, orbit, colony, with LOD and camera transitions (M6c, D-123 to D-126).
- [ ] Lighting, optional tilt-shift and colour grading at colony zoom.
- [ ] Ship models, trails, event effects.
- [ ] One cohesive UI theme.

**Acceptance:** 60 fps target and 30 fps floor in the worst-case colony view (about 5,000 props, full fog) on a mid-range laptop; `visual-director` signs off each zoom level; no sim code changed for art reasons.

## M7: Content, balance, tutorial (M)

- [ ] Events to about 30: roughly 12 transit, 12 planetfall, 6 native contact.
- [ ] Terrain find tables and native variants.
- [ ] Headless balance harness in Node with archetype bots (see `BALANCE.md`).
- [ ] Tuning pass against target bands.
- [ ] Tutorial: guided first launch and tooltips.

**Acceptance:** each archetype is viable on at least one planet type; none dominates; run length lands in 90 to 150 minutes.

## M8: Polish and hosting (M)

- [ ] Audio (Web Audio), settings, accessibility basics (keyboard navigation, text scaling, colour-blind-safe status colours).
- [ ] Performance pass on the mid-range laptop target.
- [ ] Production build hosted as a static site; error logging.
- [ ] Optional save export to a file.
- [ ] Playtest rounds and fixes.

**Acceptance:** all subagent reviews clean; frame budgets hold on the target laptop.

## Risks

| Risk                                               | Mitigation                                                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Browser math differs and breaks determinism        | Fixed-point or lookup tables for anything that feeds rolls; hash test in CI across two browsers |
| Look blows the frame budget in the browser         | Spike V early; chunked meshes and instancing; sub-hex decoration is visual-only                 |
| Worker and main-thread sync adds latency           | Snapshot in typed arrays; interpolation hides tick granularity                                  |
| Scope creep breaks the "never overly complex" rule | `design-guardian` on every gameplay change; complexity budget in the design                     |
| Balance is hard with many dials                    | Headless Node harness from M7 (stubbed earlier); archetype bots                                 |
| Background tabs stall the simulation               | Auto-pause when hidden (D-022)                                                                  |
