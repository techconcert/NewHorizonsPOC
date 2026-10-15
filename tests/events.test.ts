// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EVENTS, RAW_CONTENT } from '../src/data';
import {
  validateAllContent,
  validateEventCard,
  validateEventCardFull,
  validateEventDefs,
} from '../src/data/validate';
import type { Command } from '../src/shared/commands';
import {
  CC_COLONISTS,
  CC_DELAY,
  CC_FUEL,
  CC_HULL,
  CC_REVEAL,
  CC_RISK_COLONISTS,
  CC_RISK_HULL,
  CC_RISK_ODDS,
  CC_SPEED_DROP,
  CC_SUPPLIES,
  CHOICE_COST_STRIDE,
  EVENT_CARD_COUNT,
  EVENT_CHOICE_COUNT,
  EVENT_CHOICE_LABELS,
  EVENT_CHOICE_PREVIEWS,
  EVENT_IDS,
  EVENT_TITLES,
} from '../src/shared/events';
import { etaDays, eventChancePermille } from '../src/shared/loadout';
import {
  createSnapshot,
  META_PENDING_CARD,
  META_PENDING_COUNT,
  META_PENDING_SHIP,
  META_RESUME_SPEED,
} from '../src/shared/snapshot';
import {
  G_LOG,
  MAX_EVENT_DEFS,
  MAX_PENDING_EVENTS,
  LostReason,
  ShipStateId,
  Survey,
} from '../src/sim/components';
import { pendingCount } from '../src/sim/events';
import { hashState } from '../src/sim/hash';
import { advanceReal, applyCommandsNow, createAccumulator, tickDay } from '../src/sim/tick';
import { submit, type World } from '../src/sim/world';
import { createHandler } from '../src/worker/handler';
import { fillSnapshot } from '../src/worker/fill';
import {
  addShip,
  CARD,
  lineWorld,
  planetOf,
  resolveSlot,
  send,
  stage,
  ticks,
} from './helpers/transit';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const resolve = (w: World, choice: number, card = 0) => resolveSlot(w, choice, card);

describe('the six starter transit cards match the design table', () => {
  it('names and choices, exactly as GAME_DESIGN section 5 lists them', () => {
    // M4 appended 9 planetfall cards after the six transit cards, M7a 15 more (indices 0 to 14 are unchanged).
    expect(EVENT_CARD_COUNT).toBe(30);
    expect(EVENT_IDS.slice(0, 6)).toEqual([
      'micrometeor_storm',
      'illness_outbreak',
      'engine_fault',
      'derelict_ship',
      'stowaways',
      'strange_signal',
    ]);
    expect(EVENT_TITLES.slice(0, 6)).toEqual([
      'Micrometeor storm',
      'Illness outbreak',
      'Engine fault',
      'Derelict ship found',
      'Stowaways',
      'Strange signal',
    ]);
    const labels = (c: number) => [0, 1, 2].map((k) => EVENT_CHOICE_LABELS[c * 3 + k]);
    expect(labels(0)).toEqual(['Push through', 'Detour', '']);
    expect(labels(1)).toEqual(['Use medical supplies', 'Quarantine', '']);
    expect(labels(2)).toEqual(['Repair', 'Limp on', '']);
    expect(labels(3)).toEqual(['Salvage', 'Ignore', '']);
    expect(labels(4)).toEqual(['Take them', 'Leave at nearest colony', '']);
    expect(labels(5)).toEqual(['Investigate', 'Stay on course', '']);
  });

  it('every choice has a preview text, and no card has more than 3 choices', () => {
    for (let c = 0; c < EVENT_CARD_COUNT; c++) {
      expect(EVENT_CHOICE_COUNT[c]).toBeGreaterThanOrEqual(2);
      expect(EVENT_CHOICE_COUNT[c]).toBeLessThanOrEqual(3);
      for (let k = 0; k < EVENT_CHOICE_COUNT[c]; k++) {
        expect(EVENT_CHOICE_PREVIEWS[c * 3 + k].length).toBeGreaterThan(0);
      }
    }
  });
});

