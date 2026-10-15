// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMPACT_WIDTH_PX,
  NARROW_WIDTH_PX,
  PANEL_COLUMN_COMPACT_PX,
  PANEL_COLUMN_PX,
  computeViewArea,
  createViewArea,
  panelColumnPx,
} from '../src/render/viewArea';
import { createAccordion } from '../src/ui/accordion';
import { clockShort, colonyShort, goalShort, researchShort } from '../src/ui/hudText';
import { createThemeState, themeButtonLabel } from '../src/ui/theme';
import {
  createSnapshot,
  META_HOME_DAYS,
  META_TECH_CURRENT,
  META_WIN_STREAK,
} from '../src/shared/snapshot';

const css = readFileSync(new URL('../src/ui/style.css', import.meta.url), 'utf8');

/** Custom properties declared in the first block that starts with `selector {`. */
function declared(block: string): string[] {
  return [...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
}

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

describe('accordion for the Colonies and Research sections', () => {
  it('starts with the initial section open and ignores an unknown initial key', () => {
    const a = createAccordion(['colonies', 'research'], 'colonies');
    expect(a.isOpen('colonies')).toBe(true);
    expect(a.isOpen('research')).toBe(false);
    expect(createAccordion(['a'], 'zzz').openKey()).toBeNull();
    expect(createAccordion(['a'], null).openKey()).toBeNull();
  });

  it('opening one section closes the other', () => {
    const a = createAccordion(['colonies', 'research'], 'colonies');
    expect(a.set('research', true)).toBe(true);
    expect(a.isOpen('research')).toBe(true);
    expect(a.isOpen('colonies')).toBe(false);
    expect(a.openKey()).toBe('research');
  });

  it('closing the open section leaves none open; closing a closed one changes nothing', () => {
    const a = createAccordion(['colonies', 'research'], 'research');
    expect(a.set('colonies', false)).toBe(false);
    expect(a.openKey()).toBe('research');
    expect(a.set('research', false)).toBe(true);
    expect(a.openKey()).toBeNull();
    expect(a.set('research', false)).toBe(false);
  });

  it('ignores keys outside the group and tells listeners only about real changes', () => {
    const a = createAccordion(['x', 'y'], null);
    let calls = 0;
    const off = a.subscribe(() => calls++);
    expect(a.set('nope', true)).toBe(false);
    a.set('x', true);
    a.set('x', true);
    a.set('y', true);
    expect(calls).toBe(2);
    off();
    a.set('x', true);
    expect(calls).toBe(2);
  });
});

describe('planet view keeps clear of the panel column', () => {
  it('uses the compact column up to 1100 px and the full one above', () => {
    expect(panelColumnPx(1024)).toBe(PANEL_COLUMN_COMPACT_PX);
    expect(panelColumnPx(COMPACT_WIDTH_PX)).toBe(PANEL_COLUMN_COMPACT_PX);
    expect(panelColumnPx(1280)).toBe(PANEL_COLUMN_PX);
    expect(panelColumnPx(1440)).toBe(PANEL_COLUMN_PX);
  });

  it('the map area is the screen minus that column at 1024, 1280 and 1440 wide', () => {
    for (const [w, h] of [
      [1024, 700],
      [1280, 800],
      [1440, 900],
    ]) {
      const a = computeViewArea(w, h, createViewArea());
      expect(a.width).toBe(w - panelColumnPx(w));
      expect(a.cx + a.width / 2).toBe(w - panelColumnPx(w));
    }
    expect(NARROW_WIDTH_PX).toBeLessThan(1024);
  });
});

describe('style.css theme', () => {
  it('defines the dark tokens on :root and a light variant with the same colour tokens', () => {
    const dark = declared(blockAfter(':root {'));
    const light = declared(blockAfter(":root[data-theme='light'] {"));
    for (const name of [
      '--bg',
      '--panel',
      '--line',
      '--text',
      '--dim',
      '--accent',
      '--accent-ink',
      '--warn',
      '--bad',
      '--focus',
      '--s2',
      '--r-md',
      '--fs-md',
      '--hud-h',
    ]) {
      expect(dark).toContain(name);
    }
    for (const name of light) expect(dark).toContain(name);
    for (const name of ['--panel', '--line', '--text', '--dim', '--accent', '--warn', '--bad']) {
      expect(light).toContain(name);
    }
    expect(css).not.toContain('prefers-color-scheme');
    expect(css).toContain('prefers-reduced-motion');
  });

  it('loads nothing from outside: no imports, urls or web fonts', () => {
    expect(css).not.toMatch(/@import/);
    expect(css).not.toMatch(/url\(/);
    expect(css).not.toMatch(/@font-face/);
    expect(css).not.toMatch(/https?:/);
  });

  it('keeps raw colours out of the rules: hex and rgb only appear in token blocks', () => {
    const noTokens = css
      .replace(blockAfter(':root {'), '')
      .replace(blockAfter(":root[data-theme='light'] {"), '')
      .replace(blockAfter(":root[data-palette='cb'] {"), '')
      .replace(blockAfter(":root[data-theme='light'][data-palette='cb'] {"), '');
    const stray = noTokens.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? [];
    expect(stray).toEqual([]);
  });

  it('has focus rings, the three button styles and the fixed-height bar', () => {
    expect(css).toContain(':focus-visible');
    expect(css).toContain('.hud-btn--danger');
    expect(css).toContain('.hud-btn--primary');
    expect(css).toMatch(/\.hud-bar \{[^}]*height: var\(--hud-h\)/);
    expect(css).toMatch(/\.mc-panel \{[^}]*top: calc\(var\(--hud-h\)/);
    expect(css).toMatch(/\.hud-col-right \{[^}]*top: calc\(var\(--hud-h\)/);
  });
});

describe('dark by default, light only on request', () => {
  it('starts dark and toggles in memory', () => {
    const t = createThemeState();
    expect(t.current()).toBe('dark');
    expect(themeButtonLabel(t.current())).toBe('Light theme');
    expect(t.toggle()).toBe('light');
    expect(themeButtonLabel(t.current())).toBe('Dark theme');
    expect(t.toggle()).toBe('dark');
  });

  it('never follows the system scheme and never stores the choice', () => {
    expect(css).not.toMatch(/prefers-color-scheme/);
    const src = readFileSync(new URL('../src/ui/theme.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });

  it('a hidden element stays hidden whatever display rule it has', () => {
    expect(css).toMatch(/\[hidden\] \{\s*display: none !important;/);
  });
});

describe('short top-bar labels', () => {
  it('give compact values for a fresh game', () => {
    const snap = createSnapshot();
    snap.meta[META_HOME_DAYS] = 1200;
    snap.meta[META_TECH_CURRENT] = -1;
    expect(clockShort(snap)).toBe('Home: 1200d');
    expect(colonyShort(snap)).toBe('Colonies 0/10');
    expect(researchShort(snap)).toBe('Tech: none');
    expect(goalShort(snap)).toBe('Goal: hold 10');
    snap.meta[META_WIN_STREAK] = 12;
    expect(goalShort(snap)).toBe('Goal 12/90d');
  });

  it('switch to the short labels under 1500 px in the CSS', () => {
    expect(css).toMatch(/@media \(max-width: 1499px\)/);
  });
});
