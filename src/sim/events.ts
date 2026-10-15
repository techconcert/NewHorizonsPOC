import type { EventRejectReason, ResolveEventChoiceCommand } from '../shared/commands';
import {
  CC_COLONISTS,
  CC_DELAY,
  CC_FUEL,
  CC_HULL,
  CC_NATIVE_MOOD,
  CC_REVEAL,
  CC_RISK_COLONISTS,
  CC_RISK_DELAY,
  CC_RISK_FUEL,
  CC_RISK_HULL,
  CC_RISK_MOOD,
  CC_RISK_ODDS,
  CC_RISK_SUPPLIES,
  CC_SPEED_DROP,
  CC_SUPPLIES,
  CHOICE_COST_STRIDE,
  choiceCost,
  EVENT_CARD_COUNT,
  EVENT_CHOICE_COUNT,
  EVENT_COOLDOWN,
  EVENT_IS_TRANSIT,
  EVENT_SCENE,
  EVENT_TRIGGER_NATIVE,
  EVENT_TRIGGER_TERRAIN,
  EVENT_TRIGGER_VARIANT,
  EVENT_WEIGHT,
  expeditionChoiceCost,
  SCENE_NATIVE_CONTACT,
  SCENE_TRANSIT,
} from '../shared/events';
import { ExpeditionStatus } from '../shared/planetfall';
import { eventChancePermille } from '../shared/loadout';
import { TE, techBonus } from '../shared/research';
import {
  G_ENTITY,
  G_PLANET,
  LostReason,
  MAX_EVENT_DEFS,
  MAX_PENDING_EVENTS,
  RNG_ENTITY_BASE,
  ShipStateId,
  Survey,
} from './components';
import {
  effectiveDisposition,
  exploreFree,
  firstFrontier,
  inNativeHome,
  shiftNativeMood,
} from './planet';
import { nextInt } from './rng';
import { loseShip, shipXFp, shipYFp } from './ships';
import { raiseSurvey } from './survey';
import type { World } from './world';

/** Pending cards in the store (they are packed: slots 0 .. count - 1, oldest first). */
export function pendingCount(w: World): number {
  const card = w.stores.pendingEventCard.card;
  let n = 0;
  while (n < MAX_PENDING_EVENTS && card[n] >= 0) n++;
  return n;
}

/** Pause the game for a card, remembering the speed to return to (D-055). */
function autoPause(w: World): void {
  const run = w.stores.run;
  if (run.speed[0] !== 0) {
    run.resumeSpeed[0] = run.speed[0];
    run.speed[0] = 0;
  }
}

/**
 * SetGameSpeed while cards are pending: the game stays paused, and the requested speed (or 0 to
 * stay paused) becomes the speed it returns to when the last card is resolved. Otherwise a plain
 * speed change.
 */
export function applySpeedCommand(w: World, speed: number): void {
  const run = w.stores.run;
  if (pendingCount(w) > 0) run.resumeSpeed[0] = speed;
  else run.speed[0] = speed;
}

/**
 * EventRollSystem (step 5). Each ship in transit rolls once a day with its own RNG stream:
 * chance = route hazard x speed factor / hull rating (LoadoutMath.eventChancePermille, faster
 * means fewer events per trip). A hit picks an eligible card by weight (transit cards, cooldown
 * per ship and card), queues it in the PendingEventCard store, freezes the ship in state Event
 * and pauses the game. When 8 cards are already waiting the roll is skipped. D-055.
 */
export function eventRollSystem(w: World): void {
  const s = w.stores;
  const n = s.counts[G_ENTITY];
  const hullBonus = techBonus(s.research.mask[0], TE.HullRating);
  const state = s.shipState.state;
  const day = s.run.day[0];
  const last = s.eventHistory.lastDay;
  let queued = pendingCount(w);
  for (let e = 0; e < n; e++) {
    if (state[e] !== ShipStateId.InTransit) continue;
    const hazard = s.system.hazard[s.planet.system[s.shipRoute.destPlanet[e]]];
    const chance = eventChancePermille(hazard, s.ship.hull[e], s.ship.speedSetting[e], hullBonus);
    if (chance <= 0) continue;
    const slot = RNG_ENTITY_BASE + e;
    if (nextInt(s.rng, slot, 0, 999) >= chance) continue;
    if (queued >= MAX_PENDING_EVENTS) continue;
    const base = e * MAX_EVENT_DEFS;
    let total = 0;
    for (let c = 0; c < EVENT_CARD_COUNT; c++) {
      if (isEligible(last[base + c], day, c)) total += EVENT_WEIGHT[c];
    }
    if (total === 0) continue;
    let r = nextInt(s.rng, slot, 0, total - 1);
    let pick = -1;
    for (let c = 0; c < EVENT_CARD_COUNT; c++) {
      if (!isEligible(last[base + c], day, c)) continue;
      if (r < EVENT_WEIGHT[c]) {
        pick = c;
        break;
      }
      r -= EVENT_WEIGHT[c];
    }
    queueEventCard(w, e, pick, queued);
    queued++;
  }
}

