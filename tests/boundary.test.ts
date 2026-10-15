import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDirs: string[] = [];

afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

/** Build a temp fixture tree where `fromDir` imports `toDir`, and run depcruise on it. */
function cruiseFixture(fromDir: string, toDir: string): number | null {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'colony-boundary-'));
  tmpDirs.push(tmp);
  fs.mkdirSync(path.join(tmp, 'src', fromDir), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'src', toDir), { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, '.dependency-cruiser.cjs'),
    path.join(tmp, '.dependency-cruiser.cjs'),
  );
  fs.writeFileSync(
    path.join(tmp, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler' } }),
  );
  fs.writeFileSync(path.join(tmp, 'src', toDir, 'target.ts'), 'export const x = 1;\n');
  fs.writeFileSync(
    path.join(tmp, 'src', fromDir, 'bad.ts'),
    `import { x } from '../${toDir}/target';\nexport const y = x;\n`,
  );
  const bin = path.join(
    repoRoot,
    'node_modules',
    'dependency-cruiser',
    'bin',
    'dependency-cruiser.mjs',
  );
  const r = spawnSync('node', [bin, 'src', '--config', '.dependency-cruiser.cjs'], {
    cwd: tmp,
    encoding: 'utf8',
  });
  return r.status;
}

describe('boundaries', () => {
  it('depcruise fails when src/sim imports src/render (fixture tree in OS temp dir)', () => {
    const status = cruiseFixture('sim', 'render');
    expect(status).not.toBe(0);
    expect(status).not.toBeNull();
  });

  it('depcruise fails when src/render imports src/sim (fixture tree in OS temp dir)', () => {
    const status = cruiseFixture('render', 'sim');
    expect(status).not.toBe(0);
    expect(status).not.toBeNull();
  });

  it('depcruise fails when src/shared imports src/sim (fixture tree in OS temp dir)', () => {
    const status = cruiseFixture('shared', 'sim');
    expect(status).not.toBe(0);
    expect(status).not.toBeNull();
  });

  it('depcruise fails when src/ui imports src/data directly', () => {
    const status = cruiseFixture('ui', 'data');
    expect(status).not.toBe(0);
    expect(status).not.toBeNull();
  });

  it('depcruise allows src/shared to import src/data and src/sim to import src/shared', () => {
    expect(cruiseFixture('shared', 'data')).toBe(0);
    expect(cruiseFixture('sim', 'shared')).toBe(0);
  });
});
