// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Terrain } from '../src/sim/components';
import { compileContent } from '../src/sim/content';

// galaxy.ts picks planet types by hard-coded index; regions.ts uses Terrain ids as table indices.
describe('content index coupling', () => {
  const c = compileContent();

  it('terrain names line up with the Terrain enum', () => {
    expect(c.terrainNames[Terrain.Plains]).toBe('Plains');
    expect(c.terrainNames[Terrain.Highlands]).toBe('Highlands');
    expect(c.terrainNames[Terrain.Jungle]).toBe('Jungle');
    expect(c.terrainNames[Terrain.Ice]).toBe('Ice');
    expect(c.terrainNames[Terrain.Crater]).toBe('Crater');
    expect(c.terrainNames[Terrain.Ruins]).toBe('Ruins');
    expect(c.terrainCount).toBe(6);
  });

  it('planet type indices used in galaxy.ts match planetTypes.json order', () => {
    const expected = ['Temperate', 'Arid', 'Jungle', 'Frozen', 'Barren', 'Ancient'];
    expect(c.planetTypeCount).toBe(expected.length);
    expected.forEach((name, i) => expect(c.planetTypeNames[i]).toBe(name));
  });
});
