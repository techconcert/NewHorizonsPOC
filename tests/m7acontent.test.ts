// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EVENTS, FIND_KINDS, PLANETFALL, RAW_CONTENT, TERRAINS } from '../src/data';
import {
  validateAllContent,
  validateEventCardFull,
  validateEventsAgainstVariants,
  validateNativeVariants,
  validateTerrain,
} from '../src/data/validate';
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
  CC_RISK_SUPPLIES,
  CC_SPEED_DROP,
  CC_SUPPLIES,
  CHOICE_COST_STRIDE,
  choiceCost,
  EVENT_CHOICE_COUNT,
  EVENT_IDS,
  EVENT_SCENE,
  EVENT_TRIGGER_NATIVE,
  EVENT_TRIGGER_TERRAIN,
  EVENT_TRIGGER_VARIANT,
  expeditionChoiceCost,
  SCENE_EXPLORATION,
  SCENE_NATIVE_CONTACT,
  SCENE_TRANSIT,
} from '../src/shared/events';
import {
  NATIVE_VARIANT_COUNT,
  NATIVE_VARIANT_FLAVOUR,
  NATIVE_VARIANT_IDS,
  NATIVE_VARIANT_NAMES,
  nativeKindText,
  pickNativeVariant,
  variantStrength,
} from '../src/shared/planetfall';
import { terrainFlavour } from '../src/shared/terrain';
import { createSnapshot } from '../src/shared/snapshot';
import { G_PLANET } from '../src/sim/components';
import { pickExpeditionCard, queueExpeditionCard } from '../src/sim/events';
import { createWorld } from '../src/sim/world';
import { nativesBanner } from '../src/ui/planetPanel';
import { fillSnapshot } from '../src/worker/fill';
import { arrivedShip, form } from './helpers/planetfall';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const idx = (id: string): number => EVENT_IDS.indexOf(id);

describe('M7a card counts (CONTENT_GUIDE target: about 30)', () => {
  it('has 30 cards: 12 transit, 12 planetfall, 6 native contact', () => {
    const by = (scene: number): number => EVENTS.filter((_, i) => EVENT_SCENE[i] === scene).length;
    expect(EVENTS.length).toBe(30);
    expect(by(SCENE_TRANSIT)).toBe(12);
    expect(by(SCENE_EXPLORATION)).toBe(12);
    expect(by(SCENE_NATIVE_CONTACT)).toBe(6);
  });

  it('keeps the earlier cards at their indices (tests stage cards by index)', () => {
    expect(EVENT_IDS.slice(0, 15)).toEqual([
      'micrometeor_storm',
      'illness_outbreak',
      'engine_fault',
      'derelict_ship',
      'stowaways',
      'strange_signal',
      'ancient_vault',
      'strange_lights',
      'spoiled_stores',
      'sinkhole',
      'fever_camp',
      'fresh_spring',
      'guides_offered',
      'wary_watchers',
      'hostile_warband',
    ]);
  });

  it('every card has 2 or 3 choices, a preview on each, and passes the full validator', () => {
    for (const [i, c] of EVENTS.entries()) {
      expect(EVENT_CHOICE_COUNT[i]).toBeGreaterThanOrEqual(2);
      expect(EVENT_CHOICE_COUNT[i]).toBeLessThanOrEqual(3);
      expect(validateEventCardFull(c), c.id).toEqual([]);
      for (const ch of c.choices) expect(ch.preview.length).toBeGreaterThan(0);
    }
    expect(validateAllContent(RAW_CONTENT)).toEqual([]);
  });

  it('terrain cards cover every terrain; contact cards cover each disposition without a variant', () => {
    const terrains = new Set(
      EVENTS.filter((_, i) => EVENT_SCENE[i] === SCENE_EXPLORATION).map((c) => c.trigger.terrain),
    );
    for (const t of ['Plains', 'Highlands', 'Jungle', 'Ice', 'Crater', 'Ruins']) {
      expect(terrains.has(t), t).toBe(true);
    }
    const generic = EVENTS.filter(
      (c) => c.scenes.includes('NativeContact') && c.trigger.variant === undefined,
    ).map((c) => c.trigger.native);
    expect(generic.sort()).toEqual(['Hostile', 'Peaceful', 'Wary']);
  });
});

