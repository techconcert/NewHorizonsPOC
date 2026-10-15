// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  animStepMs,
  clampGlowRadius,
  createScaler,
  effectivePixelRatio,
  glowGainCompensation,
  isSoftwareRendererName,
  parseFx,
  rangeFillVisible,
  scaleIndexFor,
  scalerSample,
  scalerScale,
} from '../src/render/perf';
import { glowAlpha } from '../src/render/galaxyModel';

function feed(s: ReturnType<typeof createScaler>, ms: number, n: number): number {
  let changes = 0;
  for (let i = 0; i < n; i++) if (scalerSample(s, ms)) changes++;
  return changes;
}

describe('render scaler (D-127)', () => {
  it('picks the nearest step', () => {
    expect(scaleIndexFor(1)).toBe(0);
    expect(scaleIndexFor(0.7)).toBe(1);
    expect(scaleIndexFor(0.5)).toBe(2);
    expect(scaleIndexFor(0.3)).toBe(2);
  });

  it('steps down 1 -> 0.75 -> 0.5 when the EMA stays over 36 ms, then stops', () => {
    const s = createScaler(1);
    expect(scalerScale(s)).toBe(1);
    expect(feed(s, 50, 19)).toBe(0); // cooldown: nothing before 20 frames
    expect(feed(s, 50, 1)).toBe(1);
    expect(scalerScale(s)).toBe(0.75);
    expect(feed(s, 50, 20)).toBe(1);
    expect(scalerScale(s)).toBe(0.5);
    expect(feed(s, 80, 200)).toBe(0);
    expect(scalerScale(s)).toBe(0.5);
  });

  it('does not step down for a cost between 20 and 36 ms', () => {
    const s = createScaler(1);
    expect(feed(s, 30, 300)).toBe(0);
    expect(scalerScale(s)).toBe(1);
  });

  it('steps up only after 90 quiet frames under 20 ms, one step at a time', () => {
    const s = createScaler(0.5);
    expect(feed(s, 10, 89)).toBe(0);
    expect(feed(s, 10, 1)).toBe(1);
    expect(scalerScale(s)).toBe(0.75);
    expect(feed(s, 10, 89)).toBe(0);
    expect(feed(s, 10, 1)).toBe(1);
    expect(scalerScale(s)).toBe(1);
    expect(feed(s, 5, 500)).toBe(0);
  });

  it('does not step up when the predicted cost at the finer step is too high', () => {
    const s = createScaler(0.5);
    // 19 ms at 0.5 -> about 19 x (0.75/0.5)^2 = 42.75 ms at 0.75: stay.
    expect(feed(s, 19, 300)).toBe(0);
    expect(scalerScale(s)).toBe(0.5);
  });

  it('a pinned scaler keeps its exact scale', () => {
    const s = createScaler(0.6, true);
    expect(scalerScale(s)).toBe(0.6);
    expect(feed(s, 200, 100)).toBe(0);
    expect(scalerScale(s)).toBe(0.6);
  });

  it('ignores invalid samples', () => {
    const s = createScaler(1);
    expect(scalerSample(s, NaN)).toBe(false);
    expect(scalerSample(s, -5)).toBe(false);
  });

  it('pixel ratio is the capped device ratio times the scale', () => {
    expect(effectivePixelRatio(3, 1)).toBe(2);
    expect(effectivePixelRatio(2, 0.5)).toBe(1);
    expect(effectivePixelRatio(1, 0.75)).toBe(0.75);
    expect(effectivePixelRatio(0, 1)).toBe(1);
  });
});

describe('animation step, glow clamp, range fill (D-127)', () => {
  it('animation step is max(33, 1.5 x cost), fixed 66 on software GL', () => {
    expect(animStepMs(5, false)).toBe(33);
    expect(animStepMs(40, false)).toBe(60);
    expect(animStepMs(5, true)).toBe(66);
    expect(animStepMs(100, true)).toBe(66);
  });

  it('glow radius never covers more than 90 px', () => {
    expect(clampGlowRadius(46, 1)).toBe(46);
    expect(clampGlowRadius(46, 4)).toBe(22.5);
    expect(clampGlowRadius(46, 0)).toBe(46);
  });

  it('gain compensation is the square root of the shrink, at most 1.5', () => {
    expect(glowGainCompensation(46, 46)).toBe(1);
    expect(glowGainCompensation(40, 10)).toBe(1.5);
    expect(glowGainCompensation(20, 16)).toBeCloseTo(Math.sqrt(1.25), 10);
  });

  it('range fill is dropped past 0.6 x the viewport', () => {
    expect(rangeFillVisible(100, 4, 1000)).toBe(true); // 400 px
    expect(rangeFillVisible(150, 4, 1000)).toBe(true); // 600 px, exactly 0.6
    expect(rangeFillVisible(151, 4, 1000)).toBe(false);
  });

  it('the retuned glow still falls strictly from 1 to 0', () => {
    expect(glowAlpha(0)).toBe(1);
    expect(glowAlpha(1)).toBe(0);
    expect(glowAlpha(0.5)).toBeCloseTo(0.25 * 0.6, 10);
    let prev = 1;
    for (let i = 1; i <= 20; i++) {
      const a = glowAlpha(i / 20);
      expect(a).toBeLessThan(prev);
      prev = a;
    }
  });
});

describe('?fx= flags and software detection', () => {
  it('defaults when absent', () => {
    expect(parseFx('')).toEqual({
      noMsaa: false,
      scale: 0,
      noNebula: false,
      noGlow: false,
      noField: false,
    });
    expect(parseFx('?seed=3&debug')).toEqual(parseFx(''));
  });

  it('reads every flag', () => {
    expect(parseFx('?debug&fx=nomsaa,scale=0.5,nonebula,noglow,nofield')).toEqual({
      noMsaa: true,
      scale: 0.5,
      noNebula: true,
      noGlow: true,
      noField: true,
    });
  });

  it('clamps and rejects the scale', () => {
    expect(parseFx('?fx=scale=0.1').scale).toBe(0.25);
    expect(parseFx('?fx=scale=2').scale).toBe(0);
    expect(parseFx('?fx=scale=abc').scale).toBe(0);
  });

  it('recognises software renderers', () => {
    expect(isSoftwareRendererName('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))')).toBe(true);
    expect(isSoftwareRendererName('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareRendererName('Software Renderer')).toBe(true);
    expect(isSoftwareRendererName('ANGLE (Apple, Apple M2, OpenGL 4.1)')).toBe(false);
  });
});