describe('preview text matches the outcomes (no numbers of its own)', () => {
  type Fx = {
    colonists?: unknown;
    supplies?: unknown;
    fuel?: unknown;
    hullPct?: number;
    delayDays?: number;
    detourDays?: number;
    speedDrop?: number;
    revealPlanet?: number;
  };
  const words: [keyof Fx, RegExp][] = [
    ['colonists', /colonist|explorer|nobody|people/i],
    ['supplies', /suppl/i],
    ['fuel', /fuel/i],
    ['hullPct', /hull/i],
    ['delayDays', /day|detour/i],
    ['detourDays', /detour|day/i],
    ['speedDrop', /speed/i],
    ['revealPlanet', /planet/i],
  ];

  it('every preview names each effect its outcomes (and its risk) have, and has no digits', () => {
    for (const card of EVENTS) {
      for (const ch of card.choices) {
        const all: Fx[] = [ch.outcomes as Fx];
        if (ch.risk) all.push(ch.risk.outcomes as Fx);
        expect(/\d/.test(ch.preview), `${card.id}/${ch.label}`).toBe(false);
        for (const [key, re] of words) {
          if (all.some((fx) => fx[key] !== undefined && fx[key] !== 0)) {
            expect(re.test(ch.preview), `${card.id}/${ch.label} must mention ${key}`).toBe(true);
          }
        }
      }
    }
  });

  it('a preview never claims an effect the choice does not have (hull, speed, planet)', () => {
    for (const card of EVENTS) {
      for (const ch of card.choices) {
        const all: Fx[] = [ch.outcomes as Fx];
        if (ch.risk) all.push(ch.risk.outcomes as Fx);
        const has = (k: keyof Fx) => all.some((fx) => fx[k] !== undefined && fx[k] !== 0);
        if (/hull/i.test(ch.preview)) expect(has('hullPct'), `${card.id}/${ch.label}`).toBe(true);
        if (/speed/i.test(ch.preview))
          expect(has('speedDrop'), `${card.id}/${ch.label}`).toBe(true);
        if (/planet/i.test(ch.preview))
          expect(has('revealPlanet'), `${card.id}/${ch.label}`).toBe(true);
      }
    }
  });

  it('the validator rejects a preview with a digit or a number word', () => {
    const c = clone(EVENTS[0]);
    c.choices[0].preview = 'Lose 15 hull.';
    expect(validateEventCardFull(c).join()).toContain('preview must not contain numbers');
    c.choices[0].preview = 'Lose two days.';
    expect(validateEventCardFull(c).join()).toContain('preview must not contain numbers');
  });
});

describe('a negative fuel budget and the per-ship event stream', () => {
  it('a detour that empties the tank with fuelFrac > 0: the ship drifts and progress never falls', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w, { dest: 5, speed: 1, fuel: 40000, supplies: 1_000_000 });
    ticks(w, 1);
    expect(s.shipRoute.fuelFrac[e]).toBeGreaterThan(0);
    s.shipManifest.fuel[e] = 50; // the detour (120 fuel) costs more than the tank holds
    stage(w, e, CARD.Micrometeor);
    expect(resolveSlot(w, 1)).toEqual({ ok: true });
    expect(s.shipManifest.fuel[e]).toBe(0);
    expect(s.shipRoute.fuelFrac[e]).toBe(0);
    let last = s.shipRoute.progress[e];
    for (let d = 0; d < 40; d++) {
      tickDay(w);
      expect(s.shipRoute.progress[e]).toBeGreaterThanOrEqual(last);
      expect(s.shipManifest.fuel[e]).toBeGreaterThanOrEqual(0);
      last = s.shipRoute.progress[e];
    }
    expect([ShipStateId.Drifting, ShipStateId.Lost]).toContain(s.shipState.state[e]);
  });

  it('one ship first card day is unchanged when other ships are added', () => {
    const firstDay = (others: number): number => {
      const w = lineWorld(2, 100);
      const e = addShip(w, { dest: 5, fuel: 40000, supplies: 1_000_000 });
      for (let i = 0; i < others; i++) addShip(w, { dest: 4, fuel: 40000, supplies: 1_000_000 });
      let d = 0;
      while (d < 400) {
        tickDay(w);
        d++;
        if (w.stores.shipState.state[e] === ShipStateId.Event) return d;
        // Park other ships' cards by resolving them so they cannot fill the queue.
        while (pendingCount(w) > 0 && w.stores.pendingEventCard.subject[0] !== e) {
          resolveSlot(w, 0);
        }
      }
      return -1;
    };
    const alone = firstDay(0);
    expect(alone).toBe(5);
    expect(firstDay(1)).toBe(alone);
    expect(firstDay(5)).toBe(alone);
  });
});