describe('every effect kind is handled by the cost table', () => {
  const big = new Int32Array(CHOICE_COST_STRIDE);
  const keys = (fx: object): string[] => Object.keys(fx);

  it('transit effects reach their cost slots', () => {
    const slot: Record<string, number> = {
      colonists: CC_COLONISTS,
      supplies: CC_SUPPLIES,
      fuel: CC_FUEL,
      hullPct: CC_HULL,
      delayDays: CC_DELAY,
      detourDays: CC_DELAY,
      speedDrop: CC_SPEED_DROP,
      revealPlanet: CC_REVEAL,
    };
    const riskSlot: Record<string, number> = {
      colonists: CC_RISK_COLONISTS,
      supplies: CC_RISK_SUPPLIES,
      fuel: CC_RISK_FUEL,
      hullPct: CC_RISK_HULL,
      delayDays: CC_RISK_DELAY,
    };
    let checked = 0;
    EVENTS.forEach((c, i) => {
      if (EVENT_SCENE[i] !== SCENE_TRANSIT) return;
      c.choices.forEach((ch, k) => {
        choiceCost(i, k, 1000, 10000, 5000, 1, 2, big, 0);
        for (const key of keys(ch.outcomes)) {
          expect(slot[key], `${c.id} ${key}`).toBeDefined();
          expect(big[slot[key]], `${c.id}/${k} ${key}`).not.toBe(0);
          checked++;
        }
        for (const key of keys(ch.risk?.outcomes ?? {})) {
          expect(riskSlot[key], `${c.id} risk ${key}`).toBeDefined();
          expect(big[riskSlot[key]], `${c.id}/${k} risk ${key}`).not.toBe(0);
          checked++;
        }
      });
    });
    expect(checked).toBeGreaterThan(20);
  });

  it('planetfall effects reach their cost slots', () => {
    const slot: Record<string, number> = {
      colonists: CC_COLONISTS,
      supplies: CC_SUPPLIES,
      delayDays: CC_DELAY,
      revealRegion: CC_REVEAL,
      nativeMood: CC_NATIVE_MOOD,
    };
    const riskSlot: Record<string, number> = {
      colonists: CC_RISK_COLONISTS,
      supplies: CC_RISK_SUPPLIES,
      delayDays: CC_RISK_DELAY,
      nativeMood: CC_RISK_MOOD,
    };
    let checked = 0;
    EVENTS.forEach((c, i) => {
      if (EVENT_SCENE[i] === SCENE_TRANSIT) return;
      c.choices.forEach((ch, k) => {
        expeditionChoiceCost(i, k, 100, 5000, 0, big, 0);
        for (const key of keys(ch.outcomes)) {
          expect(slot[key], `${c.id} ${key}`).toBeDefined();
          expect(big[slot[key]], `${c.id}/${k} ${key}`).not.toBe(0);
          checked++;
        }
        for (const key of keys(ch.risk?.outcomes ?? {})) {
          expect(riskSlot[key], `${c.id} risk ${key}`).toBeDefined();
          expect(big[riskSlot[key]], `${c.id}/${k} risk ${key}`).not.toBe(0);
          checked++;
        }
      });
    });
    expect(checked).toBeGreaterThan(30);
  });

  it('literal costs of a few new cards (what the preview shows is what the sim applies)', () => {
    const out = new Int32Array(CHOICE_COST_STRIDE);
    choiceCost(idx('passing_convoy'), 0, 300, 1000, 500, 1, 1, out, 0);
    expect([out[CC_SUPPLIES], out[CC_FUEL]]).toEqual([-100, 200]);
    choiceCost(idx('passing_convoy'), 1, 300, 1000, 100, 1, 1, out, 0);
    expect([out[CC_SUPPLIES], out[CC_FUEL]]).toEqual([150, -100]); // fuel loss is capped at what is held
    choiceCost(idx('solar_flare'), 1, 300, 1000, 500, 1, 1, out, 0);
    expect([out[7], out[CC_RISK_HULL], out[CC_RISK_COLONISTS]]).toEqual([40, -10, -6]);
    expeditionChoiceCost(idx('raiders_camp'), 1, 100, 1000, 3, out, 0);
    expect(out[7]).toBe(43); // 55 odds, -4 per guard, three guards
    expeditionChoiceCost(idx('herders_trail'), 2, 100, 1000, 3, out, 0);
    expect([out[7], out[CC_RISK_MOOD]]).toEqual([36, 1]);
    expeditionChoiceCost(idx('traders_ford'), 0, 100, 1000, 0, out, 0);
    expect([out[CC_SUPPLIES], out[CC_REVEAL]]).toEqual([-80, 1]);
  });
});

