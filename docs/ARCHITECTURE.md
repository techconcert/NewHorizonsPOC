# Colony Ship: technical architecture (web)

Stack: TypeScript (strict), Vite, Three.js (WebGL2), bitecs (ECS), a Web Worker for the simulation, IndexedDB for saves, Vitest, ESLint, Prettier and dependency-cruiser. Target: recent desktop Chrome, Edge, Firefox and Safari with WebGL2. Exact versions are pinned at project creation (D-014).

## 1. Principles

1. The worker owns all game state. The main thread renders and handles UI from snapshots.
2. Player clicks become typed commands, never direct state edits.
3. The simulation is deterministic: seed plus command log reproduces a run.
4. Mass rendering uses instancing. Few things (camera, labels, overlays) are separate objects.
5. Content is data, validated at build time.

## 2. Modules and boundaries

| Module       | Contains                                                   | May import                                                                   |
| ------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/sim`    | bitecs world, systems, formulas, generators, PRNG          | `src/shared`, `src/data` (types and values), bitecs                          |
| `src/worker` | worker entry, tick loop, message handling, snapshot writer | `src/sim`, `src/shared`                                                      |
| `src/shared` | command and snapshot type definitions, LoadoutMath         | `src/shared`, `src/data` only                                                |
| `src/data`   | JSON content and schemas                                   | nothing                                                                      |
| `src/render` | Three.js views, interpolation, LOD, camera                 | `src/shared`, `three` (not `src/data` directly)                              |
| `src/ui`     | DOM overlays, CommandBridge                                | `src/shared` (not `src/data` directly; tables reach it through `src/shared`) |
| `tests`      | Vitest suites                                              | everything                                                                   |

dependency-cruiser fails CI if `src/sim` imports `render`, `ui`, `three`, if `src/shared` imports anything but `src/shared` and `src/data`, if `src/render` or `src/ui` import `src/data`, or if `src/sim` touches DOM globals such as `window` or `document`.

## 3. Worker and tick

- The worker runs a fixed-step loop. Real time times speed accumulates into game days, and each whole day runs one tick. Speeds: 0 (pause), 1x (one day about one second), 2x, 4x.
- Ticks never run partially. Each tick ends with a snapshot posted to the main thread.
- Commands arrive as messages, are queued, and apply at the start of the next tick.
- Snapshots carry ship positions and states in typed arrays, sent as transferables (no copy). Both previous and current positions are sent so the renderer can interpolate.
- Background tabs throttle timers, so the game auto-pauses when hidden (D-022).

## 4. Determinism

- One seeded PRNG in `src/sim/rng.ts` (sfc32 or mulberry32, written in project code). Per-entity RNG state lives in a component, so a roll depends only on the seed and the entity, not on the order of unrelated systems.
- No `Math.random`, `Date.now`, `performance.now`, or timer ordering inside `src/sim`.
- `Math.sin`, `cos`, `exp`, `pow` and `log` may differ in the last bits between browsers. For anything that feeds a roll or the state hash, use precomputed lookup tables or integer and fixed-point math. Plain `+ - * /`, `Math.floor` and `Math.round` are safe.
- Iterate entities in ascending id order wherever order affects results. Sort explicitly; do not rely on insertion order.
- State hash: FNV-1a over the core component arrays after each tick. Vitest compares hashes at checkpoints.
- The command log replays in Vitest and is the basis for bug reports (seed plus log).

## 5. Commands

Typed union in `src/shared/commands.ts`: `LaunchShip`, `RerouteShip`, `FormExpedition`, `ExploreRegion`, `FoundColony`, `ReEmbark`, `SetColonyStance`, `BuildDistrict`, `StartResearch`, `SetGameSpeed`, `ResolveEventChoice`.

The worker validates each command against current state (cargo cap, fuel range) and replies with accept or reject. A rejection carries a reason the UI shows.

## 6. Component store

bitecs components stored as typed arrays (struct of arrays):

- Run: `GameClock`, `GameRng`, `HomeworldClock`, `RunOutcome`, `CommandLog`
- Galaxy: `StarSystem`, `Planet`, `PlanetSurvey`, `Region` (at most 19 per planet), `NativeGroup`
- Ships: `Ship`, `ShipManifest`, `ShipRoute`, `ShipState`, `HullRef` (index into the hull table)
- Expedition: `Expedition`, `ExpeditionTeam`, `ExpeditionStance`
- Colony: `Colony`, `Stockpile`, `District`, `ColonyStance`
- Events: `PendingEventCard`, `EventHistory` (for cooldowns)
- Render support: `PrevPosition`, `CurrPosition`

Content lookups use indices into immutable arrays built from `src/data`. Hot loops never follow object references.

## 7. System order per tick

1. `CommandSystem`
2. `ClockSystem` (homeworld countdown)
3. `TravelSystem`
4. `SupplySystem`
5. `EventRollSystem` (queues `PendingEventCard` and pauses the game)
6. `SurveySystem`
7. `ExpeditionSystem` (rounds advance about every 10 days)
8. `NativeSystem`
9. `ColonyEconomySystem`
10. `ResearchSystem`
11. `WinLoseSystem`
12. `CleanupSystem`

## 8. Content

JSON files in `src/data/` cover hulls, speed settings, terrain tables, events, techs and planet archetypes. Schemas (Zod or hand-written validators) run in `npm test` and at build. The worker receives compiled tables at startup. Content is never mutated at runtime.

## 9. Rendering link

- Views are Three.js scene graphs in `src/render`: galaxy, and planet (orbit and colony). One is active at a time. The planet view is created on demand.
- Interpolation: each frame, position = prev + (curr − prev) × α, where α is the time since the last snapshot divided by the tick duration, clamped to [0, 1]. One pass over a `Float32Array`.
- Mass objects: systems and ships are `InstancedMesh`. Routes are one `LineSegments` buffer, rewritten when routes change. Trails are short ring buffers per ship.
- Zoom: a `ZoomLevel` value (Galaxy, System, Orbit, Colony) controls which groups are visible and which LOD they use. Billboards and sprites far out, full meshes close in.
- Colony view: hex terrain as chunked `BufferGeometry` (about 16 × 16 hexes per chunk) with vertex colours. Props are `InstancedMesh` per prop type, at most about 50 meshes in total. Sub-hex decoration is generated in render code from the planet seed using a separate RNG, never the simulation RNG.
- Fog: one `DataTexture` with one texel per region (unknown, scanned, surveyed, explored), read by the terrain shader.
- Post-processing: `EffectComposer`. Tilt-shift and bloom are optional at colony zoom, and are the first effects cut if the budget breaks.
- UI: DOM overlays update from snapshots at about 10 Hz, never per frame, to avoid layout thrash.

## 10. Visual direction

Civ6-inspired, with original assets only, as in the design. Web specifics: glTF models compressed with meshopt or Draco; KTX2 textures where they help. No ripped Civ6 art, icons, fonts or branding.

Download budget (proposed): initial load of 8 MB or less compressed, playable within 5 s on broadband.

## 11. Views and persistence

One single-page app with three views (galaxy, planet orbit, colony). Saves go to IndexedDB: world arrays, command log, seed and tick. An optional export to a file is planned for M8.

## 12. Performance budget (60 fps = 16.6 ms per frame)

| Area                                         | Budget                    |
| -------------------------------------------- | ------------------------- |
| Main thread per frame (render submit and UI) | 4 ms or less              |
| GPU frame                                    | 10 ms or less             |
| Worker tick with 200 ships                   | 2 ms or less              |
| Draw calls in colony view                    | 300 or fewer              |
| Instanced props in colony view               | about 5,000               |
| Heap during play                             | 512 MB or less (proposed) |

Rules: no per-frame allocations in render code; reuse typed arrays; profile with the Chrome DevTools Performance panel, `renderer.info` and an in-game stats overlay. Test on a mid-range laptop (D-017).

## 13. Debug tooling

Behind a `?debug` query flag: overlay with fps, frame ms, worker tick ms, entity count and draw calls. Also seed display, speed override, force-event, force-roll, jump-to-planet, state-hash display, and replay from a command log.

## 14. Testing and CI

- Vitest in Node for everything in `src/sim` and `src/data`. No DOM needed.
- Determinism, replay, formula and scenario suites (see the `qa-determinism-tester` subagent).
- Playwright smoke tests from M5; screenshot checks at M6.
- CI on every push: typecheck, lint, dependency-cruiser boundary check, Vitest, production build.
