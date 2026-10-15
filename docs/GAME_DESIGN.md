# Colony Ship: game design (source of truth)

Version 0.3 · 2026-10-09 (web stack). Derived from the claude.ai doc "Colony Ship: Core Systems Design"; this file is the canonical copy in the repo. Items marked **(proposed)** are gap-fills awaiting confirmation; the rest are decided (see `DECISIONS.md`).

## 1. Vision and pillars

Every launch is an Oregon Trail gamble in space: pack the ship, watch it cross the dark, then roll the dice at planetfall. The player is a mission director, not a unit commander.

- Few decisions, each one heavy. At most 6 dials per launch and 2 to 3 choices per event.
- Macro only. The player sets policy; the simulation does the rest.
- Show the odds. Every decision previews ETA, supply margin and founding chance before commit.
- Beautiful at every zoom: galaxy, system, planet orbit, Civ6-inspired hex colony.
- 60 fps target, 30 fps floor. Simulation runs as an ECS in a Web Worker; visuals read from it and never drive it.

Run length: about 90 to 150 minutes, real time with pause.

## 2. Core loop

```
Mission Command --launch--> Ships in Transit --arrive--> Planetfall --found--> Colony
      ^                       |  reroute (loop)            |  re-embark (back to Transit)
      +-----------------------+----------------------------+--- new ships and colonists
```

Views: Mission Command and Transit share one Galaxy view with two UI modes. Planetfall and the colony view live in a Planet view that loads on demand. The homeworld is colony 0.

## 3. Data model

### Resources

| Resource   | What it does                                       | Spent by                                       | Produced by                |
| ---------- | -------------------------------------------------- | ---------------------------------------------- | -------------------------- |
| Colonists  | Become explorers, then colony population           | Launches, transit attrition, expedition losses | Colony growth              |
| Supplies   | Food, water, medicine; 1 unit per colonist per day | Every colonist, every day                      | Farm and Habitat districts |
| Fuel       | Range, speed, rerouting                            | Travel burn, course changes                    | Refinery districts         |
| Production | Builds ships, kit, districts                       | Hulls, equipment, buildings                    | Mine districts             |

Running out is the drama: no supplies means colonists die each day; no fuel means the ship drifts and is lost.

### Entities

| Entity            | Key fields                                                                                                   | Notes                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Star system       | Position, star type, planet list, route hazard                                                               | Galaxy-map node                              |
| Planet            | Habitability 0 to 100, hazard, richness, region map, survey level, owner, natives                            | Values shown as ranges until surveyed        |
| Native population | Disposition (peaceful, wary, hostile), strength, home regions                                                | Bound to one planet; never travels or allies |
| Ship              | Hull class, manifest (colonists, supplies, fuel, kit, security), hull integrity, speed setting, route, state | One entity per ship                          |
| Expedition        | Explorers, guards, supplies, kit, stance, current region                                                     | Spawned from a ship in orbit                 |
| Colony            | Population, worked regions, districts, stockpiles, native stance, spaceport flag                             | Homeworld is colony 0                        |

### Survey levels

**Unknown, Scanned** (rough type, habitability as a wide range), **Surveyed** (tight ranges, region count, signs of native life), **Explored** (regions revealed by an expedition). Ships improve the survey as they approach, which is the main reason to reroute.

### Galaxy size (proposed)

About 30 to 60 star systems with 1 to 5 planets each. Tune during M7.

## 4. System 1: Mission Command

The player picks a destination, then splits a fixed cargo capacity across six dials. ETA, supply margin and founding odds update live until Launch. Core tension: more people need more supplies, more speed needs more fuel, and everything costs cargo space.

