// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  REROUTE_REJECT_REASONS,
  createCommandGate,
  createCommandTracker,
  describeRejectFor,
  gateReply,
  gateSend,
  gateSnapshot,
} from '../src/ui/commandGate';
import { createSnapshot, type Snapshot } from '../src/shared/snapshot';
import {
  buildCardView,
  choiceCommand,
  choiceForKey,
  costLines,
  marginAfterChoice,
  pendingCardKey,
  riskLine,
} from '../src/ui/eventCardModel';
import { eventText } from '../src/ui/hud';
import { buildView, chooseDestination, createMissionState } from '../src/ui/missionModel';
import {
  buildReroutePanelModel,
  createRerouteScratch,
  createRerouteSession,
  fillRerouteSig,
  REROUTE_SIG_LENGTH,
  selectShip,
  selectTargetSystem,
} from '../src/ui/rerouteModel';
import { buildShipRow, fillRowKey, formatMargin, ROW_KEY_LENGTH } from '../src/ui/shipListModel';
import { formatExpectedEvents } from '../src/shared/transit';
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

function snapOf(w: ReturnType<typeof lineWorld>): Snapshot {
  const s = createSnapshot();
  fillSnapshot(w, s, 0);
  return s;
}

describe('command gate (double-click guard)', () => {
  it('a second send while one is in flight is refused', () => {
    const g = createCommandGate();
    expect(gateSend(g)).toBe(true);
    expect(gateSend(g)).toBe(false);
    expect(g.awaiting).toBe(true);
  });

  it('a snapshot before the accepted reply does not unlock; the first one after it does', () => {
    const g = createCommandGate();
    gateSend(g);
    expect(gateSnapshot(g)).toBe(false); // a stale snapshot posted before the command
    expect(g.awaiting).toBe(true);
    gateReply(g, true);
    expect(g.awaiting).toBe(true);
    expect(gateSnapshot(g)).toBe(true);
    expect(g.awaiting).toBe(false);
    expect(gateSend(g)).toBe(true);
  });

  it('a rejected reply unlocks at once', () => {
    const g = createCommandGate();
    gateSend(g);
    gateReply(g, false);
    expect(g.awaiting).toBe(false);
  });

  it('a reply with nothing in flight changes nothing', () => {
    const g = createCommandGate();
    gateReply(g, true);
    expect(g).toEqual({ awaiting: false, replied: false });
    expect(gateSnapshot(g)).toBe(false);
  });
});

describe('command tracker and reject text', () => {
  it('returns the kind of a tracked id once, and speed for id 0 or unknown ids', () => {
    const t = createCommandTracker();
    t.track(7, 'reroute');
    expect(t.take(7)).toBe('reroute');
    expect(t.take(7)).toBe('speed');
    expect(t.take(0)).toBe('speed');
  });

  it('reroute rejections have reroute wording, never "Launch refused"', () => {
    for (const reason of REROUTE_REJECT_REASONS) {
      const text = describeRejectFor('reroute', reason);
      expect(text, reason).toMatch(/^Reroute refused/);
    }
    expect(REROUTE_REJECT_REASONS).toHaveLength(9);
    expect(describeRejectFor('launch', 'OUT_OF_RANGE')).toMatch(/^Launch refused/);
  });

  it('event rejections and shared fallbacks read as sentences', () => {
    expect(describeRejectFor('event', 'NO_PENDING_EVENT')).toBe(
      'That event card was already answered.',
    );
    expect(describeRejectFor('event', 'INVALID_CHOICE')).toBe(
      'That choice does not exist on this card.',
    );
    expect(describeRejectFor('reroute', 'QUEUE_FULL')).toBe(
      'Too many commands at once. Try again.',
    );
    expect(describeRejectFor('event', 'NOT_INITIALIZED')).toBe('The simulation is still starting.');
  });
});