describe('validators', () => {
  const card = () => clone(EVENTS[0]);

  it('the shipped events pass', () => {
    expect(validateEventDefs(RAW_CONTENT.events)).toEqual([]);
    expect(validateAllContent(RAW_CONTENT)).toEqual([]);
  });

  it('reject a card with 4 choices (the limit is 3), by the short and the full validator', () => {
    const c = card();
    c.choices.push(clone(c.choices[0]), clone(c.choices[1]));
    expect(c.choices).toHaveLength(4);
    expect(validateEventCard(c).join()).toContain('4 choices, max 3');
    expect(validateEventCardFull(c).join()).toContain('4 choices, max 3');
    const root = { events: [c] };
    expect(validateEventDefs(root).join()).toContain('max 3');
  });

  it('accept 3 choices, reject 1', () => {
    const c = card();
    c.choices.push(clone(c.choices[0]));
    expect(validateEventCardFull(c)).toEqual([]);
    c.choices.length = 1;
    expect(validateEventCardFull(c).join()).toContain('1 choices, min 2');
  });

  it('reject a choice without a visible cost preview', () => {
    const c = card() as unknown as { choices: { preview?: string }[] };
    delete c.choices[0].preview;
    expect(validateEventCardFull(c).join()).toContain('needs a preview');
  });

  it('reject a risk with hidden odds, or odds out of range', () => {
    const c = clone(EVENTS[3]) as unknown as { choices: { risk: { oddsPct?: number } }[] };
    delete c.choices[0].risk.oddsPct;
    expect(validateEventCardFull(c).join()).toContain('oddsPct');
    c.choices[0].risk.oddsPct = 100;
    expect(validateEventCardFull(c).join()).toContain('oddsPct');
  });

  it('reject a fifth resource, an unknown effect, over-long text and a bad trigger', () => {
    const c = clone(EVENTS[0]) as unknown as {
      choices: { outcomes: Record<string, unknown>; label: string }[];
      body: string;
      trigger: Record<string, string>;
    };
    c.choices[0].outcomes.production = { flat: -5 };
    expect(validateEventCardFull(c).join()).toContain('unknown effect "production"');
    delete c.choices[0].outcomes.production;
    c.choices[0].label = 'one two three four five';
    expect(validateEventCardFull(c).join()).toContain('label is over');
    c.choices[0].label = 'Push';
    c.body = new Array(41).fill('word').join(' ');
    expect(validateEventCardFull(c).join()).toContain('body is over');
    c.body = 'ok';
    c.trigger = { shipState: 'Orbiting' };
    expect(validateEventCardFull(c).join()).toContain('trigger.shipState');
  });

  it('reject duplicate ids and traps that change speed', () => {
    const a = card();
    expect(validateEventDefs({ events: [a, clone(a)] }).join()).toContain('duplicate id');
    const d = clone(EVENTS[3]) as unknown as {
      choices: { risk: { outcomes: Record<string, unknown> } }[];
    };
    d.choices[0].risk.outcomes.speedDrop = 1;
    expect(validateEventCardFull(d).join()).toContain('risk outcomes may not use speedDrop');
  });

  it('the cooldown table has room for the cards (32 per ship)', () => {
    expect(MAX_EVENT_DEFS).toBe(32);
    expect(EVENT_CARD_COUNT).toBeLessThanOrEqual(MAX_EVENT_DEFS);
  });
});

