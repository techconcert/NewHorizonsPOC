// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { District, OUTCOME } from '../src/shared/colony';
import {
  createSnapshot,
  META_DAY,
  META_END_DAY,
  META_OUTCOME,
  META_RESEARCH_RATE,
  META_SCORE,
  META_TECH_CURRENT,
  META_TECH_MASK,
  META_TECH_PROGRESS,
  META_WIN_STREAK,
  type Snapshot,
} from '../src/shared/snapshot';
import { RunOutcome } from '../src/sim/components';
import { fillSnapshot } from '../src/worker/fill';
import { buildColonyView, manageableRows } from '../src/ui/colonyPanelModel';
import { COLONY_REJECT_REASONS, describeRejectFor } from '../src/ui/commandGate';
import { buildEndView, goalText } from '../src/ui/endScreenModel';
import { buildTechView, researchSummary } from '../src/ui/techModel';
import { addColony, addNatives, setDistrict } from './helpers/colony';
import { lineWorld } from './helpers/transit';

function colonySnapshot(production = 100, stance = 0): { snap: Snapshot; colony: number } {
  const w = lineWorld();
  const colony = addColony(w, { population: 600, production, explored: 4, stance });
  setDistrict(w, colony, 0, District.Farm);
  setDistrict(w, colony, 1, District.Mine, 4);
  addNatives(w, colony, { disposition: 3, homes: [3] });
  const snap = createSnapshot();
  fillSnapshot(w, snap, 0);
  return { snap, colony };
}

describe('colony panel model', () => {
  it('lists founded colonies only (row 0 is the homeworld)', () => {
    const { snap } = colonySnapshot();
    expect(manageableRows(snap)).toEqual([1]);
    expect(buildColonyView(snap, 0, -1)).toBeNull();
    expect(buildColonyView(snap, 2, -1)).toBeNull();
  });

  it('describes sites: finished, being built, empty and native ground', () => {
    const { snap } = colonySnapshot();
    const v = buildColonyView(snap, 1, -1);
    expect(v?.sites.map((s) => s.label)).toEqual([
      'Site 1: Plains, Farm',
      'Site 2: Plains, Mine, 4 days left',
      'Site 3: Plains, empty',
      'Site 4: Plains, native land',
    ]);
    expect(v?.sites.map((s) => s.free)).toEqual([false, false, true, false]);
    expect(v?.districts).toBe('Districts: 1 working, 1 being built.');
    expect(v?.natives).toBe('Natives: Hostile. 1 native home sites left, 0 claimed by the colony.');
  });

  it('build options show cost, time and yield, and are off until a free site is picked', () => {
    const { snap, colony } = colonySnapshot();
    const none = buildColonyView(snap, 1, -1);
    expect(none?.options.map((o) => o.label)).toEqual([
      'Build Farm',
      'Build Mine',
      'Build Refinery',
      'Build Habitat',
      'Build Research lab',
      'Build Spaceport',
    ]);
    expect(
      none?.options.every((o) => o.command === null && o.reason === 'Pick a site first.'),
    ).toBe(true);

    const v = buildColonyView(snap, 1, 2);
    const o = v?.options ?? [];
    expect(o[0].detail).toBe(
      'Farm: 40 Production, 10 days to build. Supplies. About 1350 Supplies a day here with a full crew.',
    );
    expect(o[1].detail).toContain('About 24 Production a day');
    expect(o[2].detail).toContain('About 48 Fuel a day');
    expect(o[3].detail).toContain('About 48 Supplies a day');
    expect(o[4].detail).toContain('About 7 Research a day');
    expect(o[0].command).toEqual({ type: 'BuildDistrict', colony, region: 2, district: 1 });
    expect(o[4].command).toEqual({ type: 'BuildDistrict', colony, region: 2, district: 5 });
    // 100 Production on hand: the Spaceport costs 200.
    expect(o[5].reason).toBe('Needs 200 Production; the colony has 100.');
    expect(o[5].command).toBeNull();
  });

  it('a busy or native site cannot be built on; a rich colony can start a Spaceport once', () => {
    const rich = colonySnapshot(500).snap;
    expect(buildColonyView(rich, 1, 0)?.options[0].reason).toBe('That site is not free.');
    expect(buildColonyView(rich, 1, 3)?.options[0].reason).toBe('That site is not free.');
    const ok = buildColonyView(rich, 1, 2);
    expect(ok?.options[5].command).toEqual({
      type: 'BuildSpaceport',
      colony: ok?.entity,
      region: 2,
    });
    expect(ok?.hasSpaceport).toBe(false);

    const w = lineWorld();
    const c = addColony(w, { production: 500, explored: 3 });
    setDistrict(w, c, 0, District.Spaceport, 5);
    const snap = createSnapshot();
    fillSnapshot(w, snap, 0);
    const v = buildColonyView(snap, 1, 1);
    expect(v?.hasSpaceport).toBe(true);
    expect(v?.options[5].reason).toBe('This colony has a Spaceport.');
  });

  it('stance buttons carry the command and mark the active stance', () => {
    const { snap, colony } = colonySnapshot(100, 1);
    const v = buildColonyView(snap, 1, -1);
    expect(v?.stances.map((s) => s.label)).toEqual(['Coexist', 'Defend', 'Push out']);
    expect(v?.stances.map((s) => s.active)).toEqual([false, true, false]);
    expect(v?.stances[2].command).toEqual({ type: 'SetColonyStance', colony, stance: 2 });
    expect(v?.stance).toBe(1);
  });

  it('stocks, population and a raid line read from the snapshot', () => {
    const { snap } = colonySnapshot();
    const v = buildColonyView(snap, 1, -1);
    expect(v?.stocks).toBe('Stock: 10000 Supplies, 0 Fuel, 100 Production.');
    expect(v?.population).toBe('Population 600 of 0 housing. Penalty days: 0.');
    expect(v?.raid).toBe('');
  });
});