describe('ship list view model', () => {
  it('describes a ship in transit with margin, ETA and fuel', () => {
    const w = lineWorld();
    const e = addShip(w);
    const row = buildShipRow(snapOf(w), 0, -1);
    expect(row).toMatchObject({
      entity: e,
      kind: 'transit',
      name: `Scout #${e}`,
      state: 'In transit',
      dest: 'System 1, planet 1',
      eta: '17 d',
      // 5000 supplies / (60 colonists x 17 days) = 490%
      margin: '490% SAFE',
      marginClass: 'good',
      fuel: '4000',
      selected: false,
    });
  });

  it('a margin under 100 percent is red, the selected ship is marked', () => {
    const w = lineWorld();
    const e = addShip(w, { supplies: 500 });
    const row = buildShipRow(snapOf(w), 0, e);
    expect(row.margin).toBe('49% LOW');
    expect(row.marginClass).toBe('bad');
    expect(row.selected).toBe(true);
  });

  it('shows an event-pending ship as paused and an arrived ship as arrived with no margin', () => {
    const w = lineWorld();
    const e = addShip(w);
    stage(w, e, CARD.Illness);
    const pending = buildShipRow(snapOf(w), 0, -1);
    expect(pending.kind).toBe('event');
    expect(pending.state).toBe('Event pending');
    expect(pending.eta).toBe('17 d, paused');

    const w2 = lineWorld();
    addShip(w2);
    ticks(w2, 17);
    const arrived = buildShipRow(snapOf(w2), 0, -1);
    expect(arrived.kind).toBe('arrived');
    expect(arrived.eta).toBe('arrived');
    expect(arrived.margin).toBe('-');
    expect(arrived.marginClass).toBe('none');
  });

  it('the row key changes with margin, fuel, state, ETA and selection, and not otherwise', () => {
    const w = lineWorld();
    const e = addShip(w);
    const a = new Int32Array(ROW_KEY_LENGTH);
    const b = new Int32Array(ROW_KEY_LENGTH);
    const s1 = snapOf(w);
    fillRowKey(s1, 0, -1, a, 0);
    fillRowKey(snapOf(w), 0, -1, b, 0);
    expect(Array.from(b)).toEqual(Array.from(a)); // identical snapshot, identical key
    fillRowKey(s1, 0, e, b, 0);
    expect(Array.from(b)).not.toEqual(Array.from(a)); // selection
    ticks(w, 1);
    fillRowKey(snapOf(w), 0, -1, b, 0);
    expect(Array.from(b)).not.toEqual(Array.from(a)); // ETA, margin and fuel moved
  });

  it('formats the margin: capped values, no colonists, not flying', () => {
    expect(formatMargin(250, 60, true)).toBe('250%');
    expect(formatMargin(999, 60, true)).toBe('999%+');
    expect(formatMargin(999, 0, true)).toBe('-');
    expect(formatMargin(120, 60, false)).toBe('-');
  });
});