describe('the roll: chance = route hazard x speed factor / hull rating', () => {
  it('literal permille values (hazard 40 unless stated)', () => {
    expect(eventChancePermille(40, 0, 0)).toBe(13); // Scout, Economy: 40 x 100 x 10 / (30 x 100)
    expect(eventChancePermille(40, 1, 0)).toBe(8); // Ark: rating 50
    expect(eventChancePermille(40, 2, 0)).toBe(5); // Heavy Ark: rating 80
    expect(eventChancePermille(100, 0, 0)).toBe(25); // 33 before the cap
    expect(eventChancePermille(80, 0, 0)).toBe(25); // 26 before the cap
    expect(eventChancePermille(0, 0, 0)).toBe(0);
    expect(eventChancePermille(40, 0, 1)).toBe(9); // factor 70
    expect(eventChancePermille(40, 0, 2)).toBe(5); // factor 40
  });

  it('faster means fewer events per trip, and a stronger hull means fewer events', () => {
    const perTrip = (hull: number, speed: number) =>
      eventChancePermille(40, hull, speed) * etaDays(25600, hull, speed);
    expect([perTrip(0, 0), perTrip(0, 1), perTrip(0, 2)]).toEqual([221, 108, 35]);
    expect([perTrip(1, 0), perTrip(1, 1), perTrip(1, 2)]).toEqual([200, 85, 30]);
    expect([perTrip(2, 0), perTrip(2, 1), perTrip(2, 2)]).toEqual([170, 69, 28]);
    expect(eventChancePermille(40, 0, 0)).toBeGreaterThan(eventChancePermille(40, 1, 0));
    expect(eventChancePermille(40, 1, 0)).toBeGreaterThan(eventChancePermille(40, 2, 0));
  });

  it('a calm route never rolls an event (300 days)', () => {
    const w = lineWorld(5, 0);
    addShip(w, { dest: 5 });
    ticks(w, 300);
    expect(pendingCount(w)).toBe(0);
  });

  it('a hazardous route does: the first card comes up on a fixed day and pauses the game', () => {
    const w = lineWorld(1, 100);
    const e = addShip(w, { dest: 5, fuel: 40000, supplies: 1_000_000 });
    let day = 0;
    while (pendingCount(w) === 0 && day < 500) {
      tickDay(w);
      day++;
    }
    const s = w.stores;
    expect(pendingCount(w)).toBe(1);
    expect(s.pendingEventCard.subject[0]).toBe(e);
    expect(s.pendingEventCard.day[0]).toBe(day);
    expect(s.pendingEventCard.card[0]).toBeGreaterThanOrEqual(0);
    expect(s.pendingEventCard.card[0]).toBeLessThan(EVENT_CARD_COUNT);
    expect(s.shipState.state[e]).toBe(ShipStateId.Event);
    expect(s.eventHistory.lastDay[e * MAX_EVENT_DEFS + s.pendingEventCard.card[0]]).toBe(day);
    expect(s.run.speed[0]).toBe(0);
    expect(s.run.resumeSpeed[0]).toBe(1);
  });

  it.each([0, 1, 2, 3, 4, 5])(
    'card %i is the only one that can fire when the others are cooling down',
    (card) => {
      const w = lineWorld(11, 100);
      const e = addShip(w, { dest: 5 });
      for (let c = 0; c < EVENT_CARD_COUNT; c++) {
        if (c !== card) w.stores.eventHistory.lastDay[e * MAX_EVENT_DEFS + c] = 1_000_000_000;
      }
      let guard = 0;
      while (pendingCount(w) === 0 && guard++ < 1000) tickDay(w);
      expect(w.stores.pendingEventCard.card[0]).toBe(card);
    },
  );

  it('only ships in flight roll: Drifting, Arrived and Lost ships never get a card', () => {
    const w = lineWorld(1, 100);
    const drift = addShip(w, { dest: 5 });
    const arrived = addShip(w, { destPlanet: planetOf(w, 0) + 1 }); // same system: arrives day 1
    w.stores.shipState.state[drift] = ShipStateId.Drifting;
    w.stores.shipRoute.drift[drift] = -1000; // keep it drifting for the whole test
    ticks(w, 1);
    expect(w.stores.shipState.state[arrived]).toBe(ShipStateId.Arrived);
    for (let i = 0; i < 300; i++) tickDay(w);
    expect(pendingCount(w)).toBe(0);
    w.stores.shipState.state[drift] = ShipStateId.Lost;
    ticks(w, 100);
    expect(pendingCount(w)).toBe(0);
  });

  it('a card respects its cooldown for the same ship (micrometeor storm: 15 days)', () => {
    const w = lineWorld(2, 100);
    const e = addShip(w, { dest: 5, fuel: 40000, supplies: 1_000_000 });
    for (let c = 1; c < EVENT_CARD_COUNT; c++) {
      w.stores.eventHistory.lastDay[e * MAX_EVENT_DEFS + c] = 1_000_000_000;
    }
    let first = 0;
    while (pendingCount(w) === 0) {
      tickDay(w);
      first++;
    }
    expect(w.stores.pendingEventCard.card[0]).toBe(CARD.Micrometeor);
    resolve(w, 1); // detour: delay of 4 days, then it flies on
    let again = 0;
    while (pendingCount(w) === 0 && again < 2000) {
      tickDay(w);
      again++;
    }
    expect(pendingCount(w)).toBe(1);
    expect(again).toBeGreaterThanOrEqual(15);
    expect(w.stores.pendingEventCard.day[0] - first).toBeGreaterThanOrEqual(15);
  });

  it('weights decide which card comes up: first card of 200 seeds, literal histogram', () => {
    const hist = new Array<number>(21).fill(0);
    for (let seed = 1; seed <= 200; seed++) {
      const w = lineWorld(seed, 100);
      addShip(w, { dest: 5, fuel: 40000, supplies: 1_000_000 });
      let guard = 0;
      while (pendingCount(w) === 0 && guard++ < 500) tickDay(w);
      if (pendingCount(w) > 0) hist[w.stores.pendingEventCard.card[0]]++;
    }
    // Weights 10 / 10 / 10 / 6 / 8 / 6 / 8 / 8 / 6 / 8 / 6 / 8 of 94.
    expect(hist).toEqual([
      15, 18, 18, 3, 21, 18, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16, 17, 12, 15, 10, 13,
    ]); // 176 of 200 seeds see a card on the trip (the same seeds as before M7a)
  });

  it('at most 8 cards wait; a full queue skips further rolls', () => {
    const w = lineWorld(9, 100);
    for (let i = 0; i < 40; i++) addShip(w, { dest: 5 });
    for (let d = 0; d < 400; d++) {
      tickDay(w);
      expect(pendingCount(w)).toBeLessThanOrEqual(MAX_PENDING_EVENTS);
    }
    expect(pendingCount(w)).toBe(MAX_PENDING_EVENTS);
    let frozen = 0;
    for (let e = 0; e < w.stores.counts[1]; e++) {
      if (w.stores.shipState.state[e] === ShipStateId.Event) frozen++;
    }
    expect(frozen).toBe(8);
  });
});

/** Expected outcome of one choice for the reference ship: Scout, 60 colonists, 5000 supplies,
 *  4000 fuel, integrity 100, Economy (Hard Burn for the engine fault). */
interface Expect {
  colonists?: number;
  supplies?: number;
  fuel?: number;
  integrity?: number;
  delay?: number;
  speed?: number;
}

