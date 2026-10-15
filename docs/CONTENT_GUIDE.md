# Content guide

How to author events and data without breaking the design. All content is JSON in `src/data/`, validated against a schema at build time and loaded into the simulation worker at startup. The sim never fetches files directly.

## Event card schema

| Field             | Rule                                                                             |
| ----------------- | -------------------------------------------------------------------------------- |
| `id`              | Unique, snake_case                                                               |
| `scenes`          | One or more of: Transit, Exploration, NativeContact, Colony                      |
| `trigger`         | Conditions: terrain, ship state, native disposition, native variant (contact cards only; needs `native`), survey level, colony stance |
| `weight`          | Relative chance among eligible cards                                             |
| `cooldownDays`    | Minimum days before the card can repeat for the same entity                      |
| `title`, `body`   | See writing rules                                                                |
| `choices`         | 2 or 3 entries, never more                                                       |
| `choice.label`    | Short verb phrase ("Push through")                                               |
| `choice.preview`  | Required. States every cost and gain the player can know ("Hull -15%, no delay") |
| `choice.outcomes` | Resource deltas, hull damage, delay days, colonist loss, flags, follow-up event  |
| `choice.risk`     | Optional roll with visible odds; hidden odds are not allowed                     |

## Transit outcomes (M3)

`choice.outcomes` (and `choice.risk.outcomes`) may use only: `colonists`, `supplies`, `fuel` (each `{ "flat": n }` or `{ "pct": n }`, percent of what the ship holds), `hullPct` (points of a new hull), `delayDays` (the ship stands still), `detourDays` (the same, plus the fuel that distance would burn), `speedDrop` (levels), `revealPlanet` (1 scans the nearest unknown planet). A risk adds `oddsPct` (1 to 99, always shown) and a `label`, and may not use `detourDays`, `speedDrop` or `revealPlanet`. All cards live in `src/data/events.json`. The UI shows the numbers from `choiceCost` in `src/shared/events.ts`, so a preview text never needs to repeat exact amounts.

## Rules

- Every choice shows its cost before commit. No hidden math.
- Choices must be genuinely different trade-offs, not a good option and a bad option.
- One decision per card. No chains longer than two cards.
- Outcomes use only the four resources, hull integrity, delay, colonist count, and existing flags. A card that needs a new mechanic goes through `DECISIONS.md` first.
- Natives are never individually controlled: they appear as dispositions, rolls and stances.

## Writing rules

- Short, dry, tense: one or two sentences of setup, in the spirit of Oregon Trail.
- Concrete nouns over adjectives. No jokes at the colonists' expense.
- Body text under 40 words; labels under 5 words; previews under 20 words.
- No invented lore that implies mechanics the game doesn't have.

## Target counts

| Milestone | Cards                                                               |
| --------- | ------------------------------------------------------------------- |
| M3        | 6 transit (the starter set in the design)                           |
| M4        | 6 planetfall plus 3 native contact                                  |
| M7        | about 30 total: roughly 12 transit, 12 planetfall, 6 native contact (reached in M7a: 12 / 12 / 6) |

## Native variants

Six kinds of natives in `planetfall.json` (`natives.variants`): each has a starting disposition, a small strength change and a one-line flavour. A contact card may name one with `trigger.variant`; keep one card per disposition without a variant so a contact never finds nothing. Effects of a variant use existing mechanics only (strength, cards).

## Terrain find tables

Each terrain has a table of finds, hazards and mystery-card hooks, as data, its own flavour line and a mystery share of at least 5. Keep entries to the six terrains in the design. Odds sum to 100 per terrain and are tuned in `BALANCE.md`.

## Review

Run `content-writer` to draft and check cards, then `design-guardian` for complexity and trade-off clarity.
