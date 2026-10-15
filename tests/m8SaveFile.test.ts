// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, SIM_VERSION, type SaveData } from '../src/shared/save';
import {
  exportSaveText,
  parseSaveFile,
  SAVE_FILE_ARGS,
  SAVE_FILE_FORMAT,
  SAVE_FILE_MAX_BYTES,
  SAVE_FILE_MAX_ENTRIES,
  saveFileName,
} from '../src/shared/saveFile';
import { COMMAND_LOG_CAPACITY, COMMAND_MAX_ARGS } from '../src/sim/components';
import { createSave, loadSave } from '../src/sim/save';
import { applyCommandsNow, tickDay } from '../src/sim/tick';
import { createWorld, submit } from '../src/sim/world';

/** A short real game with a few logged commands. */
function realSave(): SaveData {
  const w = createWorld(7);
  submit(w, { type: 'ChooseTech', tech: 3 });
  applyCommandsNow(w);
  for (let i = 0; i < 12; i++) tickDay(w);
  submit(w, { type: 'SetGameSpeed', speed: 2 });
  applyCommandsNow(w);
  for (let i = 0; i < 5; i++) tickDay(w);
  return createSave(w);
}

function parsed(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

function expectError(text: string, part: string): void {
  const r = parseSaveFile(text);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toContain(part);
}

describe('save file limits match the simulation', () => {
  it('uses the same log capacity and argument count', () => {
    expect(SAVE_FILE_MAX_ENTRIES).toBe(COMMAND_LOG_CAPACITY);
    expect(SAVE_FILE_ARGS).toBe(COMMAND_MAX_ARGS);
  });
});

describe('export and import', () => {
  it('round-trips a real save and replays to the same state hash', () => {
    const data = realSave();
    expect(data.logDay.length).toBeGreaterThan(0);
    const text = exportSaveText(data);
    const r = parseSaveFile(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.seed).toBe(data.seed);
    expect(r.data.day).toBe(data.day);
    expect(r.data.stateHash).toBe(data.stateHash);
    expect(Array.from(r.data.logDay)).toEqual(Array.from(data.logDay));
    expect(Array.from(r.data.logType)).toEqual(Array.from(data.logType));
    expect(Array.from(r.data.logArgs)).toEqual(Array.from(data.logArgs));
    expect(r.data.logDay).toBeInstanceOf(Int32Array);
    expect(r.data.logType).toBeInstanceOf(Uint8Array);
    // The existing replay verification accepts it.
    const w = loadSave(r.data);
    expect(w.stores.run.stateHash[0]).toBe(data.stateHash);
  });

  it('writes the marker, versions and a descriptive file name', () => {
    const data = realSave();
    const o = parsed(exportSaveText(data));
    expect(o.format).toBe(SAVE_FILE_FORMAT);
    expect(o.fileVersion).toBe(1);
    expect(o.version).toBe(SAVE_VERSION);
    expect(o.simVersion).toBe(SIM_VERSION);
    expect(saveFileName({ ...data, seed: 42, day: 120 })).toBe('colony-ship-seed42-day120.json');
  });

  it('a hand-edited state hash passes the shape check but fails the replay check', () => {
    const o = parsed(exportSaveText(realSave()));
    o.stateHash = (o.stateHash as number) + 1;
    const r = parseSaveFile(JSON.stringify(o));
    expect(r.ok).toBe(true);
    if (r.ok) expect(() => loadSave(r.data)).toThrow('hash mismatch');
  });
});

describe('import validation messages', () => {
  const good = (): Record<string, unknown> => parsed(exportSaveText(realSave()));

  it('empty and non-JSON files', () => {
    expectError('', 'empty');
    expectError('   \n', 'empty');
    expectError('not json at all', 'not valid JSON');
  });

  it('too large', () => {
    expectError('x'.repeat(SAVE_FILE_MAX_BYTES + 1), 'too large');
  });

  it('wrong kind of JSON', () => {
    expectError('[1,2,3]', 'does not hold a save object');
    expectError('null', 'does not hold a save object');
    expectError('{"hello":1}', 'format marker');
  });

  it('version mismatches', () => {
    expectError(JSON.stringify({ ...good(), fileVersion: 9 }), 'file format version 9');
    expectError(JSON.stringify({ ...good(), version: 1 }), 'save format 1');
    const msg = `simulation version 1, but this game runs version ${SIM_VERSION}`;
    expectError(JSON.stringify({ ...good(), simVersion: 1 }), msg);
    expectError(JSON.stringify({ ...good(), simVersion: 'x' }), 'simulation version');
  });

  it('damaged header', () => {
    expectError(JSON.stringify({ ...good(), seed: 1.5 }), '(seed)');
    expectError(JSON.stringify({ ...good(), day: -1 }), '(day)');
    expectError(JSON.stringify({ ...good(), day: 1e9 }), '(day)');
    expectError(JSON.stringify({ ...good(), stateHash: 'x' }), '(hashes)');
    expectError(JSON.stringify({ ...good(), contentHash: null }), '(hashes)');
  });

  it('damaged log', () => {
    const o = good();
    expectError(JSON.stringify({ ...o, log: null }), 'command log missing');
    expectError(
      JSON.stringify({ ...o, log: { day: [0], type: [1], args: [0] } }),
      'sizes do not match',
    );
    expectError(
      JSON.stringify({ ...o, log: { day: [0], type: [999], args: new Array(9).fill(0) } }),
      'entries',
    );
    expectError(
      JSON.stringify({ ...o, log: { day: ['a'], type: [1], args: new Array(9).fill(0) } }),
      'entries',
    );
    expectError(
      JSON.stringify({
        ...o,
        day: 5,
        log: { day: [3, 2], type: [1, 1], args: new Array(18).fill(0) },
      }),
      'order',
    );
    expectError(
      JSON.stringify({ ...o, day: 5, log: { day: [9], type: [1], args: new Array(9).fill(0) } }),
      'order',
    );
  });

  it('an empty log is a valid save of a game with no commands', () => {
    const o = good();
    const r = parseSaveFile(JSON.stringify({ ...o, log: { day: [], type: [], args: [] } }));
    expect(r.ok).toBe(true);
  });
});
