/**
 * One-sentence tooltips (M7c, pure data). Mission Command dials and HUD stats show these as a
 * `title` and reference them with `aria-describedby`, so a new player can learn what a number or a
 * slider does without leaving the game. Each text is exactly one sentence.
 */

/** Keyed by the shared loadout dial ids (passengers, supplies, fuel, speed, kit, security). */
export const DIAL_HELP: Readonly<Record<string, string>> = {
  passengers:
    'Colonists aboard: they become the explorers and the first settlers, but each one eats supplies every day.',
  supplies:
    'Food and medicine for the trip and the landing; keep the margin above 130% if you can.',
  fuel: 'Range for the trip and for changing course later; it is the only way to change your mind.',
  speed:
    'Economy, Cruise or Hard Burn: faster arrives sooner with fewer events but burns far more fuel.',
  kit: 'Survey drones and rovers that improve exploration and founding odds on the ground.',
  security:
    'Armed escort that protects the landing from hostile natives but can unsettle peaceful ones.',
};

/** The hull choice above the dials. */
export const HULL_HELP =
  'The hull sets how much cargo the ship can carry; every dial draws from that same space.';

/** The supply margin line in Mission Command. */
export const MARGIN_HELP =
  'Supplies divided by what the passengers eat on the trip: red LOW is under 100%, amber OK under 130%, green SAFE above.';

/** HUD stats, keyed by their short ids. */
export const HUD_HELP: Readonly<Record<string, string>> = {
  day: 'Game days since departure; one day passes about every second at 1x.',
  clock: 'Days left before the homeworld collapses and the run is lost.',
  colonies: 'Colonies founded off the homeworld and the people living in them.',
  research: 'The technology being researched now and how far along it is.',
  goal: 'The win condition: hold the required colonies at the required population for the required days in a row.',
};

/** All ids that must have a dial tooltip (the shared dial list). */
export const DIAL_IDS: readonly string[] = [
  'passengers',
  'supplies',
  'fuel',
  'speed',
  'kit',
  'security',
];

/** True when `text` is a single sentence: one terminal full stop and no other sentence break. */
export function isOneSentence(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || !t.endsWith('.')) return false;
  return !/[.!?]\s+[A-Z]/.test(t) && t.indexOf('.') === t.length - 1;
}