describe('reroute panel model', () => {
  function flown(over: Parameters<typeof addShip>[1] = {}) {
    const w = lineWorld();
    const e = addShip(w, over);
    ticks(w, 5);
    return { w, e, snap: snapOf(w) };
  }

  it('without a selection the panel has nothing to show', () => {
    const { snap } = flown();
    const m = buildReroutePanelModel(snap, createRerouteSession(), createRerouteScratch());
    expect(m.mode).toBe('none');
    expect(m.radiusWorld).toBe(0);
    expect(m.command).toBeNull();
  });

  it('a selected ship shows the range ring radius and asks for a target', () => {
    const { e, snap } = flown();
    const s = createRerouteSession();
    selectShip(s, e);
    const m = buildReroutePanelModel(snap, s, createRerouteScratch());
    expect(m.mode).toBe('pick');
    expect(m.radiusWorld).toBeCloseTo(729.8, 2);
    expect(m.hint).toMatch(/Click a lit star/);
  });

  it('previews a target: new ETA, margin, fuel penalty and fuel left (system 3, worked example)', () => {
    const { w, e, snap } = flown();
    const s = createRerouteSession();
    const scratch = createRerouteScratch();
    selectShip(s, e);
    expect(selectTargetSystem(s, snap, 3, scratch)).toBe(true);
    const m = buildReroutePanelModel(snap, s, scratch);
    expect(m.mode).toBe('preview');
    expect(m.target).toBe('System 3');
    expect(m.previewSystem).toBe(3);
    // 5 days flown of a 17 day leg: 12 days left now.
    expect(m.eta).toBe('about 45 days (now 12)');
    // Now: 4700 supplies / (60 x 12) = 652%.
    expect(m.margin).toBe('about 174% SAFE (now 652%)');
    expect(m.fuelPenalty).toBe('200');
    expect(m.fuelTrip).toBe('1350');
    expect(m.fuelAfter).toBe('at least 2300 of 3850');
    expect(m.marginClass).toBe('good');
    expect(m.warn).toBe('');
    expect(m.confirmEnabled).toBe(true);
    expect(m.command).toEqual({ type: 'RerouteShip', ship: e, target: planetOf(w, 3) });
  });

  it('warns in red text when the new margin is under 100 percent', () => {
    const { e, snap } = (() => {
      const w = lineWorld();
      const ship = addShip(w, { supplies: 600 });
      ticks(w, 5);
      return { e: ship, snap: snapOf(w) };
    })();
    const s = createRerouteSession();
    const scratch = createRerouteScratch();
    selectShip(s, e);
    selectTargetSystem(s, snap, 3, scratch);
    const m = buildReroutePanelModel(snap, s, scratch);
    // 300 supplies left for 60 colonists over 45 days: 11 percent.
    expect(m.marginClass).toBe('bad');
    expect(m.warn).toBe('Warning: supplies cover only 11% of the trip. Colonists will starve.');
    expect(m.command).not.toBeNull(); // allowed, but the player is told
  });

  it('a target out of range explains the shortfall and offers no command', () => {
    const w = lineWorld();
    const e = addShip(w, { fuel: 700 });
    ticks(w, 5);
    const snap = snapOf(w);
    const s = createRerouteSession();
    const scratch = createRerouteScratch();
    selectShip(s, e);
    selectTargetSystem(s, snap, 3, scratch);
    const m = buildReroutePanelModel(snap, s, scratch);
    expect(m.warn).toBe('Out of range: this course needs 1550 fuel and the ship can spend 549.');
    expect(m.command).toBeNull();
    expect(m.confirmEnabled).toBe(false);
    expect(m.planets[0].inRange).toBe(false);
  });

  it('offers the unload option when the target planet is an own colony', () => {
    const { w, e, snap } = flown();
    snap.planetOwned[planetOf(w, 3)] = 1;
    const s = createRerouteSession();
    const scratch = createRerouteScratch();
    selectShip(s, e);
    selectTargetSystem(s, snap, 3, scratch);
    const m = buildReroutePanelModel(snap, s, scratch);
    expect(m.unload).toMatch(/unload on arrival/);
    expect(m.planets[0].label).toMatch(/your colony/);
  });

  it('is blocked while the ship has an event card, with the reason', () => {
    const { w, e } = flown();
    stage(w, e, CARD.Illness);
    const s = createRerouteSession();
    selectShip(s, e);
    const m = buildReroutePanelModel(snapOf(w), s, createRerouteScratch());
    expect(m.mode).toBe('blocked');
    expect(m.hint).toBe('This ship has an event card waiting. Answer the card first.');
    expect(m.radiusWorld).toBe(0);
  });

  it('the current target is not offered, and a lost or missing ship says so', () => {
    const { w, e, snap } = flown();
    const s = createRerouteSession();
    const scratch = createRerouteScratch();
    selectShip(s, e);
    selectTargetSystem(s, snap, 1, scratch);
    // The current target never shows as an option, so the default slot is another planet or none.
    expect(buildReroutePanelModel(snap, s, scratch).command?.target).not.toBe(planetOf(w, 1));
    s.slot = 0; // force the current target planet
    const m = buildReroutePanelModel(snap, s, scratch);
    expect(m.hint).toBe('The ship is already flying to this planet.');
    expect(m.command).toBeNull();
    selectShip(s, e + 50);
    const gone = buildReroutePanelModel(snap, s, scratch);
    expect(gone.mode).toBe('blocked');
    expect(gone.hint).toBe('That ship is no longer in flight.');
  });

  it('Confirm is disabled while a send is in flight', () => {
    const { e, snap } = flown();
    const s = createRerouteSession();
    const scratch = createRerouteScratch();
    selectShip(s, e);
    selectTargetSystem(s, snap, 3, scratch);
    expect(buildReroutePanelModel(snap, s, scratch).confirmEnabled).toBe(true);
    expect(gateSend(s.gate)).toBe(true);
    expect(buildReroutePanelModel(snap, s, scratch).confirmEnabled).toBe(false);
  });

  it('selecting a target needs a selected ship; the change signature follows the inputs', () => {
    const { e, snap } = flown();
    const s = createRerouteSession();
    const scratch = createRerouteScratch();
    expect(selectTargetSystem(s, snap, 3, scratch)).toBe(false);
    selectShip(s, e);
    const a = new Int32Array(REROUTE_SIG_LENGTH);
    const b = new Int32Array(REROUTE_SIG_LENGTH);
    fillRerouteSig(snap, s, a);
    fillRerouteSig(snap, s, b);
    expect(Array.from(b)).toEqual(Array.from(a));
    selectTargetSystem(s, snap, 3, scratch);
    fillRerouteSig(snap, s, b);
    expect(Array.from(b)).not.toEqual(Array.from(a));
  });
});