describe('terrain find tables', () => {
  it('each terrain has its own table, a mystery share, a flavour line; sums stay 100', () => {
    expect(TERRAINS.length).toBe(6);
    const mystery = FIND_KINDS.indexOf('mystery');
    const seen = new Set<string>();
    for (const t of TERRAINS) {
      expect(t.finds.reduce((a, b) => a + b, 0)).toBe(100);
      expect(t.finds[mystery]).toBeGreaterThanOrEqual(5);
      expect(t.flavour.length).toBeGreaterThan(10);
      seen.add(t.finds.join());
    }
    expect(seen.size).toBe(6);
  });

  it('literal mystery shares and the headline find of each terrain', () => {
    const top = (id: string): string => {
      const f = TERRAINS.find((t) => t.id === id)!.finds;
      let best = 0;
      f.forEach((v, k) => {
        if (FIND_KINDS[k] !== 'nothing' && FIND_KINDS[k] !== 'mystery' && v > f[best]) best = k;
        if (FIND_KINDS[best] === 'nothing' || FIND_KINDS[best] === 'mystery') best = k;
      });
      return FIND_KINDS[best];
    };
    expect(TERRAINS.map((t) => t.finds[FIND_KINDS.indexOf('mystery')])).toEqual([
      10, 8, 8, 8, 12, 32,
    ]);
    expect(['plains', 'highlands', 'jungle', 'ice', 'crater', 'ruins'].map(top)).toEqual([
      'farmland',
      'ore',
      'rich_food',
      'water',
      'rare_minerals',
      'tech',
    ]);
  });

  it('rejects two identical tables, a missing mystery share and a missing flavour', () => {
    const t = clone(RAW_CONTENT.terrain);
    (t.terrains[1] as { finds: number[] }).finds = [...t.terrains[0].finds];
    expect(validateTerrain(t).join()).toContain('own find table');
    const t2 = clone(RAW_CONTENT.terrain);
    const f = (t2.terrains[0] as { finds: number[] }).finds;
    f[FIND_KINDS.indexOf('nothing')] += f[FIND_KINDS.indexOf('mystery')];
    f[FIND_KINDS.indexOf('mystery')] = 0;
    expect(validateTerrain(t2).join()).toContain('mystery share');
    const t3 = clone(RAW_CONTENT.terrain);
    (t3.terrains[2] as { flavour: string }).flavour = '';
    expect(validateTerrain(t3).join()).toContain('flavour');
  });

  it('terrainFlavour answers the region card, and is empty for hidden terrain', () => {
    expect(terrainFlavour(0)).toBe('Open grass and slow rivers. Easy marching, little cover.');
    expect(terrainFlavour(255)).toBe('');
  });
});

