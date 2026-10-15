// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  arrowTarget,
  createAnnouncer,
  nextSystem,
  systemAnnouncement,
  trapTarget,
} from '../src/ui/navModel';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('arrow key navigation', () => {
  it('moves down and up with wrap in a vertical list', () => {
    expect(arrowTarget('ArrowDown', 0, 3)).toBe(1);
    expect(arrowTarget('ArrowDown', 2, 3)).toBe(0);
    expect(arrowTarget('ArrowUp', 0, 3)).toBe(2);
    expect(arrowTarget('ArrowUp', 2, 3)).toBe(1);
    expect(arrowTarget('ArrowRight', 0, 3)).toBe(-1);
  });

  it('horizontal groups use left and right', () => {
    expect(arrowTarget('ArrowRight', 0, 4, 'horizontal')).toBe(1);
    expect(arrowTarget('ArrowLeft', 0, 4, 'horizontal')).toBe(3);
    expect(arrowTarget('ArrowDown', 0, 4, 'horizontal')).toBe(-1);
    expect(arrowTarget('ArrowDown', 0, 4, 'both')).toBe(1);
    expect(arrowTarget('ArrowLeft', 1, 4, 'both')).toBe(0);
  });

  it('Home and End jump; other keys and empty lists do nothing', () => {
    expect(arrowTarget('Home', 2, 5)).toBe(0);
    expect(arrowTarget('End', 2, 5)).toBe(4);
    expect(arrowTarget('a', 2, 5)).toBe(-1);
    expect(arrowTarget('ArrowDown', 0, 0)).toBe(-1);
  });

  it('from outside the list, down goes to the first and up to the last', () => {
    expect(arrowTarget('ArrowDown', -1, 4)).toBe(0);
    expect(arrowTarget('ArrowUp', -1, 4)).toBe(3);
  });
});

describe('focus trap', () => {
  it('wraps Tab at the ends and leaves the middle to the browser', () => {
    expect(trapTarget(2, 3, false)).toBe(0);
    expect(trapTarget(0, 3, true)).toBe(2);
    expect(trapTarget(1, 3, false)).toBe(-1);
    expect(trapTarget(1, 3, true)).toBe(-1);
  });

  it('pulls focus in when it is outside, and does nothing for an empty dialog', () => {
    expect(trapTarget(-1, 3, false)).toBe(0);
    expect(trapTarget(-1, 3, true)).toBe(2);
    expect(trapTarget(-1, 0, false)).toBe(-1);
  });
});

describe('announcer', () => {
  it('joins the sentences of one flush and skips empty flushes', () => {
    const out: string[] = [];
    const a = createAnnouncer((t) => out.push(t));
    a.flush();
    a.say('One.');
    a.say('Two.');
    a.say('One.');
    a.say('');
    a.flush();
    expect(out).toEqual(['One. Two.']);
  });

  it('changes a repeated message so the live region speaks again', () => {
    const out: string[] = [];
    const a = createAnnouncer((t) => out.push(t));
    a.say('Colony founded.');
    a.flush();
    a.say('Colony founded.');
    a.flush();
    expect(out).toEqual(['Colony founded.', 'Colony founded. ']);
  });

  it('clear drops what is queued', () => {
    const out: string[] = [];
    const a = createAnnouncer((t) => out.push(t));
    a.say('Old world.');
    a.clear();
    a.flush();
    expect(out).toEqual([]);
  });
});

describe('star chooser on the map', () => {
  it('steps through the systems with wrap', () => {
    expect(nextSystem(-1, 10, 1)).toBe(0);
    expect(nextSystem(-1, 10, -1)).toBe(9);
    expect(nextSystem(9, 10, 1)).toBe(0);
    expect(nextSystem(0, 10, -1)).toBe(9);
    expect(nextSystem(3, 10, 1)).toBe(4);
    expect(nextSystem(3, 0, 1)).toBe(-1);
  });

  it('announces the system', () => {
    expect(systemAnnouncement(12, 'Yellow star', 3, false)).toBe(
      'System 12: Yellow star, 3 planets.',
    );
    expect(systemAnnouncement(0, 'Red dwarf', 1, true)).toBe(
      'System 0 (homeworld): Red dwarf, 1 planet.',
    );
  });
});

describe('page structure and build settings', () => {
  it('index.html has a main landmark that the skip link can target', () => {
    const html = read('index.html');
    expect(html).toContain('<main id="main-content"');
    expect(html).toContain('lang="en"');
    expect(html).toContain('width=device-width');
  });

  it('the build uses relative URLs and no source maps', () => {
    const cfg = read('vite.config.ts');
    expect(cfg).toContain("base: './'");
    expect(cfg).toContain('sourcemap: false');
  });

  it('the README covers running, building, hosting, controls and limits', () => {
    expect(existsSync(new URL('../README.md', import.meta.url))).toBe(true);
    const md = read('README.md');
    for (const part of [
      'npm run dev',
      'npm run build',
      'npm run preview',
      'GitHub Pages',
      'Controls',
      'Known limits',
    ]) {
      expect(md, part).toContain(part);
    }
  });

  it('npm run preview exists', () => {
    expect(JSON.parse(read('package.json')).scripts.preview).toBeTypeOf('string');
  });

  it('main.ts sends no data over the network', () => {
    for (const f of [
      'src/main.ts',
      'src/ui/errorLog.ts',
      'src/ui/settingsPanel.ts',
      'src/ui/saveIo.ts',
    ]) {
      const src = read(f);
      expect(src, f).not.toMatch(/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
    }
  });

  it('settings are the only thing written to localStorage', () => {
    const uses: string[] = [];
    for (const f of readdirSync(new URL('../src', import.meta.url), {
      recursive: true,
    }) as string[]) {
      if (!f.endsWith('.ts')) continue;
      // Comments may name it ("never localStorage"); only code counts.
      const code = read(`src/${f}`)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      if (/localStorage|sessionStorage/.test(code)) uses.push(`src/${f}`);
    }
    expect(uses).toEqual(['src/ui/settingsModel.ts']);
  });
});