/**
 * Put card `card` about ship `e` into pending slot `slot` (the first free one): the ship freezes
 * in state Event, the card's cooldown starts, and the game pauses. Also the entry point tests use
 * to stage a particular card.
 */
export function queueEventCard(w: World, e: number, card: number, slot: number): void {
  const s = w.stores;
  const day = s.run.day[0];
  s.pendingEventCard.card[slot] = card;
  s.pendingEventCard.subject[slot] = e;
  s.pendingEventCard.day[slot] = day;
  s.eventHistory.lastDay[e * MAX_EVENT_DEFS + card] = day;
  s.shipState.state[e] = ShipStateId.Event;
  autoPause(w);
}

function isEligible(lastDay: number, day: number, card: number): boolean {
  if (EVENT_IS_TRANSIT[card] === 0) return false;
  return lastDay < 0 || day - lastDay >= EVENT_COOLDOWN[card];
}

/** Check a ResolveEventChoice command: a card about that ship waits in that slot and the choice exists. */
export function checkResolve(w: World, cmd: ResolveEventChoiceCommand): EventRejectReason | null {
  const slot = cmd.card;
  if (slot < 0 || slot >= MAX_PENDING_EVENTS) return 'NO_PENDING_EVENT';
  const card = w.stores.pendingEventCard.card[slot];
  if (card < 0) return 'NO_PENDING_EVENT';
  if (w.stores.pendingEventCard.subject[slot] !== cmd.ship) return 'NO_PENDING_EVENT';
  if (cmd.choice < 0 || cmd.choice >= EVENT_CHOICE_COUNT[card]) return 'INVALID_CHOICE';
  return null;
}

const cost = new Int32Array(CHOICE_COST_STRIDE);

/**
 * Apply the chosen outcome. The numbers come from the same `choiceCost` the UI shows before the
 * player commits; a risk is rolled with the ship's RNG against its visible odds. Resources never
 * go below 0; hull 0 or less destroys the ship, no colonists left loses it (AllDead). The card is
 * cleared, later cards shift up, and when the last one is gone the game returns to its speed.
 */
export function applyResolve(w: World, cmd: ResolveEventChoiceCommand): void {
  if (checkResolve(w, cmd) !== null) return;
  const s = w.stores;
  const pend = s.pendingEventCard;
  const slot = cmd.card;
  const card = pend.card[slot];
  const e = pend.subject[slot];
  if (EVENT_SCENE[card] !== SCENE_TRANSIT) {
    applyExpeditionResolve(w, cmd);
    return;
  }
  const man = s.shipManifest;

  choiceCost(
    card,
    cmd.choice,
    man.colonists[e],
    man.supplies[e],
    man.fuel[e],
    s.ship.hull[e],
    s.ship.speedSetting[e],
    cost,
    0,
  );
  man.colonists[e] = Math.max(0, man.colonists[e] + cost[CC_COLONISTS]);
  man.supplies[e] = Math.max(0, man.supplies[e] + cost[CC_SUPPLIES]);
  man.fuel[e] = Math.max(0, man.fuel[e] + cost[CC_FUEL]);
  s.ship.integrity[e] = s.ship.integrity[e] + cost[CC_HULL];
  s.shipRoute.delay[e] = s.shipRoute.delay[e] + cost[CC_DELAY];
  s.ship.speedSetting[e] = s.ship.speedSetting[e] - cost[CC_SPEED_DROP];
  if (cost[CC_REVEAL] > 0) revealNearbyPlanet(w, e);

  let hit = 0;
  const odds = cost[CC_RISK_ODDS];
  if (odds > 0 && nextInt(s.rng, RNG_ENTITY_BASE + e, 0, 99) < odds) {
    hit = 1;
    man.colonists[e] = Math.max(0, man.colonists[e] + cost[CC_RISK_COLONISTS]);
    man.supplies[e] = Math.max(0, man.supplies[e] + cost[CC_RISK_SUPPLIES]);
    man.fuel[e] = Math.max(0, man.fuel[e] + cost[CC_RISK_FUEL]);
    s.ship.integrity[e] = s.ship.integrity[e] + cost[CC_RISK_HULL];
    s.shipRoute.delay[e] = s.shipRoute.delay[e] + cost[CC_RISK_DELAY];
  }

  // An emptied tank has no half-burned unit left.
  if (man.fuel[e] <= 0) s.shipRoute.fuelFrac[e] = 0;

  const le = s.run.lastEvent;
  le[0] = le[0] + 1;
  le[1] = e;
  le[2] = card;
  le[3] = cmd.choice;
  le[4] = hit;

  clearPendingSlot(w, slot);

  if (s.ship.integrity[e] <= 0) loseShip(w, e, LostReason.Destroyed);
  else if (man.colonists[e] <= 0) loseShip(w, e, LostReason.AllDead);
  else s.shipState.state[e] = ShipStateId.InTransit;

  resumeIfClear(w);
}