describe('each card: every choice applies exactly the cost it shows', () => {
  const rows: [string, number, number, number, Expect][] = [
    // [title, card, choice, ship speed setting, expected state afterwards]
    ['Micrometeor storm / Push through', CARD.Micrometeor, 0, 0, { integrity: 85 }],
    ['Micrometeor storm / Detour', CARD.Micrometeor, 1, 0, { fuel: 3880, delay: 4 }],
    ['Illness outbreak / Use medical supplies', CARD.Illness, 0, 0, { supplies: 4500 }],
    ['Illness outbreak / Quarantine', CARD.Illness, 1, 0, { colonists: 58 }],
    ['Engine fault / Repair', CARD.EngineFault, 0, 2, { delay: 5 }],
    [
      'Engine fault / Limp on (Hard Burn to Cruise)',
      CARD.EngineFault,
      1,
      2,
      { speed: 1, delay: 2 },
    ],
    ['Engine fault / Limp on (Cruise to Economy)', CARD.EngineFault, 1, 1, { speed: 0, delay: 2 }],
    ['Engine fault / Limp on (already Economy)', CARD.EngineFault, 1, 0, { speed: 0, delay: 2 }],
    ['Derelict ship found / Ignore', CARD.Derelict, 1, 0, {}],
    ['Stowaways / Take them', CARD.Stowaways, 0, 0, { colonists: 72, supplies: 4750 }],
    ['Stowaways / Leave at nearest colony', CARD.Stowaways, 1, 0, { fuel: 3940, delay: 2 }],
    ['Strange signal / Investigate', CARD.StrangeSignal, 0, 0, { delay: 2 }],
    ['Strange signal / Stay on course', CARD.StrangeSignal, 1, 0, {}],
  ];

  it.each(rows)('%s', (_name, card, choice, speed, exp) => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w, { speed });
    stage(w, e, card);
    expect(s.shipState.state[e]).toBe(ShipStateId.Event);
    const before = {
      colonists: s.shipManifest.colonists[e],
      supplies: s.shipManifest.supplies[e],
      fuel: s.shipManifest.fuel[e],
      integrity: s.ship.integrity[e],
      delay: s.shipRoute.delay[e],
      speed: s.ship.speedSetting[e],
    };

    // The cost the UI shows before the player commits (from the snapshot).
    const snap = createSnapshot();
    fillSnapshot(w, snap, 0);
    expect(snap.meta[META_PENDING_COUNT]).toBe(1);
    expect(snap.meta[META_PENDING_CARD]).toBe(card);
    expect(snap.meta[META_PENDING_SHIP]).toBe(e);
    const o = choice * CHOICE_COST_STRIDE;
    const shown = {
      colonists: snap.eventCosts[o + CC_COLONISTS],
      supplies: snap.eventCosts[o + CC_SUPPLIES],
      fuel: snap.eventCosts[o + CC_FUEL],
      integrity: snap.eventCosts[o + CC_HULL],
      delay: snap.eventCosts[o + CC_DELAY],
      speed: 0 - snap.eventCosts[o + CC_SPEED_DROP],
    };

    expect(resolve(w, choice)).toEqual({ ok: true });
    const after = {
      colonists: s.shipManifest.colonists[e],
      supplies: s.shipManifest.supplies[e],
      fuel: s.shipManifest.fuel[e],
      integrity: s.ship.integrity[e],
      delay: s.shipRoute.delay[e],
      speed: s.ship.speedSetting[e],
    };
    // Applied change = shown cost, field by field.
    expect({
      colonists: after.colonists - before.colonists,
      supplies: after.supplies - before.supplies,
      fuel: after.fuel - before.fuel,
      integrity: after.integrity - before.integrity,
      delay: after.delay - before.delay,
      speed: after.speed - before.speed,
    }).toEqual(shown);
    // And the literal outcome.
    expect(after).toEqual({ ...before, ...exp });
    expect(s.shipState.state[e]).toBe(ShipStateId.InTransit);
    expect(pendingCount(w)).toBe(0);
    expect(s.run.lastEvent[0]).toBe(1);
    expect([s.run.lastEvent[1], s.run.lastEvent[2], s.run.lastEvent[3]]).toEqual([e, card, choice]);
  });

  it('Derelict ship found / Salvage shows 25% and applies fuel +300 always, the trap only on a hit', () => {
    const run = (seed: number) => {
      const w = lineWorld(seed);
      const s = w.stores;
      const e = addShip(w);
      stage(w, e, CARD.Derelict);
      const snap = createSnapshot();
      fillSnapshot(w, snap, 0);
      expect(snap.eventCosts[CC_FUEL]).toBe(300);
      expect(snap.eventCosts[CC_RISK_ODDS]).toBe(25);
      expect(snap.eventCosts[CC_RISK_HULL]).toBe(-20);
      expect(snap.eventCosts[CC_RISK_COLONISTS]).toBe(-2);
      expect(resolve(w, 0)).toEqual({ ok: true });
      return {
        hit: s.run.lastEvent[4],
        colonists: s.shipManifest.colonists[e],
        integrity: s.ship.integrity[e],
        fuel: s.shipManifest.fuel[e],
      };
    };
    // Seeds 1 and 3 are a hit and a miss (their ship streams are fixed by the seed).
    expect(run(1)).toEqual({ hit: 1, colonists: 58, integrity: 80, fuel: 4300 });
    expect(run(3)).toEqual({ hit: 0, colonists: 60, integrity: 100, fuel: 4300 });
    let hits = 0;
    for (let seed = 1; seed <= 200; seed++) hits += run(seed).hit;
    expect(hits).toBe(61); // about 25% of 200, from the seeds' fixed streams
  });

  it('Strange signal / Investigate scans the nearest unknown planet and nothing else', () => {
    const w = lineWorld(1);
    const s = w.stores;
    const e = addShip(w);
    ticks(w, 6); // x = 136: the home system is the closest
    stage(w, e, CARD.StrangeSignal);
    const n = s.counts[4];
    const before = Array.from(s.planet.survey.subarray(0, n));
    const snap = createSnapshot();
    fillSnapshot(w, snap, 0);
    expect(snap.eventCosts[CC_REVEAL]).toBe(1);
    resolve(w, 0);
    const changed: number[] = [];
    for (let p = 0; p < n; p++) if (s.planet.survey[p] !== before[p]) changed.push(p);
    expect(changed).toEqual([1]); // planet 0 is the Explored homeworld; planet 1 is next to it
    expect(s.planet.survey[1]).toBe(Survey.Scanned);
    expect([s.planetSurvey.habLo[1], s.planetSurvey.habHi[1]]).toEqual([0, 23]);
    expect(s.planet.habitability[1]).toBe(18);
    expect(s.planet.survey[s.shipRoute.destPlanet[e]]).toBe(Survey.Unknown);
  });

  it('a delay card stops the ship for exactly those days, supplies still burning', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w);
    ticks(w, 2);
    stage(w, e, CARD.EngineFault);
    resolve(w, 0); // Repair: 5 days
    const progress = s.shipRoute.progress[e];
    const supplies = s.shipManifest.supplies[e];
    ticks(w, 5);
    expect(s.shipRoute.progress[e]).toBe(progress);
    expect(s.shipManifest.supplies[e]).toBe(supplies - 300);
    tickDay(w);
    expect(s.shipRoute.progress[e]).toBe(progress + 1536);
  });

  it('a pending ship is frozen: no movement, fuel or supplies while its card waits', () => {
    const w = lineWorld();
    const s = w.stores;
    const e = addShip(w);
    ticks(w, 2);
    stage(w, e, CARD.Illness);
    const progress = s.shipRoute.progress[e];
    const supplies = s.shipManifest.supplies[e];
    ticks(w, 5);
    expect(s.shipRoute.progress[e]).toBe(progress);
    expect(s.shipManifest.supplies[e]).toBe(supplies);
  });

  it('event-caused loss: the hull is destroyed at 0 or less, or the last colonists die', () => {
    const hull = (integrity: number) => {
      const w = lineWorld();
      const e = addShip(w);
      w.stores.ship.integrity[e] = integrity;
      stage(w, e, CARD.Micrometeor);
      resolve(w, 0); // -15 hull
      return [
        w.stores.shipState.state[e],
        w.stores.shipLog.lostReason[e],
        w.stores.ship.integrity[e],
      ];
    };
    expect(hull(16)).toEqual([ShipStateId.InTransit, LostReason.None, 1]);
    expect(hull(15)).toEqual([ShipStateId.Lost, LostReason.Destroyed, 0]);
    expect(hull(10)).toEqual([ShipStateId.Lost, LostReason.Destroyed, -5]);

    const w = lineWorld();
    const e = addShip(w, { colonists: 1 });
    stage(w, e, CARD.Illness);
    resolve(w, 1); // quarantine: 3% of 1 rounds up to 1
    expect(w.stores.shipManifest.colonists[e]).toBe(0);
    expect(w.stores.shipState.state[e]).toBe(ShipStateId.Lost);
    expect(w.stores.shipLog.lostReason[e]).toBe(LostReason.AllDead);
    expect(w.stores.shipLog.lostDay[e]).toBe(0);
    expect(w.stores.run.shipsLost[0]).toBe(1);
  });

  it('losses never take more than the ship holds', () => {
    const w = lineWorld();
    const e = addShip(w, { supplies: 3, colonists: 5, fuel: 10 });
    stage(w, e, CARD.Micrometeor);
    resolve(w, 1); // detour: 4 days would burn 120 fuel; only 10 are there
    expect(w.stores.shipManifest.fuel[e]).toBe(0);
    expect(w.stores.shipRoute.delay[e]).toBe(4);
  });
});