| Dial                                 | Raises                                   | Costs                                         | Strategic tension                                   |
| ------------------------------------ | ---------------------------------------- | --------------------------------------------- | --------------------------------------------------- |
| Passengers                           | Explorers and starting colony size       | Cargo, supplies per day                       | More hands vs more mouths to feed                   |
| Supplies                             | Days of food and medicine                | Cargo                                         | Buffer for delays and a failed first site           |
| Fuel                                 | Range and reroute budget                 | Cargo                                         | Fuel is the only way to change your mind            |
| Speed (Economy / Cruise / Hard Burn) | Shorter ETA, fewer drain days and events | Fuel burn x1 / x1.5 / x2.5                    | Racing the clock vs running dry                     |
| Survey kit                           | Drones, rovers, landers                  | Cargo, Production                             | Better data and exploration rolls                   |
| Security                             | Armed escort among passengers            | Cargo, Production; unsettles peaceful natives | Survive hostile natives vs antagonize friendly ones |

Hull shielding is not a dial: hull class (Scout, Ark, Heavy Ark; improved by research) sets cargo capacity, base speed and hull rating.

### Loadout archetypes

| Archetype     | Loadout                                        | Best for                                |
| ------------- | ---------------------------------------------- | --------------------------------------- |
| Scout         | Few passengers, high fuel, Hard Burn, high kit | Surveying far planets fast and cheaply  |
| Ark           | Max passengers and supplies, Economy speed     | A big colony on a known safe planet     |
| Armed landing | Medium passengers, high security, some kit     | Rich planets with hostile natives       |
| Gambler       | Hard Burn, thin supplies, no kit               | Racing the clock to an unscanned target |

### Derived numbers shown to the player

- ETA = distance / speed setting.
- Range = fuel / burn rate (shown as a ring on the galaxy map).
- Supply margin = supplies / (passengers x ETA). Below 100% is a red warning; about 130% leaves room for delays.
- Founding odds = a band such as 35 to 60%, narrowing as survey data improves.

### Rules

- Ships are built from Production at a colony with a spaceport.
- Passengers come from the launching colony's population.
- Unscanned targets are allowed: cheap and risky.

## 5. System 2: Ships in Transit

Ships fly in real time (pause and 1x/2x/4x) across the galaxy map. Each day they burn supplies, may hit an event, and can be rerouted to any planet inside fuel range.

### Daily tick per ship

1. Move along the route at the speed setting; burn fuel.
2. Consume supplies (1 per colonist). If supplies are gone, lose a share of colonists that day.
3. Roll for an event. Chance = route hazard x speed factor / hull rating.
4. Improve the destination's survey as distance shrinks.

### Events

Cards with 2 to 3 choices and visible trade-offs, shared with planetfall. Starter set:

| Event               | Choice A                         | Choice B                         |
| ------------------- | -------------------------------- | -------------------------------- |
| Micrometeor storm   | Push through: hull damage        | Detour: +4 days, more fuel       |
| Illness outbreak    | Use medical supplies             | Quarantine: lose a few colonists |
| Engine fault        | Repair: lose 5 days              | Limp on: speed drops one level   |
| Derelict ship found | Salvage: gain fuel, risk a trap  | Ignore                           |
| Stowaways           | Take them: +colonists, -supplies | Leave at nearest colony          |
| Strange signal      | Reveal a new planet nearby       | Stay on course                   |

### Rerouting

- Selecting a ship lights up every target inside remaining fuel range, with new ETA and supply margin.
- A course change costs a fixed fuel penalty plus the new distance, so late reroutes are expensive.
- Rerouting to your own colony unloads passengers and cargo; the ship can refuel and relaunch from there.

### Ship states

Building, Launching, Cruising, Event (returns to Cruising), Arriving, In orbit, or Lost (out of fuel, hull destroyed, or no one left alive).

## 6. System 3: Planetfall and exploration

In orbit, the player sends down an expedition, reveals the planet's hex region map over rounds of dice-driven exploration, and ends with one call: found a colony, or re-embark and leave. The ship stays in orbit as a supply depot until that call.

### Flow

1. **Arrive in orbit.** Region map appears: 7 to 19 hex regions, all fogged except the landing zone.
2. **Form the expedition.** Choose explorers, supplies and kit to send down, and a stance: Cautious, Balanced or Bold.
3. **Explore in rounds** (about 10 game days each). Pick a region next to explored land and roll on that terrain's table: a find, a hazard, or a mystery card.
4. **Decide each round:** push on, pull back, or call it.
5. **Found or leave.** Pick a site among explored regions and roll founding, or re-embark and reroute if fuel allows.