/** Clear a pending slot and shift the later cards up, so slot 0 is always the oldest. */
function clearPendingSlot(w: World, slot: number): void {
  const pend = w.stores.pendingEventCard;
  for (let i = slot; i < MAX_PENDING_EVENTS - 1; i++) {
    pend.card[i] = pend.card[i + 1];
    pend.subject[i] = pend.subject[i + 1];
    pend.day[i] = pend.day[i + 1];
  }
  const tail = MAX_PENDING_EVENTS - 1;
  pend.card[tail] = -1;
  pend.subject[tail] = 0;
  pend.day[tail] = 0;
}

/** When the last card is gone the game returns to the speed it had (D-055). */
function resumeIfClear(w: World): void {
  const s = w.stores;
  if (s.pendingEventCard.card[0] < 0 && s.run.resumeSpeed[0] !== 0) {
    s.run.speed[0] = s.run.resumeSpeed[0];
    s.run.resumeSpeed[0] = 0;
  }
}

/** True when another card about entity `e` is still waiting. */
function hasPendingFor(w: World, e: number): boolean {
  const pend = w.stores.pendingEventCard;
  for (let i = 0; i < MAX_PENDING_EVENTS; i++) {
    if (pend.card[i] >= 0 && pend.subject[i] === e) return true;
  }
  return false;
}

// ---- Planetfall cards (M4) ---------------------------------------------------------------------

/**
 * Pick an eligible planetfall card of `scene` for expedition `e` by weight (one draw from its own
 * RNG stream), or -1 when none is eligible. A card fits when its terrain trigger matches (or it
 * has none), its native trigger matches `disp` (contact cards) and its cooldown is over.
 */
export function pickExpeditionCard(
  w: World,
  e: number,
  scene: number,
  terrain: number,
  disp: number,
): number {
  const s = w.stores;
  const day = s.run.day[0];
  const base = e * MAX_EVENT_DEFS;
  const variant = s.native.variant[s.expedition.planet[e]];
  let total = 0;
  for (let c = 0; c < EVENT_CARD_COUNT; c++) {
    if (fitsExpedition(c, scene, terrain, disp, variant, s.eventHistory.lastDay[base + c], day))
      total += EVENT_WEIGHT[c];
  }
  if (total === 0) return -1;
  let r = nextInt(s.rng, RNG_ENTITY_BASE + e, 0, total - 1);
  for (let c = 0; c < EVENT_CARD_COUNT; c++) {
    if (!fitsExpedition(c, scene, terrain, disp, variant, s.eventHistory.lastDay[base + c], day))
      continue;
    if (r < EVENT_WEIGHT[c]) return c;
    r -= EVENT_WEIGHT[c];
  }
  return -1;
}

function fitsExpedition(
  card: number,
  scene: number,
  terrain: number,
  disp: number,
  variant: number,
  lastDay: number,
  day: number,
): boolean {
  if (EVENT_SCENE[card] !== scene) return false;
  const t = EVENT_TRIGGER_TERRAIN[card];
  if (t >= 0 && t !== terrain) return false;
  const n = EVENT_TRIGGER_NATIVE[card];
  if (n !== 0 && n !== disp) return false;
  const v = EVENT_TRIGGER_VARIANT[card];
  if (v !== 0 && v !== variant) return false;
  return lastDay < 0 || day - lastDay >= EVENT_COOLDOWN[card];
}

/**
 * Queue planetfall card `card` about expedition `e`: the expedition stands still (status Event),
 * the cooldown starts and the game pauses (D-055). Returns false (and does nothing) when 8 cards
 * are already waiting.
 */
