// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { GameSpeed } from '../src/shared/commands';
import { createAutoPause } from '../src/ui/visibility';

function make(initial: GameSpeed = 1) {
  const sent: GameSpeed[] = [];
  return { sent, ap: createAutoPause((s) => void sent.push(s), initial) };
}

describe('auto pause', () => {
  it('hide at 4x then show restores 4x', () => {
    const { sent, ap } = make();
    ap.userSpeed(4);
    ap.hidden();
    ap.shown();
    expect(sent).toEqual([4, 0, 4]);
  });
  it('user paused then hide/show stays paused', () => {
    const { sent, ap } = make();
    ap.userSpeed(0);
    ap.hidden();
    ap.shown();
    expect(sent).toEqual([0]);
  });
  it('rapid show/hide before any snapshot is consistent', () => {
    const { sent, ap } = make(2);
    ap.shown();
    ap.hidden();
    ap.hidden();
    ap.shown();
    ap.hidden();
    ap.shown();
    expect(sent).toEqual([0, 2, 0, 2]);
  });
  it('user speed change while hidden is not overridden by show', () => {
    const { sent, ap } = make();
    ap.userSpeed(2);
    ap.hidden();
    ap.userSpeed(4);
    ap.shown();
    expect(sent).toEqual([2, 0, 4]);
  });
});
