// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AA_TEXT_RATIO,
  contrastRatio,
  flatten,
  luminance,
  parseColour,
  type Rgba,
} from '../src/ui/contrast';

const css = readFileSync(new URL('../src/ui/style.css', import.meta.url), 'utf8');

function blockAfter(marker: string): string {
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error('unbalanced braces');
}

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const dark = tokens(blockAfter(':root {'));
const light = { ...dark, ...tokens(blockAfter(":root[data-theme='light'] {")) };
const cbDark = { ...dark, ...tokens(blockAfter(":root[data-palette='cb'] {")) };
const cbLight = {
  ...light,
  ...tokens(blockAfter(":root[data-theme='light'][data-palette='cb'] {")),
};
const THEMES: Record<string, Record<string, string>> = {
  dark,
  light,
  'dark colour-blind': cbDark,
  'light colour-blind': cbLight,
};

function colour(t: Record<string, string>, name: string): Rgba {
  const c = parseColour(t[name]);
  if (c === null) throw new Error(`cannot parse ${name}: ${t[name]}`);
  return c;
}

describe('WCAG helpers', () => {
  it('parses hex and rgb(a)', () => {
    expect(parseColour('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColour('#05070d')).toEqual({ r: 5, g: 7, b: 13, a: 1 });
    expect(parseColour('rgba(12, 18, 32, 0.9)')).toEqual({ r: 12, g: 18, b: 32, a: 0.9 });
    expect(parseColour('rgb(1,2,3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseColour('red')).toBeNull();
  });

  it('matches known ratios', () => {
    const black = { r: 0, g: 0, b: 0, a: 1 };
    const white = { r: 255, g: 255, b: 255, a: 1 };
    expect(luminance(white)).toBeCloseTo(1, 6);
    expect(luminance(black)).toBe(0);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 6);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 6);
    // #767676 on white is the classic 4.54:1 pass; #777777 is 4.48:1 and fails.
    expect(contrastRatio({ r: 0x76, g: 0x76, b: 0x76, a: 1 }, white)).toBeCloseTo(4.54, 2);
    expect(contrastRatio({ r: 0x77, g: 0x77, b: 0x77, a: 1 }, white)).toBeCloseTo(4.48, 2);
  });

  it('flattens translucent colours over the backdrop', () => {
    const half = flatten({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0, a: 1 });
    expect(half.r).toBeCloseTo(127.5, 6);
    expect(half.a).toBe(1);
  });
});

describe('contrast of the text tokens in every theme (WCAG AA, 4.5:1)', () => {
  const TEXT = [
    '--text',
    '--dim',
    '--muted',
    '--accent',
    '--good',
    '--warn',
    '--bad',
    '--bad-soft',
    '--info',
    '--violet',
  ];
  for (const [name, t] of Object.entries(THEMES)) {
    it(`${name}: text tokens on the panel, the page and the translucent panel`, () => {
      const solid = colour(t, '--panel-solid');
      const backdrop = colour(t, '--bg');
      const failures: string[] = [];
      for (const bgName of ['--panel-solid', '--bg', '--panel']) {
        const bg = colour(t, bgName);
        for (const fg of TEXT) {
          const r = contrastRatio(colour(t, fg), bg, bgName === '--panel' ? backdrop : solid);
          if (r < AA_TEXT_RATIO) failures.push(`${fg} on ${bgName}: ${r.toFixed(2)}`);
        }
      }
      expect(failures).toEqual([]);
    });

    it(`${name}: button and badge pairs`, () => {
      const solid = colour(t, '--panel-solid');
      const failures: string[] = [];
      for (const [fg, bg] of [
        ['--accent-ink', '--accent'],
        ['--bad', '--bad-bg'],
        ['--bad-soft', '--bad-bg'],
        ['--text', '--panel-2'],
        ['--text', '--panel-hover'],
        ['--dim', '--panel-2'],
        ['--accent', '--accent-soft'],
      ]) {
        const r = contrastRatio(colour(t, fg), colour(t, bg), solid);
        if (r < AA_TEXT_RATIO) failures.push(`${fg} on ${bg}: ${r.toFixed(2)}`);
      }
      expect(failures).toEqual([]);
    });
  }

  it('the colour-blind palette changes the status colours and keeps the others', () => {
    for (const k of ['--good', '--warn', '--bad']) expect(cbDark[k]).not.toBe(dark[k]);
    expect(cbDark['--text']).toBe(dark['--text']);
    expect(cbLight['--text']).toBe(light['--text']);
  });
});

describe('status never rests on colour alone', () => {
  it('has a symbol rule for each margin, tier and fog state class', () => {
    for (const sel of [
      '.sl-margin-good::before',
      '.sl-margin-ok::before',
      '.sl-margin-bad::before',
      '.mc-num.good::before',
      '.mc-num.ok::before',
      '.mc-num.bad::before',
      '.pv-colony.tier-Thriving::before',
      '.pv-colony.tier-Struggling::before',
      '.pv-tier-failed::before',
      '.pv-item.pv-explored::before',
      '.pv-item.pv-seen::before',
      '.pv-item.pv-unknown::before',
    ]) {
      expect(css, sel).toContain(sel);
    }
  });

  it('uses three different symbols for good, caution and bad', () => {
    expect(css).toContain("content: '\\2713\\00a0'");
    expect(css).toContain("content: '\\25C6\\00a0'");
    expect(css).toContain("content: '\\2715\\00a0'");
  });
});
