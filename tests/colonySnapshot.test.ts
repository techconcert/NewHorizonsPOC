// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { RAW_CONTENT } from '../src/data';
import { validateAllContent, validateEconomy, validateTechs } from '../src/data/validate';
import { COLONY_STRIDE, C_POPULATION } from '../src/shared/snapshot';
import {
  copySnapshotInto,
  createSnapshot,
  EC_BUILDING,
  EC_CLAIMED,
  EC_EAT,
  EC_HOUSING,
  EC_HUNGER,
  EC_NATIVE,
  EC_NATIVE_HOMES,
  EC_PRODUCTION,
  EC_STANCE,
  EC_SUPPLIES,
  EC_WORKING,
  ECON_STRIDE,
  META_COLONY_COUNT,
  META_END_DAY,
  META_OUTCOME,
  META_RESEARCH_RATE,
  META_SCORE,
  META_TECH_CURRENT,
  META_TECH_MASK,
  META_TECH_PROGRESS,
  META_WIN_STREAK,
  SNAPSHOT_REGIONS_PER_COLONY,
  snapshotBuffers,
} from '../src/shared/snapshot';
import { MAX_REGIONS_PER_PLANET, RunOutcome } from '../src/sim/components';
import { tickDay } from '../src/sim/tick';
import { fillSnapshot } from '../src/worker/fill';
import { District } from '../src/shared/colony';
import { addColony, addNatives, setDistrict, setTerrain } from './helpers/colony';
import { lineWorld, send } from './helpers/transit';
import { ChooseTech } from './helpers/colonyCommands';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('snapshot: colony economy rows', () => {
  it('limits agree with the sim', () => {
    expect(SNAPSHOT_REGIONS_PER_COLONY).toBe(MAX_REGIONS_PER_PLANET);
  });

  it('carry the stance, natives, flows, housing and districts of each colony row', () => {
    const w = lineWorld();
    const c = addColony(w, { population: 600, supplies: 100000, stance: 1 });
    setTerrain(w, c, 0, 0);
    setDistrict(w, c, 0, District.Farm);
    setDistrict(w, c, 2, District.Mine, 4);
    addNatives(w, c, { disposition: 3, homes: [3, 5] });
    w.stores.native.claimed[w.stores.colony.planet[c] as number] = 1 << 5;
    send(w, ChooseTech(6));
    tickDay(w);
    const snap = createSnapshot();
    fillSnapshot(w, snap, 0);
    expect(snap.meta[META_COLONY_COUNT]).toBe(2);
    const o = ECON_STRIDE; // colony row 1 (row 0 is the homeworld)
    const x = snap.colonyEcon;
    expect(x[o + EC_STANCE]).toBe(1);
    expect(x[o + EC_NATIVE]).toBe(3);
    expect(x[o + EC_NATIVE_HOMES]).toBe(1);
    expect(x[o + EC_CLAIMED]).toBe(1);
    expect(x[o + EC_SUPPLIES]).toBe(160 + 1350);
    expect(x[o + EC_PRODUCTION]).toBe(8);
    expect(x[o + EC_EAT]).toBe(600);
    expect(x[o + EC_HUNGER]).toBe(0);
    expect(x[o + EC_HOUSING]).toBe(1000);
    expect(x[o + EC_WORKING]).toBe(1);
    expect(x[o + EC_BUILDING]).toBe(1);
    expect(snap.colonyDistrictKind[SNAPSHOT_REGIONS_PER_COLONY]).toBe(District.Farm);
    expect(snap.colonyDistrictKind[SNAPSHOT_REGIONS_PER_COLONY + 2]).toBe(District.Mine);
    expect(snap.colonyDistrictLeft[SNAPSHOT_REGIONS_PER_COLONY + 2]).toBe(3);
    expect(snap.colonies[COLONY_STRIDE + C_POPULATION]).toBe(603);
    // Research is chosen, not yet made.
    expect(snap.meta[META_TECH_CURRENT]).toBe(6);
    expect(snap.meta[META_TECH_PROGRESS]).toBe(0);
    expect(snap.meta[META_TECH_MASK]).toBe(0);
    expect(snap.meta[META_RESEARCH_RATE]).toBe(0);
  });

  it('natives stay hidden in the row until they are met', () => {
    const w = lineWorld();
    const c = addColony(w);
    addNatives(w, c, { disposition: 3, homes: [3] });
    w.stores.native.revealed[w.stores.colony.planet[c] as number] = 0;
    const snap = createSnapshot();
    fillSnapshot(w, snap, 0);
    expect(snap.colonyEcon[ECON_STRIDE + EC_NATIVE]).toBe(0);
    expect(snap.colonyEcon[ECON_STRIDE + EC_NATIVE_HOMES]).toBe(0);
  });

  it('the end state reaches the snapshot and the new arrays copy and transfer', () => {
    const w = lineWorld();
    w.stores.run.homeDays[0] = 1;
    tickDay(w);
    const snap = createSnapshot();
    fillSnapshot(w, snap, 0);
    expect(snap.meta[META_OUTCOME]).toBe(RunOutcome.LostHomeworld);
    expect(snap.meta[META_END_DAY]).toBe(1);
    expect(snap.meta[META_SCORE]).toBe(0);
    expect(snap.meta[META_WIN_STREAK]).toBe(0);
    const dst = createSnapshot();
    copySnapshotInto(snap, dst);
    expect(dst.meta[META_OUTCOME]).toBe(RunOutcome.LostHomeworld);
    const buffers = snapshotBuffers(snap);
    expect(new Set(buffers).size).toBe(buffers.length);
  });
});