describe('tech panel model', () => {
  function snapWith(mask: number, current: number, progress: number, rate: number): Snapshot {
    const snap = createSnapshot();
    fillSnapshot(lineWorld(), snap, 0);
    snap.meta[META_TECH_MASK] = mask;
    snap.meta[META_TECH_CURRENT] = current;
    snap.meta[META_TECH_PROGRESS] = progress;
    snap.meta[META_RESEARCH_RATE] = rate;
    return snap;
  }

  it('at the start the roots are open and the rest are locked behind their prerequisite', () => {
    const v = buildTechView(snapWith(0, -1, 0, 0));
    expect(v.rows).toHaveLength(10);
    expect(v.rows[0]).toMatchObject({
      name: 'Ion Drive',
      branch: 'Propulsion',
      state: 'open',
      status: 'Cost 600 points',
      buttonLabel: 'Research Ion Drive',
      canChoose: true,
      command: { type: 'ChooseTech', tech: 0 },
    });
    expect(v.rows[1]).toMatchObject({
      state: 'locked',
      status: 'Needs Ion Drive first',
      canChoose: false,
      command: null,
    });
    expect(v.rows.filter((r) => r.state === 'open').map((r) => r.name)).toEqual([
      'Ion Drive',
      'Hydroponics',
      'Laboratories',
    ]);
    expect(v.summary).toBe('Research: 0 of 10 techs, no tech chosen (0 points a day)');
  });

  it('shows progress and days left, known techs, and warns that switching restarts', () => {
    const snap = snapWith(1, 3, 300, 10);
    const v = buildTechView(snap);
    expect(v.rows[0]).toMatchObject({ state: 'known', status: 'Known', canChoose: false });
    expect(v.rows[1].state).toBe('open');
    expect(v.rows[1].status).toBe('Cost 900 points. Switching restarts the points');
    expect(v.rows[3]).toMatchObject({
      state: 'current',
      status: 'Researching: 50% of 600, 30 days left',
      canChoose: false,
    });
    expect(researchSummary(snap)).toBe(
      'Research: 1 of 10 techs, Hydroponics 50% (10 points a day)',
    );
  });

  it('switching away from progress needs a confirm press with its own label', () => {
    const snap = snapWith(1, 3, 300, 10);
    const v = buildTechView(snap);
    expect(v.rows[1].needsConfirm).toBe(true);
    expect(v.rows[1].buttonLabel).toBe('Research Reinforced Hulls');
    expect(buildTechView(snap, 1).rows[1].buttonLabel).toBe(
      'Confirm: switch research to Reinforced Hulls',
    );
    expect(buildTechView(snap, 1).rows[2].buttonLabel).toBe('Research Fuel Cracking');
    // Nothing to lose: no progress, or nothing chosen yet.
    expect(buildTechView(snapWith(1, 3, 0, 10), 1).rows[1].needsConfirm).toBe(false);
    expect(buildTechView(snapWith(1, -1, 0, 10), 1).rows[1].buttonLabel).toBe(
      'Research Reinforced Hulls',
    );
  });

  it('with no research output the current tech says so', () => {
    const v = buildTechView(snapWith(0, 0, 0, 0));
    expect(v.rows[0].status).toBe('Researching: 0% of 600, no research output');
  });
});