### Exploration roll

Success chance = terrain base x team size bonus x kit bonus x stance modifier. Bold explores two regions per round but doubles hazard odds; Cautious is the reverse. Splitting into two teams is allowed: faster, riskier.

| Terrain   | Hazard   | Typical finds         |
| --------- | -------- | --------------------- |
| Plains    | Low      | Farmland, water       |
| Highlands | Medium   | Ore, defensible sites |
| Jungle    | High     | Rich food, disease    |
| Ice       | Medium   | Water, fuel ice       |
| Crater    | High     | Rare minerals         |
| Ruins     | Variable | Tech, mystery events  |

### Founding roll

Founding chance = planet habitability x site quality x supplies landed x kit. The screen shows each factor's share so a bad roll never feels unfair. Results:

- **Thriving:** full colony, bonus growth.
- **Struggling:** colony with a temporary penalty the player must supply from elsewhere.
- **Failed:** survivors re-embark if the ship can still lift them, or become a small outpost.

Every region the expedition revealed becomes the colony's starting map.

## 7. Natives

Some planets host natives who never leave their planet and never ally with anyone. Their disposition stays hidden until an expedition makes contact.

| Disposition | On contact                                             | In the colony                             |
| ----------- | ------------------------------------------------------ | ----------------------------------------- |
| Peaceful    | Guides: better exploration odds, shared food           | Coexist: bonus yield on shared regions    |
| Wary        | Event card; outcome tilts on Security and your choices | Can drift toward peaceful or hostile      |
| Hostile     | Ambush rolls each round in their regions               | Periodic raids on districts and colonists |

- Survey only shows signs of life, so landing near natives is always a gamble.
- High Security cuts losses to hostile natives but raises the chance wary natives turn hostile.
- Colony stance is macro, never unit control: **Coexist**, **Defend** or **Push out** (claims their regions at a cost in colonists).

## 8. Supporting systems

- **Colony economy (Civ6-lite):** one district per explored region (Farm, Mine, Refinery, Habitat, Research, Spaceport). Each produces one resource per day, scaled by population and terrain. A Spaceport lets the colony build and launch ships. No unit micro: the player picks the next district; population works the land automatically.
- **Research:** about 10 techs in three short branches: Propulsion (hull classes, faster burns), Life Support (lower supply use, better founding odds), Exploration (kit types, survey range).
- **Event framework:** one data-driven card system for transit, exploration, natives and colony life. Each card has a trigger, weight, 2 to 3 choices, and outcomes as resource deltas or flags.
- **Auto-pause (proposed):** the game pauses when an event card appears.

## 9. Win, lose, pacing

- **Pressure:** the homeworld collapses after a fixed number of days (8,000 days; D-136). This is the Oregon Trail clock.
- **Goal:** build a self-sustaining colony network before the clock runs out.
- **Win:** 10 colonies of 2600+ people held 90 days in a row (D-134, D-136); lose: homeworld clock (8000 days) reaches 0 or no colonists remain.
- **Lose:** the homeworld collapses first, or every colonist sent out has died.
- **Lose edge case (proposed):** "every colonist sent out has died" means no colonists remain in ships, expeditions or colonies and none can be launched from the homeworld.
- **Score:** colonists alive off-world at the end, so even a loss ranks how many were saved.
- **Pacing (starting numbers, tune by playtest):** 1 game day is about 1 second at 1x. Trips last 30 to 120 days. A run holds roughly 8 to 15 launches.

## 10. Complexity budget (proposed hard limits)

| Thing                  | Limit    |
| ---------------------- | -------- |
| Loadout dials          | 6        |
| Choices per event card | 3        |
| Resources              | 4        |
| Expedition stances     | 3        |
| Colony stances         | 3        |
| District types         | 6        |
| Native dispositions    | 3        |
| Techs                  | about 10 |

Rules: a new mechanic must replace or merge with an existing one. Every choice shows its cost before commit. No screen asks the player to manage individual units.

## 11. Out of scope for v1

Rival factions, native alliances or migration, unit control, tactical combat, trade, diplomacy, multiple homeworlds, multiplayer.