describe('economy and tech content validators', () => {
  it('the shipped files are valid', () => {
    expect(validateEconomy(RAW_CONTENT.economy)).toEqual([]);
    expect(validateTechs(RAW_CONTENT.techs)).toEqual([]);
    expect(validateAllContent(RAW_CONTENT)).toEqual([]);
  });

  it('economy: not six district types, wrong ids, Wary raids, Defend that does not help', () => {
    const e = clone(RAW_CONTENT.economy);
    e.districts.pop();
    expect(validateEconomy(e).join()).toContain('district types');
    const e2 = clone(RAW_CONTENT.economy);
    e2.districts[0] = { ...e2.districts[0], id: 'orchard' } as (typeof e2.districts)[number];
    expect(validateEconomy(e2).join()).toContain('district ids');
    const e3 = clone(RAW_CONTENT.economy);
    e3.natives.raidChancePct[2] = 10;
    expect(validateEconomy(e3).join()).toContain('only Hostile natives raid');
    const e4 = clone(RAW_CONTENT.economy);
    e4.natives.stanceChancePct[1] = 100;
    expect(validateEconomy(e4).join()).toContain('Defend must cut');
    const e5 = clone(RAW_CONTENT.economy);
    e5.stockCap = 3_000_000_000;
    expect(validateEconomy(e5).join()).toContain('stockCap');
    const e6 = clone(RAW_CONTENT.economy);
    e6.terrainPct.farm = [1, 2, 3];
    expect(validateEconomy(e6).join()).toContain('terrainPct.farm');
    expect(validateEconomy(null).length).toBeGreaterThan(0);
  });

  it('techs: too many, unknown effect, forward or self prerequisite, free tech', () => {
    const t = clone(RAW_CONTENT.techs);
    for (let i = 0; i < 4; i++) t.techs.push({ ...t.techs[0], id: `extra_${i}` });
    expect(validateTechs(t).join()).toContain('about 10 techs');
    const t2 = clone(RAW_CONTENT.techs);
    (t2.techs[0] as { effect: string }).effect = 'mindControl';
    expect(validateTechs(t2).join()).toContain('effect must be one of');
    const t3 = clone(RAW_CONTENT.techs);
    (t3.techs[0] as { prereq: number }).prereq = 5;
    expect(validateTechs(t3).join()).toContain('prereq');
    const t4 = clone(RAW_CONTENT.techs);
    (t4.techs[1] as { prereq: number }).prereq = 1;
    expect(validateTechs(t4).join()).toContain('prereq');
    const t5 = clone(RAW_CONTENT.techs);
    (t5.techs[2] as { cost: number }).cost = 0;
    expect(validateTechs(t5).join()).toContain('cost');
    const t6 = clone(RAW_CONTENT.techs);
    t6.branches.pop();
    expect(validateTechs(t6).join()).toContain('branch names');
  });
});