describe('event card view model', () => {
  it('lists every cost of a choice before commit (Illness: supplies -500 or colonists -2)', () => {
    const w = lineWorld();
    const e = addShip(w);
    stage(w, e, CARD.Illness);
    const v = buildCardView(snapOf(w));
    expect(v).not.toBeNull();
    expect(v!.title).toBe('Illness outbreak');
    expect(v!.ship).toBe(e);
    expect(v!.shipLine).toBe(`Scout #${e}, heading to System 1, planet 1`);
    expect(v!.choices).toHaveLength(2);
    expect(v!.choices[0].key).toBe('1');
    expect(v!.choices[0].lines).toEqual(['Supplies -500']);
    expect(v!.choices[1].lines).toEqual(['Colonists -2']);
    expect(v!.choices[0].risk).toBe('');
  });

  it('shows the supply margin after each choice, computed with the shared math', () => {
    const w = lineWorld();
    const e = addShip(w);
    stage(w, e, CARD.Illness);
    const v = buildCardView(snapOf(w))!;
    // Now: 5000 / (60 x 17) = 490%. Medical supplies: 4500 / 1020 = 441%. Quarantine: 58 x 17 = 986: 507%.
    expect(v.choices[0].marginAfter).toBe('441% SAFE (now 490%)');
    expect(v.choices[1].marginAfter).toBe('507% SAFE (now 490%)');
    expect(v.choices[0].marginClass).toBe('good');
    expect(v.choices[0].fuelLeft).toBe('4000');
  });

  it('a delay choice raises the days and lowers the margin (Engine fault, repair: 17 + 5 days)', () => {
    const w = lineWorld();
    const e = addShip(w);
    stage(w, e, CARD.EngineFault);
    const v = buildCardView(snapOf(w))!;
    expect(v.choices[0].lines).toEqual(['5 days lost']);
    // 5000 / (60 x 22) = 378%
    expect(v.choices[0].marginAfter.startsWith('378%')).toBe(true);
    // Limp on at Economy: no level to lose, only the 2 days.
    expect(v.choices[1].lines).toEqual(['2 days lost']);
  });

  it('shows the odds and the trap of a risk choice (Derelict: 25 percent)', () => {
    const w = lineWorld();
    const e = addShip(w);
    stage(w, e, CARD.Derelict);
    const v = buildCardView(snapOf(w))!;
    const salvage = v.choices[0];
    expect(salvage.lines).toEqual(['Fuel +300']);
    expect(salvage.risk.startsWith('25% chance')).toBe(true);
    expect(salvage.risk).toContain('Hull -20%');
    expect(salvage.risk).toContain('Colonists -2');
    expect(salvage.marginIfRisk).toBe('507% SAFE');
    expect(v.choices[1].risk).toBe('');
    expect(v.choices[1].lines).toEqual(['No cost']);
  });

  it('a detour shows the extra fuel it burns (Micrometeor, detour: 4 days lost and fuel)', () => {
    const w = lineWorld();
    const e = addShip(w);
    stage(w, e, CARD.Micrometeor);
    const v = buildCardView(snapOf(w))!;
    expect(v.choices[0].lines).toEqual(['Hull -15%']);
    expect(v.choices[1].lines[0]).toMatch(/^Fuel -\d+$/);
    expect(v.choices[1].lines).toContain('4 days lost');
  });

  it('formats cost lines and risk lines from raw numbers', () => {
    const costs = new Int32Array(13);
    expect(costLines(costs, 0)).toEqual(['No cost']);
    costs[0] = -3;
    costs[1] = 12;
    costs[3] = -15;
    costs[4] = 1;
    costs[5] = 2;
    costs[6] = 1;
    expect(costLines(costs, 0)).toEqual([
      'Colonists -3',
      'Supplies +12',
      'Hull -15%',
      '1 day lost',
      'Speed drops 2 levels',
      'Scans a nearby planet',
    ]);
    expect(riskLine(costs, 0, 'trap')).toBe('');
    costs[7] = 40;
    costs[11] = -20;
    expect(riskLine(costs, 0, 'trap')).toBe('40% chance (trap): Hull -20%');
    expect(riskLine(costs, 0, '')).toBe('40% chance: Hull -20%');
  });

  it('a speed drop slows the rest of the leg in the margin figure', () => {
    // Ark (hull 1, base speed 4), Cruise (1): 4 x 1.5 = 6 units a day. 600 units left = 100 days.
    // Dropping one level (Economy, 4 a day) takes 150 days.
    const ship = {
      hull: 1,
      speed: 1,
      colonists: 50,
      supplies: 7500,
      delay: 0,
      distanceLeft: 600 * 256,
    };
    const none = new Int32Array(13);
    expect(marginAfterChoice(ship, none, 0, false)).toBe(150); // 7500 / (50 x 100)
    const drop = new Int32Array(13);
    drop[5] = 1;
    expect(marginAfterChoice(ship, drop, 0, false)).toBe(100); // 7500 / (50 x 150)
  });

  it('answers the card in slot 0 with the ship it concerns; keys 1 to 3 pick choices', () => {
    const w = lineWorld();
    const e = addShip(w);
    stage(w, e, CARD.Derelict);
    const v = buildCardView(snapOf(w))!;
    expect(choiceCommand(v, 1)).toEqual({
      type: 'ResolveEventChoice',
      card: 0,
      choice: 1,
      ship: e,
    });
    expect(choiceCommand(v, 2)).toBeNull();
    expect(choiceCommand(v, -1)).toBeNull();
    expect(choiceForKey('1', 2)).toBe(0);
    expect(choiceForKey('2', 2)).toBe(1);
    expect(choiceForKey('3', 2)).toBe(-1);
    expect(choiceForKey('3', 3)).toBe(2);
    expect(choiceForKey('4', 3)).toBe(-1);
    expect(choiceForKey('a', 3)).toBe(-1);
    expect(choiceForKey('Enter', 3)).toBe(-1);
  });

  it('queued cards come one at a time, oldest first, each with its own key', () => {
    const w = lineWorld();
    const a = addShip(w);
    const b = addShip(w, { dest: 2 });
    stage(w, a, CARD.Illness);
    stage(w, b, CARD.EngineFault);
    const s1 = snapOf(w);
    const v1 = buildCardView(s1)!;
    expect(v1.title).toBe('Illness outbreak');
    expect(v1.ship).toBe(a);
    expect(v1.queueLine).toBe('Card 1 of 2 waiting');
    expect(v1.pending).toBe(2);

    expect(resolveSlot(w, 0).ok).toBe(true);
    const s2 = snapOf(w);
    const v2 = buildCardView(s2)!;
    expect(v2.title).toBe('Engine fault');
    expect(v2.ship).toBe(b);
    expect(v2.queueLine).toBe('');
    expect(v2.key).not.toBe(v1.key);

    expect(resolveSlot(w, 0).ok).toBe(true);
    const s3 = snapOf(w);
    expect(buildCardView(s3)).toBeNull();
    expect(pendingCardKey(s3)).toBe('');
  });

  it('a double click cannot answer two cards: the second resolve for a stale card is refused by the sim', () => {
    const w = lineWorld();
    const a = addShip(w);
    const b = addShip(w, { dest: 2 });
    stage(w, a, CARD.Illness);
    stage(w, b, CARD.EngineFault);
    const v1 = buildCardView(snapOf(w))!;
    const cmd = choiceCommand(v1, 0)!;
    expect(resolveSlot(w, 0).ok).toBe(true);
    // The same command again (slot 0 now holds the other ship's card) must not resolve it.
    const second = send(w, cmd);
    expect(second.ok).toBe(false);
    expect(buildCardView(snapOf(w))!.ship).toBe(b);
  });
});