describe('native variants', () => {
  it('six variants, two per disposition, in file order', () => {
    expect(NATIVE_VARIANT_COUNT).toBe(6);
    expect(NATIVE_VARIANT_IDS).toEqual([
      'traders',
      'guides',
      'herders',
      'hermits',
      'raiders',
      'holdouts',
    ]);
    expect(NATIVE_VARIANT_NAMES).toEqual([
      '',
      'Traders',
      'Guides',
      'Herders',
      'Hermits',
      'Raiders',
      'Holdouts',
    ]);
    expect(NATIVE_VARIANT_FLAVOUR[2]).toBe(
      'Hill-walkers who know every pass and offer to lead strangers across it.',
    );
  });

  it('pickNativeVariant alternates by strength within the disposition; strength gets the delta', () => {
    expect([10, 11, 12].map((r) => pickNativeVariant(1, r))).toEqual([1, 2, 1]);
    expect([20, 21].map((r) => pickNativeVariant(2, r))).toEqual([3, 4]);
    expect([30, 31].map((r) => pickNativeVariant(3, r))).toEqual([5, 6]);
    expect(pickNativeVariant(0, 30)).toBe(0);
    expect(variantStrength(1, 10)).toBe(1); // 0 clamps to 1
    expect(variantStrength(2, 50)).toBe(45);
    expect(variantStrength(5, 90)).toBe(99); // 100 clamps to 99
    expect(variantStrength(6, 50)).toBe(55);
    expect(variantStrength(0, 50)).toBe(50);
  });

  it('nativeKindText names the kind, or says natives when it is not known', () => {
    expect(nativeKindText(1, 1)).toBe('peaceful traders');
    expect(nativeKindText(2, 5)).toBe('wary raiders'); // raiders who calmed down
    expect(nativeKindText(3, 0)).toBe('hostile natives');
  });

  it('every generated native planet has a variant of its own disposition; others have none', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const s = createWorld(seed).stores;
      for (let p = 0; p < s.counts[G_PLANET]; p++) {
        const d = s.native.disposition[p];
        const v = s.native.variant[p];
        if (d === 0) {
          expect(v).toBe(0);
          continue;
        }
        expect(v).toBeGreaterThanOrEqual(1);
        const want = ['', 'Peaceful', 'Wary', 'Hostile'][d];
        expect(PLANETFALL.natives.variants[v - 1].disposition).toBe(want);
        expect(s.native.strength[p]).toBeGreaterThanOrEqual(1);
        expect(s.native.strength[p]).toBeLessThanOrEqual(99);
        seen.add(v);
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  it('the banner names the kind once met, and reads as before without a variant', () => {
    expect(nativesBanner(1, 40, 0)).toBe(
      'CONTACT: peaceful natives (strength 40). They guide the expedition: better exploration odds and shared food.',
    );
    expect(nativesBanner(3, 60, 5)).toBe(
      'DANGER, CONTACT: hostile raiders (strength 60). Fast bands that take what travellers carry. Expect ambushes in their home regions; Security cuts the losses.',
    );
    expect(nativesBanner(2, 30, 3)).toContain('CONTACT: wary herders (strength 30). Herd-keepers');
  });

  it('the snapshot shows the variant only after contact', () => {
    const L = arrivedShip(5);
    const s = L.w.stores;
    s.native.disposition[L.planet] = 2;
    s.native.variant[L.planet] = 3;
    const snap = createSnapshot();
    fillSnapshot(L.w, snap, 0);
    expect(snap.planetNativeVariant[L.planet]).toBe(0);
    s.native.revealed[L.planet] = 1;
    fillSnapshot(L.w, snap, 0);
    expect([snap.planetNative[L.planet], snap.planetNativeVariant[L.planet]]).toEqual([2, 3]);
  });
});

describe('variant contact cards', () => {
  it('the three variant cards name their variant, disposition and nothing else', () => {
    const v = (id: string): number[] => [
      EVENT_TRIGGER_VARIANT[idx(id)],
      EVENT_TRIGGER_NATIVE[idx(id)],
      EVENT_TRIGGER_TERRAIN[idx(id)],
    ];
    expect(v('traders_ford')).toEqual([1, 1, -1]);
    expect(v('herders_trail')).toEqual([3, 2, -1]);
    expect(v('raiders_camp')).toEqual([5, 3, -1]);
    expect(EVENT_TRIGGER_VARIANT[idx('guides_offered')]).toBe(0);
  });

  it('only the matching variant (or a generic card) is offered at a contact', () => {
    const L = arrivedShip(5);
    const s = L.w.stores;
    const e = form(L, { explorers: 10 });
    const draws = (disp: number, variant: number): Set<number> => {
      s.native.variant[L.planet] = variant;
      const out = new Set<number>();
      for (let i = 0; i < 80; i++) {
        s.eventHistory.lastDay.fill(-1);
        const c = pickExpeditionCard(L.w, e, SCENE_NATIVE_CONTACT, 0, disp);
        out.add(c);
      }
      return out;
    };
    expect([...draws(1, 1)].sort()).toEqual([idx('guides_offered'), idx('traders_ford')].sort());
    expect([...draws(1, 2)]).toEqual([idx('guides_offered')]);
    expect([...draws(2, 3)].sort()).toEqual([idx('wary_watchers'), idx('herders_trail')].sort());
    expect([...draws(2, 4)]).toEqual([idx('wary_watchers')]);
    expect([...draws(3, 5)].sort()).toEqual([idx('hostile_warband'), idx('raiders_camp')].sort());
    // Raiders who calmed down to Wary fall back to the generic Wary card.
    expect([...draws(2, 5)]).toEqual([idx('wary_watchers')]);
  });

  it('a queued variant card is a normal pending card (cost shown before the choice)', () => {
    const L = arrivedShip(5);
    const e = form(L, { explorers: 10 });
    expect(queueExpeditionCard(L.w, e, idx('raiders_camp'))).toBe(true);
    expect(L.w.stores.pendingEventCard.card[0]).toBe(idx('raiders_camp'));
  });
});

describe('validators reject bad variants and cards', () => {
  it('variant list problems', () => {
    const v = clone(PLANETFALL.natives.variants);
    expect(validateNativeVariants(v)).toEqual([]);
    expect(validateNativeVariants(v.slice(0, 2)).join()).toContain('3 to 15');
    const dup = clone(v);
    dup[1].id = dup[0].id;
    expect(validateNativeVariants(dup).join()).toContain('duplicate');
    const bad = clone(v);
    bad[0].disposition = 'Friendly';
    expect(validateNativeVariants(bad).join()).toContain('disposition');
    const far = clone(v);
    far[0].strengthDelta = 31;
    expect(validateNativeVariants(far).join()).toContain('strengthDelta');
    const noHostile = clone(v).map((x) => ({ ...x, disposition: 'Peaceful' }));
    expect(validateNativeVariants(noHostile).join()).toContain('needs a Wary variant');
  });

  it('a card naming an unknown variant, the wrong disposition, or no generic card is rejected', () => {
    const ev = clone(RAW_CONTENT.events);
    (ev.events.find((c) => c.id === 'traders_ford')!.trigger as { variant: string }).variant =
      'nobody';
    expect(validateEventsAgainstVariants(ev, RAW_CONTENT.planetfall).join()).toContain('nobody');
    const ev2 = clone(RAW_CONTENT.events);
    (ev2.events.find((c) => c.id === 'traders_ford')!.trigger as { variant: string }).variant =
      'raiders';
    expect(validateEventsAgainstVariants(ev2, RAW_CONTENT.planetfall).join()).toContain(
      'is Hostile, not Peaceful',
    );
    const ev3 = clone(RAW_CONTENT.events);
    ev3.events = ev3.events.filter((c) => c.id !== 'wary_watchers');
    expect(validateEventsAgainstVariants(ev3, RAW_CONTENT.planetfall).join()).toContain(
      'Wary natives need a contact card without a variant',
    );
  });

  it('trigger.variant needs trigger.native; a Transit card may not use it', () => {
    const card = clone(EVENTS.find((c) => c.id === 'fresh_spring')!);
    (card.trigger as { variant?: string }).variant = 'traders';
    expect(validateEventCardFull(card).join()).toContain('only for NativeContact');
  });

  it('cards that break the writing rules are rejected', () => {
    const base = clone(EVENTS.find((c) => c.id === 'lost_trail')!);
    const longBody = clone(base);
    longBody.body = new Array(41).fill('word').join(' ');
    expect(validateEventCardFull(longBody).join()).toContain('body is over');
    const numberInPreview = clone(base);
    numberInPreview.choices[0].preview = 'Lose three days.';
    expect(validateEventCardFull(numberInPreview).join()).toContain('numbers');
    const fourChoices = clone(base);
    fourChoices.choices = [...base.choices, ...base.choices];
    expect(validateEventCardFull(fourChoices).join()).toContain('max 3');
    const hiddenOdds = clone(EVENTS.find((c) => c.id === 'solar_flare')!);
    delete (hiddenOdds.choices[1].risk as Partial<{ oddsPct: number }>).oddsPct;
    expect(validateEventCardFull(hiddenOdds).join()).toContain('oddsPct');
  });
});