export function queueExpeditionCard(w: World, e: number, card: number): boolean {
  const s = w.stores;
  const slot = pendingCount(w);
  if (slot >= MAX_PENDING_EVENTS) return false;
  const day = s.run.day[0];
  s.pendingEventCard.card[slot] = card;
  s.pendingEventCard.subject[slot] = e;
  s.pendingEventCard.day[slot] = day;
  s.eventHistory.lastDay[e * MAX_EVENT_DEFS + card] = day;
  if (s.expedition.status[e] === ExpeditionStatus.Active) {
    s.expedition.status[e] = ExpeditionStatus.Event;
  }
  autoPause(w);
  return true;
}

/**
 * Apply a planetfall card choice: explorers take the colonist delta, the expedition's supplies
 * the supply delta, a delay stands the team still (supplies still burn), a reveal explores the
 * lowest visible region, a mood change moves the planet's natives, and the risk is rolled with
 * the expedition's RNG against its visible odds (tilted by the escort). D-069.
 */
function applyExpeditionResolve(w: World, cmd: ResolveEventChoiceCommand): void {
  const s = w.stores;
  const pend = s.pendingEventCard;
  const slot = cmd.card;
  const card = pend.card[slot];
  const e = pend.subject[slot];
  const team = s.expeditionTeam;
  const exp = s.expedition;
  const planet = exp.planet[e];

  expeditionChoiceCost(
    card,
    cmd.choice,
    team.explorers[e],
    team.supplies[e],
    team.guards[e],
    cost,
    0,
  );
  team.explorers[e] = Math.max(0, team.explorers[e] + cost[CC_COLONISTS]);
  team.supplies[e] = Math.max(0, team.supplies[e] + cost[CC_SUPPLIES]);
  exp.delay[e] = exp.delay[e] + cost[CC_DELAY];
  if (cost[CC_REVEAL] > 0) {
    const r = firstFrontier(s, planet, -1);
    if (r >= 0) {
      exploreFree(w, e, planet, r);
      // A region revealed by a card can be the natives' home: the team meets them there.
      if (
        inNativeHome(s, planet, r) &&
        s.native.revealed[planet] === 0 &&
        team.explorers[e] + team.wounded[e] > 0
      ) {
        s.native.revealed[planet] = 1;
        const contactCard = pickExpeditionCard(
          w,
          e,
          SCENE_NATIVE_CONTACT,
          s.region.terrain[s.planet.regionStart[planet] + r],
          effectiveDisposition(s, planet),
        );
        if (contactCard >= 0) queueExpeditionCard(w, e, contactCard);
      }
    }
  }
  shiftNativeMood(s, planet, cost[CC_NATIVE_MOOD]);

  let hit = 0;
  const odds = cost[CC_RISK_ODDS];
  if (odds > 0 && nextInt(s.rng, RNG_ENTITY_BASE + e, 0, 99) < odds) {
    hit = 1;
    team.explorers[e] = Math.max(0, team.explorers[e] + cost[CC_RISK_COLONISTS]);
    team.supplies[e] = Math.max(0, team.supplies[e] + cost[CC_RISK_SUPPLIES]);
    exp.delay[e] = exp.delay[e] + cost[CC_RISK_DELAY];
    shiftNativeMood(s, planet, cost[CC_RISK_MOOD]);
  }

  const le = s.run.lastEvent;
  le[0] = le[0] + 1;
  le[1] = e;
  le[2] = card;
  le[3] = cmd.choice;
  le[4] = hit;

  clearPendingSlot(w, slot);
  if (team.explorers[e] + team.wounded[e] <= 0) {
    exp.status[e] = ExpeditionStatus.Dead;
    exp.target[e] = -1;
    exp.target2[e] = -1;
  } else if (exp.status[e] === ExpeditionStatus.Event && !hasPendingFor(w, e)) {
    exp.status[e] = ExpeditionStatus.Active;
  }
  resumeIfClear(w);
}

/**
 * "A new planet nearby": the closest planet (ties to the lowest index) whose survey is still
 * Unknown, other than the ship's destination, becomes Scanned. Nothing happens when none is left.
 */
function revealNearbyPlanet(w: World, e: number): void {
  const s = w.stores;
  const x = shipXFp(w, e);
  const y = shipYFp(w, e);
  const dest = s.shipRoute.destPlanet[e];
  const n = s.counts[G_PLANET];
  let best = -1;
  let bestD = Infinity;
  for (let p = 0; p < n; p++) {
    if (p === dest || s.planet.survey[p] !== Survey.Unknown) continue;
    const sys = s.planet.system[p];
    const dx = s.system.x[sys] - x;
    const dy = s.system.y[sys] - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (best >= 0) raiseSurvey(w, best, Survey.Scanned);
}