describe('HUD event indicator', () => {
  it('is empty without cards and names the resume speed with them', () => {
    expect(eventText(0, 2)).toBe('');
    expect(eventText(1, 2)).toBe('Event card pending: paused, resumes at 2x');
    expect(eventText(3, 0)).toBe('3 event cards pending: paused');
  });
});

describe('Mission Command: expected event cards', () => {
  it('is shown per trip and falls as the speed setting rises', () => {
    const w = lineWorld(1, 40);
    const snap = snapOf(w);
    const state = createMissionState();
    chooseDestination(state, 3, 0, snap);
    const at = (speed: number): number => {
      state.speed = speed;
      return buildView(state, snap)!.expectedEventsX100;
    };
    const eco = at(0);
    const cruise = at(1);
    const hard = at(2);
    expect(eco).toBeGreaterThan(cruise);
    expect(cruise).toBeGreaterThan(hard);
    expect(hard).toBeGreaterThan(0);
    expect(formatExpectedEvents(eco)).toMatch(/^\d+\.\d\d$/);
  });

  it('is zero on a calm route', () => {
    const w = lineWorld(1, 0);
    const snap = snapOf(w);
    const state = createMissionState();
    chooseDestination(state, 3, 0, snap);
    expect(buildView(state, snap)!.expectedEventsX100).toBe(0);
  });
});