describe('end screen model', () => {
  function endSnap(outcome: number): Snapshot {
    const snap = createSnapshot();
    snap.meta[META_OUTCOME] = outcome;
    snap.meta[META_SCORE] = 1234;
    snap.meta[META_END_DAY] = 987;
    snap.meta[META_DAY] = 987;
    return snap;
  }

  it('the outcome codes equal the sim codes', () => {
    expect(OUTCOME).toEqual(RunOutcome);
  });

  it('is closed while the run goes on', () => {
    expect(buildEndView(endSnap(OUTCOME.Running)).over).toBe(false);
  });

  it('a win, a collapse and a dead colony each have their own title, with the score and days', () => {
    const won = buildEndView(endSnap(OUTCOME.Won));
    expect(won).toMatchObject({
      over: true,
      won: true,
      title: 'Humanity has a new home',
      score: 1234,
      days: 987,
      scoreText: 'Score: 1234 colonists living off-world after 987 days.',
    });
    expect(won.reason).toBe('10 colonies held 2600 people or more each for 90 days in a row.');
    expect(buildEndView(endSnap(OUTCOME.LostHomeworld))).toMatchObject({
      won: false,
      title: 'The homeworld has collapsed',
    });
    expect(buildEndView(endSnap(OUTCOME.LostAllDead)).title).toBe('No colonists are left');
  });

  it('the goal line counts the days held', () => {
    const snap = createSnapshot();
    expect(goalText(snap)).toBe('Goal: 10 colonies of 2600+ people for 90 days');
    snap.meta[META_WIN_STREAK] = 12;
    expect(goalText(snap)).toBe('Goal: 10 colonies of 2600+, held 12 of 90 days');
  });
});

describe('colony command reject texts', () => {
  it('each colony reason has its own wording with the command prefix', () => {
    for (const r of COLONY_REJECT_REASONS) {
      expect(
        describeRejectFor('build', r).startsWith('Build refused: ') || r === 'GAME_ENDED',
      ).toBe(true);
      expect(describeRejectFor('stance', r)).not.toContain('Launch refused');
      expect(describeRejectFor('tech', r)).not.toContain('Launch refused');
    }
    expect(describeRejectFor('build', 'INSUFFICIENT_PRODUCTION')).toBe(
      'Build refused: the colony does not have enough Production.',
    );
    expect(describeRejectFor('stance', 'INVALID_STANCE')).toBe(
      'Stance refused: that stance does not exist.',
    );
    expect(describeRejectFor('tech', 'TECH_LOCKED')).toBe(
      'Research refused: learn its prerequisite tech first.',
    );
    expect(describeRejectFor('build', 'NOT_INITIALIZED')).toBe('The simulation is still starting.');
  });
});