describe('ResolveEventChoice rejects', () => {
  it('NO_PENDING_EVENT without a card, for an empty or an out-of-range slot', () => {
    const w = lineWorld();
    const r = (card: number, choice: number) =>
      submit(w, { type: 'ResolveEventChoice', card, choice, ship: 2 } as Command);
    expect(r(0, 0)).toEqual({ ok: false, reason: 'NO_PENDING_EVENT' });
    expect(r(-1, 0)).toEqual({ ok: false, reason: 'NO_PENDING_EVENT' });
    expect(r(8, 0)).toEqual({ ok: false, reason: 'NO_PENDING_EVENT' });
    expect(r(100000, 0)).toEqual({ ok: false, reason: 'NO_PENDING_EVENT' });
    expect(w.queue.count).toBe(0);
  });

  it('INVALID_CHOICE for a choice the card does not have', () => {
    const w = lineWorld();
    const e = addShip(w);
    stage(w, e, CARD.Micrometeor);
    const r = (choice: number) =>
      submit(w, { type: 'ResolveEventChoice', card: 0, choice, ship: e } as Command);
    expect(r(2)).toEqual({ ok: false, reason: 'INVALID_CHOICE' });
    expect(r(-1)).toEqual({ ok: false, reason: 'INVALID_CHOICE' });
    expect(r(1e9)).toEqual({ ok: false, reason: 'INVALID_CHOICE' });
    expect(pendingCount(w)).toBe(1);
    expect(r(1)).toEqual({ ok: true });
  });

  it('a resolve queued twice only applies once; the second finds no card and is dropped', () => {
    const w = lineWorld();
    const e = addShip(w);
    stage(w, e, CARD.Illness);
    const cmd: Command = { type: 'ResolveEventChoice', card: 0, choice: 0, ship: e };
    expect(submit(w, cmd)).toEqual({ ok: true });
    expect(submit(w, cmd)).toEqual({ ok: true });
    tickDay(w);
    expect(w.stores.shipManifest.supplies[e]).toBe(4500 - 60);
    expect(w.stores.run.lastEvent[0]).toBe(1);
  });

  it('the resolve names the ship: a wrong ship id for the slot is NO_PENDING_EVENT', () => {
    const w = lineWorld();
    const a = addShip(w);
    const b = addShip(w);
    stage(w, a, CARD.Illness);
    const wrong: Command = { type: 'ResolveEventChoice', card: 0, choice: 0, ship: b };
    expect(submit(w, wrong)).toEqual({ ok: false, reason: 'NO_PENDING_EVENT' });
    expect(submit(w, { ...wrong, ship: -1 })).toEqual({ ok: false, reason: 'NO_PENDING_EVENT' });
    expect(w.queue.count).toBe(0);
    expect(pendingCount(w)).toBe(1);
  });

  it('two pending cards and a duplicate resolve: the duplicate is rejected and changes nothing', () => {
    const w = lineWorld();
    const s = w.stores;
    const a = addShip(w);
    const b = addShip(w);
    stage(w, a, CARD.Illness);
    stage(w, b, CARD.Illness);
    const first: Command = { type: 'ResolveEventChoice', card: 0, choice: 0, ship: a };
    expect(send(w, first)).toEqual({ ok: true });
    // The card of ship b now sits in slot 0; the stale resolve for ship a must not hit it.
    const hash = hashState(s);
    const logged = s.counts[G_LOG];
    expect(submit(w, first)).toEqual({ ok: false, reason: 'NO_PENDING_EVENT' });
    applyCommandsNow(w);
    expect(hashState(s)).toBe(hash);
    expect(s.counts[G_LOG]).toBe(logged);
    expect(s.shipState.state[b]).toBe(ShipStateId.Event);
    expect(s.shipManifest.supplies[b]).toBe(5000);
    expect(pendingCount(w)).toBe(1);

    // Both queued before either applies: the second is dropped at apply, ship b is untouched.
    expect(submit(w, { ...first, ship: b })).toEqual({ ok: true });
    expect(submit(w, { ...first, ship: b })).toEqual({ ok: true });
    applyCommandsNow(w);
    expect(s.run.lastEvent[0]).toBe(2);
    expect(s.shipManifest.supplies[b]).toBe(4500);
  });
});

describe('several cards at once', () => {
  it('wait in order; resolving one in the middle shifts the later ones up', () => {
    const w = lineWorld();
    const s = w.stores;
    const a = addShip(w);
    const b = addShip(w);
    const c = addShip(w);
    stage(w, a, CARD.Micrometeor);
    stage(w, b, CARD.Illness);
    stage(w, c, CARD.Stowaways);
    expect(Array.from(s.pendingEventCard.card.subarray(0, 4))).toEqual([0, 1, 4, -1]);
    expect(Array.from(s.pendingEventCard.subject.subarray(0, 3))).toEqual([a, b, c]);
    resolve(w, 0, 1); // the middle one
    expect(Array.from(s.pendingEventCard.card.subarray(0, 4))).toEqual([0, 4, -1, -1]);
    expect(Array.from(s.pendingEventCard.subject.subarray(0, 2))).toEqual([a, c]);
    expect(s.shipState.state[b]).toBe(ShipStateId.InTransit);
    expect(s.shipState.state[a]).toBe(ShipStateId.Event);
    expect(s.run.speed[0]).toBe(0); // others still wait
    const snap = createSnapshot();
    fillSnapshot(w, snap, 0);
    expect(snap.meta[META_PENDING_COUNT]).toBe(2);
    expect(snap.meta[META_PENDING_SHIP]).toBe(a); // the oldest is shown first
    resolve(w, 0);
    resolve(w, 0);
    expect(pendingCount(w)).toBe(0);
    expect(s.run.speed[0]).toBe(1);
  });
});

describe('auto-pause (D-055)', () => {
  it('the game stops at the day a card comes up; later real time plays nothing', () => {
    const w = lineWorld(1, 100);
    const e = addShip(w, { dest: 5, fuel: 40000, supplies: 1_000_000 });
    w.stores.run.speed[0] = 4;
    const acc = createAccumulator();
    let ran = 0;
    let guard = 0;
    while (w.stores.run.speed[0] !== 0 && guard++ < 1000) ran += advanceReal(w, acc, 1000);
    expect(w.stores.run.speed[0]).toBe(0);
    expect(w.stores.run.resumeSpeed[0]).toBe(4);
    expect(ran).toBe(w.stores.run.day[0]);
    expect(pendingCount(w)).toBe(1);
    const day = w.stores.run.day[0];
    const progress = w.stores.shipRoute.progress[e];
    expect(advanceReal(w, acc, 60000)).toBe(0);
    expect(w.stores.run.day[0]).toBe(day);
    expect(w.stores.shipRoute.progress[e]).toBe(progress);
  });

  it('a card found mid-catch-up stops the remaining days of that call', () => {
    const w = lineWorld(1, 100);
    addShip(w, { dest: 5, fuel: 40000, supplies: 1_000_000 });
    w.stores.run.speed[0] = 4;
    const acc = createAccumulator();
    // 8 days can be due in one call; the first card that comes up cuts the rest of that call short.
    let total = 0;
    for (let i = 0; i < 100 && w.stores.run.speed[0] !== 0; i++) total += advanceReal(w, acc, 2000);
    expect(total).toBe(w.stores.run.day[0]);
    expect(acc.ms).toBe(0);
  });

  it('commands still apply while paused: speed requests are remembered, reroutes take effect', () => {
    const w = lineWorld(1, 100);
    const a = addShip(w, { dest: 5 });
    const b = addShip(w, { dest: 5 }); // a second ship, to reroute while a card waits
    stage(w, a, CARD.Micrometeor);
    w.stores.run.resumeSpeed[0] = 1;
    expect(w.stores.run.speed[0]).toBe(0);
    const acc = createAccumulator();

    // Asking for 2x while a card is pending is accepted, drained while paused, and remembered.
    expect(submit(w, { type: 'SetGameSpeed', speed: 2 })).toEqual({ ok: true });
    expect(advanceReal(w, acc, 16)).toBe(0);
    expect(w.stores.run.speed[0]).toBe(0);
    expect(w.stores.run.resumeSpeed[0]).toBe(2);

    // A reroute of the other ship applies at once while paused.
    expect(submit(w, { type: 'RerouteShip', ship: b, target: planetOf(w, 2) })).toEqual({
      ok: true,
    });
    expect(advanceReal(w, acc, 16)).toBe(0);
    expect(w.stores.shipRoute.destPlanet[b]).toBe(planetOf(w, 2));
    expect(w.stores.shipManifest.fuel[b]).toBe(3800);

    // Resolving the card resumes at the remembered speed.
    expect(submit(w, { type: 'ResolveEventChoice', card: 0, choice: 0, ship: a })).toEqual({
      ok: true,
    });
    expect(advanceReal(w, acc, 16)).toBe(0);
    expect(w.stores.run.speed[0]).toBe(2);
    expect(w.stores.run.resumeSpeed[0]).toBe(0);
    expect(w.stores.ship.integrity[a]).toBe(85);
  });

  it('pausing yourself while a card waits keeps the game paused after the choice', () => {
    const w = lineWorld();
    const e = addShip(w);
    w.stores.run.speed[0] = 2;
    stage(w, e, CARD.Illness);
    expect([w.stores.run.speed[0], w.stores.run.resumeSpeed[0]]).toEqual([0, 2]);
    send(w, { type: 'SetGameSpeed', speed: 0 });
    expect(w.stores.run.resumeSpeed[0]).toBe(0);
    resolve(w, 0);
    expect(w.stores.run.speed[0]).toBe(0);
  });

  it('a card while the player had paused leaves the game paused', () => {
    const w = lineWorld();
    const e = addShip(w);
    w.stores.run.speed[0] = 0;
    stage(w, e, CARD.Illness);
    resolve(w, 0);
    expect(w.stores.run.speed[0]).toBe(0);
    expect(w.stores.run.resumeSpeed[0]).toBe(0);
  });

  it('speed changes without a pending card are plain', () => {
    const w = lineWorld();
    send(w, { type: 'SetGameSpeed', speed: 4 });
    expect([w.stores.run.speed[0], w.stores.run.resumeSpeed[0]]).toEqual([4, 0]);
  });

  it('the worker applies card choices and reroutes at once, and the snapshot shows the pause', () => {
    const out: unknown[] = [];
    const h = createHandler({ postMessage: (m) => void out.push(m) }, () => 0);
    h.onMessage({ kind: 'init', seed: 42, gen: 1 });
    const w = h.getWorld() as World;
    const e = addShip(w);
    stage(w, e, CARD.Micrometeor);
    w.stores.run.resumeSpeed[0] = 1;
    const snap = createSnapshot();
    fillSnapshot(w, snap, 0);
    expect(snap.meta[META_PENDING_COUNT]).toBe(1);
    expect(snap.meta[META_RESUME_SPEED]).toBe(1);

    const replies = () => out.filter((m) => (m as { kind: string }).kind === 'commandResult');
    h.onMessage({
      kind: 'command',
      gen: 1,
      id: 31,
      command: { type: 'ResolveEventChoice', card: 0, choice: 1, ship: e },
    });
    expect(replies().at(-1)).toMatchObject({ id: 31, result: { ok: true } });
    expect(w.stores.shipRoute.delay[e]).toBe(4);
    expect(pendingCount(w)).toBe(0);
    expect(w.stores.run.speed[0]).toBe(1);

    h.onMessage({
      kind: 'command',
      gen: 1,
      id: 32,
      command: { type: 'RerouteShip', ship: e, target: w.homePlanet },
    });
    expect(replies().at(-1)).toMatchObject({ id: 32, result: { ok: true } });
    expect(w.stores.shipRoute.destPlanet[e]).toBe(w.homePlanet);
    h.onMessage({
      kind: 'command',
      gen: 1,
      id: 33,
      command: { type: 'ResolveEventChoice', card: 0, choice: 0, ship: e },
    });
    expect(replies().at(-1)).toMatchObject({
      id: 33,
      result: { ok: false, reason: 'NO_PENDING_EVENT' },
    });
  });
});
