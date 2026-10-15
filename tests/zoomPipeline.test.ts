// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  InstancedBufferAttribute,
  type InstancedMesh,
  type LineSegments,
  Scene,
  type Group,
} from 'three';
import {
  buildSimpleSiteGeometry,
  buildSiteGeometry,
  SIMPLE_MODEL_COUNT,
} from '../src/render/propModels';
import { createSystemLayer, MAX_SYSTEM_PLANETS } from '../src/render/systemLayer';
import {
  MISSION_PANEL_PX,
  computeSystemArea,
  computeViewArea,
  createViewArea,
} from '../src/render/viewArea';
import {
  COLONY_MIN_DISTANCE,
  ENTER_SCALE_RATIO,
  HAB_BAND_COLORS,
  LOD_CROWD_MAX,
  LOD_SIMPLE_DISTRICTS_MIN,
  LOD_SMALL_PROPS_MAX,
  MIN_FIT_RADIUS,
  PLANET_RADIUS,
  PLANET_SIZE_SPREAD,
  RING_DASHED,
  RING_DOUBLE,
  RING_HALO,
  RING_THIN,
  SURVEY_LOOKS,
  ZoomLevel,
  clamp01,
  colonyZoomBlend,
  createFit,
  createLod,
  createSlide,
  dollyFactor,
  easeInOutCubic,
  easeOutCubic,
  focusView,
  galaxyFade,
  habBand,
  knownBounds,
  lerp,
  lerpScale,
  lodFor,
  orbitRadius,
  planetAngle,
  planetOffset,
  planetSizeJitter,
  slideDone,
  slidePos,
  slideStart,
  smoothstep,
  surveyLook,
  systemExtent,
  systemFade,
  systemFitScale,
  vignetteStrength,
  wheelEntersSystem,
  type ViewTransform,
} from '../src/render/zoom';

describe('easing and slides', () => {
  it('easing hits its end points and is monotonic', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBe(0.5);
    expect(easeInOutCubic(0.25)).toBeCloseTo(0.0625, 10);
    expect(easeInOutCubic(0.75)).toBeCloseTo(0.9375, 10);
    expect(easeInOutCubic(-3)).toBe(0);
    expect(easeInOutCubic(9)).toBe(1);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 10);
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const v = easeInOutCubic(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('smoothstep, clamp and lerp helpers', () => {
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(2, 4, 1)).toBe(0);
    expect(smoothstep(2, 4, 9)).toBe(1);
    expect(smoothstep(3, 3, 3)).toBe(1);
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(lerpScale(10, 40, 0.5)).toBeCloseTo(20, 10);
    expect(lerpScale(10, 40, 0)).toBe(10);
    expect(lerpScale(10, 40, 1)).toBeCloseTo(40, 10);
  });

  it('a slide is a linear function of real time', () => {
    const s = createSlide(0);
    slideStart(s, 1000, 1, 800, false, 0);
    expect(slidePos(s, 1000)).toBe(0);
    expect(slidePos(s, 1200)).toBe(0.25);
    expect(slidePos(s, 1400)).toBe(0.5);
    expect(slidePos(s, 1800)).toBe(1);
    expect(slidePos(s, 99999)).toBe(1);
    expect(slideDone(s, 1799)).toBe(false);
    expect(slideDone(s, 1800)).toBe(true);
    // Same inputs, same outputs: nothing depends on how often it is asked.
    expect(slidePos(s, 1400)).toBe(slidePos(s, 1400));
  });

  it('reversing half way takes half as long and starts where it stands', () => {
    const s = createSlide(0);
    slideStart(s, 1000, 1, 800, false, 0);
    const mid = slidePos(s, 1400);
    slideStart(s, 1400, 0, 800, false, mid);
    expect(slidePos(s, 1400)).toBe(0.5);
    expect(slidePos(s, 1600)).toBe(0.25);
    expect(slidePos(s, 1800)).toBe(0);
    expect(slideDone(s, 1800)).toBe(true);
  });

  it('prefers-reduced-motion makes every slide instant', () => {
    const s = createSlide(0);
    slideStart(s, 500, 1, 800, true, 0);
    expect(slidePos(s, 500)).toBe(1);
    expect(slideDone(s, 500)).toBe(true);
    slideStart(s, 600, 0, 450, true, 1);
    expect(slidePos(s, 600)).toBe(0);
    expect(slideDone(s, 600)).toBe(true);
  });

  it('names the four zoom levels in order', () => {
    expect([ZoomLevel.Galaxy, ZoomLevel.System, ZoomLevel.Orbit, ZoomLevel.Colony]).toEqual([
      0, 1, 2, 3,
    ]);
  });
});

describe('system zoom camera', () => {
  const from: ViewTransform = { cx: 500, cy: 500, scale: 1 };
  const out: ViewTransform = { cx: 0, cy: 0, scale: 1 };

  it('starts at the galaxy view and ends centred on the star at the target scale', () => {
    focusView(from, 600, 500, 0, 0, 4, 0, out);
    expect(out).toEqual({ cx: 500, cy: 500, scale: 1 });
    focusView(from, 600, 500, 0, 0, 4, 1, out);
    expect(out.cx).toBeCloseTo(600, 10);
    expect(out.cy).toBeCloseTo(500, 10);
    expect(out.scale).toBeCloseTo(4, 10);
  });

  it('the star glides along a straight screen line while the scale grows evenly', () => {
    focusView(from, 600, 500, 0, 0, 4, 0.5, out);
    expect(out.scale).toBeCloseTo(2, 10);
    expect(out.cx).toBeCloseTo(575, 10);
    // The star sits 50 px right of the screen centre: halfway between 100 px and 0.
    expect((600 - out.cx) * out.scale).toBeCloseTo(50, 10);
  });

  it('can park the star off centre, clear of the panels', () => {
    focusView(from, 600, 500, -100, 40, 4, 1, out);
    expect((600 - out.cx) * out.scale).toBeCloseTo(-100, 10);
    // y is flipped on screen: the star ends 40 px below the centre.
    expect(-(500 - out.cy) * out.scale).toBeCloseTo(40, 10);
    expect(out.cx).toBeCloseTo(625, 10);
    expect(out.cy).toBeCloseTo(510, 10);
  });

  it('fades the galaxy out and the system in at different moments', () => {
    expect(galaxyFade(0)).toBe(1);
    expect(galaxyFade(0.55)).toBe(0);
    expect(galaxyFade(1)).toBe(0);
    expect(galaxyFade(0.3)).toBeGreaterThan(0);
    expect(galaxyFade(0.3)).toBeLessThan(1);
    expect(systemFade(0.3)).toBe(0);
    expect(systemFade(0.85)).toBe(1);
    expect(systemFade(0.575)).toBeCloseTo(0.5, 10);
    // The cross-fade never goes fully dark (the focused sun stays lit as well).
    for (let i = 0; i <= 20; i++)
      expect(galaxyFade(i / 20) + systemFade(i / 20)).toBeGreaterThan(0.2);
  });

  it('the wheel enters a system only over the selected star, zoomed in, after a firm roll', () => {
    expect(ENTER_SCALE_RATIO).toBe(3);
    expect(wheelEntersSystem(true, 3, 100)).toBe(true);
    expect(wheelEntersSystem(false, 5, 500)).toBe(false);
    expect(wheelEntersSystem(true, 2.9, 500)).toBe(false);
    expect(wheelEntersSystem(true, 5, 99)).toBe(false);
  });
});

describe('orbit layout', () => {
  it('orbits step outwards and the extent holds the last one', () => {
    expect(orbitRadius(0)).toBe(34);
    expect(orbitRadius(1)).toBe(51);
    expect(orbitRadius(4)).toBe(102);
    expect(systemExtent(5)).toBe(116);
    expect(systemExtent(1)).toBe(48);
    expect(systemExtent(0)).toBe(48);
  });

  it('angles are a fixed function of system and slot, spread over the circle', () => {
    for (let slot = 0; slot < 5; slot++) {
      const a = planetAngle(7, slot);
      expect(a).toBe(planetAngle(7, slot));
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(Math.PI * 2);
    }
    expect(planetAngle(7, 0)).not.toBe(planetAngle(7, 1));
    expect(planetAngle(7, 0)).not.toBe(planetAngle(8, 0));
  });

  it('planet offsets lie on their orbit radius', () => {
    const o = new Float32Array(4);
    planetOffset(3, 2, o, 0);
    planetOffset(3, 4, o, 2);
    expect(Math.hypot(o[0], o[1])).toBeCloseTo(orbitRadius(2), 3);
    expect(Math.hypot(o[2], o[3])).toBeCloseTo(orbitRadius(4), 3);
  });

  it('the fit scale puts the outer orbit inside the free area', () => {
    const s = systemFitScale(5, 800, 600);
    expect(s).toBeCloseTo(258 / 116, 10);
    expect(systemExtent(5) * s).toBeLessThan(300);
    // A wide area is limited by its height, a tall one by its width.
    expect(systemFitScale(5, 2000, 600)).toBe(s);
    expect(systemFitScale(5, 600, 2000)).toBe(s);
    // Fewer planets zoom closer.
    expect(systemFitScale(2, 800, 600)).toBeGreaterThan(s);
  });

  it('the system area keeps clear of both panels on wide screens', () => {
    const a = createViewArea();
    computeSystemArea(1440, 900, a);
    expect(a.width).toBe(1440 - MISSION_PANEL_PX - 436);
    expect(a.cx).toBe(MISSION_PANEL_PX + a.width / 2);
    expect(a.cy).toBe(450);
    // Too little room left over: fall back to the planet map's area.
    const b = createViewArea();
    computeSystemArea(1000, 800, b);
    const c = computeViewArea(1000, 800, createViewArea());
    expect(b.width).toBe(c.width);
    expect(b.cx).toBe(c.cx);
    // Narrow screens stack the panels: same area as the planet map.
    const d = computeSystemArea(700, 900, createViewArea());
    expect(d.width).toBe(700);
  });
});

describe('planet look', () => {
  it('sizes vary a little and deterministically', () => {
    for (let p = 0; p < 40; p++) {
      const j = planetSizeJitter(p);
      expect(j).toBe(planetSizeJitter(p));
      expect(j).toBeGreaterThanOrEqual(1 - PLANET_SIZE_SPREAD);
      expect(j).toBeLessThanOrEqual(1 + PLANET_SIZE_SPREAD);
    }
    expect(PLANET_RADIUS).toBeGreaterThan(0);
  });

  it('habitability bands follow the midpoint of the known range', () => {
    expect(habBand(0, 20)).toBe(0);
    expect(habBand(10, 40)).toBe(1);
    expect(habBand(20, 40)).toBe(1);
    expect(habBand(0, 100)).toBe(2);
    expect(habBand(60, 100)).toBe(3);
    expect(HAB_BAND_COLORS.length).toBe(4);
    expect(new Set(HAB_BAND_COLORS).size).toBe(4);
  });

  it('survey levels differ in colour, brightness, size and ring shape', () => {
    expect(SURVEY_LOOKS.map((l) => l.name)).toEqual(['Unknown', 'Scanned', 'Surveyed', 'Explored']);
    for (let i = 1; i < SURVEY_LOOKS.length; i++) {
      expect(SURVEY_LOOKS[i].sat).toBeGreaterThan(SURVEY_LOOKS[i - 1].sat);
      expect(SURVEY_LOOKS[i].light).toBeGreaterThan(SURVEY_LOOKS[i - 1].light);
      expect(SURVEY_LOOKS[i].size).toBeGreaterThan(SURVEY_LOOKS[i - 1].size);
    }
    expect(SURVEY_LOOKS.map((l) => l.ring)).toEqual([
      RING_DASHED,
      RING_THIN,
      RING_DOUBLE,
      RING_HALO,
    ]);
    expect(SURVEY_LOOKS[0].sat).toBe(0);
    expect(surveyLook(-4)).toBe(SURVEY_LOOKS[0]);
    expect(surveyLook(9)).toBe(SURVEY_LOOKS[3]);
  });
});

describe('planet map framing', () => {
  it('frames the known hexes, not the hidden ones', () => {
    const centres = new Float32Array([0, 0, 0, 4, 0, 0, 0, 0, 3, 100, 0, 100]);
    const fog = new Uint8Array([3, 1, 0, 0]);
    const fit = knownBounds(centres, fog, 4, 1, createFit());
    expect(fit.cx).toBe(2);
    expect(fit.cz).toBe(0);
    expect(fit.radius).toBe(3);
  });

  it('never frames tighter than the minimum, and falls back to the whole map when nothing is known', () => {
    const centres = new Float32Array([0, 0, 0, 100, 0, 100]);
    expect(knownBounds(centres, new Uint8Array([3, 0]), 2, 1, createFit()).radius).toBe(
      MIN_FIT_RADIUS,
    );
    const all = knownBounds(centres, new Uint8Array([0, 0]), 2, 1, createFit());
    expect(all.cx).toBe(50);
    expect(all.cz).toBe(50);
    expect(all.radius).toBeCloseTo(Math.hypot(50, 50) + 1, 4);
    expect(knownBounds(centres, new Uint8Array([0, 0]), 0, 1, createFit()).radius).toBe(
      MIN_FIT_RADIUS,
    );
  });
});

describe('colony zoom and level of detail', () => {
  it('blends the close-up in between the far and near distances', () => {
    expect(colonyZoomBlend(8.4)).toBe(0);
    expect(colonyZoomBlend(7)).toBe(0);
    expect(colonyZoomBlend(5.75)).toBeCloseTo(0.5, 10);
    expect(colonyZoomBlend(4.5)).toBe(1);
    expect(colonyZoomBlend(COLONY_MIN_DISTANCE)).toBe(1);
  });

  it('the vignette follows the blend and is off in the base view', () => {
    expect(vignetteStrength(0)).toBe(0);
    expect(vignetteStrength(0.5)).toBeCloseTo(0.45, 10);
    expect(vignetteStrength(1)).toBeCloseTo(0.9, 10);
    expect(vignetteStrength(3)).toBeCloseTo(0.9, 10);
  });

  it('drops crowd dots, then small props, then swaps to simple districts as the camera pulls back', () => {
    const lod = createLod();
    expect(lodFor(8, lod)).toBe(false);
    expect(lod).toEqual({ crowd: true, smallProps: true, simpleDistricts: false });
    expect(lodFor(LOD_CROWD_MAX + 1, lod)).toBe(true);
    expect(lod).toEqual({ crowd: false, smallProps: true, simpleDistricts: false });
    expect(lodFor(LOD_CROWD_MAX + 1.5, lod)).toBe(false);
    expect(lodFor(LOD_SMALL_PROPS_MAX + 0.5, lod)).toBe(true);
    expect(lod).toEqual({ crowd: false, smallProps: false, simpleDistricts: false });
    expect(lodFor(LOD_SIMPLE_DISTRICTS_MIN, lod)).toBe(true);
    expect(lod).toEqual({ crowd: false, smallProps: false, simpleDistricts: true });
    // Coming back in restores everything.
    expect(lodFor(3, lod)).toBe(true);
    expect(lod).toEqual({ crowd: true, smallProps: true, simpleDistricts: false });
  });

  it('the entry dolly starts far out and settles at 1', () => {
    expect(dollyFactor(0)).toBeCloseTo(1.9, 10);
    expect(dollyFactor(0.5)).toBeCloseTo(1.45, 10);
    expect(dollyFactor(1)).toBe(1);
    expect(dollyFactor(4)).toBe(1);
  });
});

describe('simplified district models', () => {
  it('have fewer vertices than the full models and the same footprint height class', () => {
    for (let m = 0; m < SIMPLE_MODEL_COUNT; m++) {
      const full = buildSiteGeometry(m);
      const simple = buildSimpleSiteGeometry(m);
      expect(simple.getAttribute('position').count).toBeLessThan(
        full.getAttribute('position').count,
      );
      expect(simple.getAttribute('color').count).toBe(simple.getAttribute('position').count);
      full.computeBoundingBox();
      simple.computeBoundingBox();
      // The silhouette stays within a few percent of the full height and inside the hex.
      const fh = full.boundingBox?.max.y ?? 0;
      const sh = simple.boundingBox?.max.y ?? 0;
      expect(sh).toBeGreaterThan(fh * 0.5);
      expect(sh).toBeLessThanOrEqual(fh * 1.05);
      expect(Math.abs(simple.boundingBox?.max.x ?? 9)).toBeLessThan(0.55);
      full.dispose();
      simple.dispose();
    }
  });
});

describe('system layer', () => {
  function data(survey: number[], owned: number[], parked: number[]) {
    const n = MAX_SYSTEM_PLANETS + 4;
    const pad = (a: number[]): Uint8Array => {
      const u = new Uint8Array(n);
      u.set(a);
      return u;
    };
    return {
      survey: pad(survey),
      habLo: pad([0, 30, 60, 80]),
      habHi: pad([100, 50, 90, 100]),
      owned: pad(owned),
      parked: pad(parked),
    };
  }

  it('lays planets on their orbits round the star and counts what it draws', () => {
    const scene = new Scene();
    const layer = createSystemLayer(scene, false, 12);
    layer.setSystem(5, 300, 400, 0, 4);
    expect(layer.count).toBe(4);
    for (let k = 0; k < 4; k++) {
      const d = Math.hypot(layer.worldPos[k * 2] - 300, layer.worldPos[k * 2 + 1] - 400);
      expect(d).toBeCloseTo(orbitRadius(k), 2);
    }
    layer.refresh(data([0, 1, 2, 3], [0, 0, 1, 0], [0, 2, 0, 0]));
    layer.setSelectedSlot(1);
    const root = scene.children[0] as Group;
    const [orbits, bodies, marks, ships] = root.children as [
      LineSegments,
      InstancedMesh,
      InstancedMesh,
      InstancedMesh,
    ];
    // Four orbit circles of 72 segments, two vertices each.
    expect(orbits.geometry.drawRange.count).toBe(4 * 72 * 2);
    expect(bodies.count).toBe(4);
    // 4 survey rings + 1 colony ring + 1 selection ring.
    expect(marks.count).toBe(6);
    expect(ships.count).toBe(2);
    expect(layer.animated).toBe(false); // reduced motion: nothing pulses
    layer.dispose();
  });

  it('draws the four survey levels with different tone, level and ring kind', () => {
    const scene = new Scene();
    const layer = createSystemLayer(scene, true, 12);
    layer.setSystem(1, 0, 0, 0, 4);
    layer.refresh(data([0, 1, 2, 3], [0, 0, 0, 0], [0, 0, 0, 0]));
    layer.setAlpha(1);
    const root = scene.children[0] as Group;
    const bodies = root.children[1] as InstancedMesh;
    const marks = root.children[2] as InstancedMesh;
    const tone = (bodies.geometry.getAttribute('aTone') as InstancedBufferAttribute).array;
    const level = (bodies.geometry.getAttribute('aLevel') as InstancedBufferAttribute).array;
    const kind = (marks.geometry.getAttribute('aKind') as InstancedBufferAttribute).array;
    for (let k = 0; k < 4; k++) {
      expect(level[k]).toBe(k);
      expect(tone[k * 2]).toBeCloseTo(SURVEY_LOOKS[k].sat, 6);
      expect(tone[k * 2 + 1]).toBeCloseTo(SURVEY_LOOKS[k].light, 6);
      expect(kind[k]).toBe(SURVEY_LOOKS[k].ring);
    }
    expect(layer.bodyRadius(3)).toBeGreaterThan(layer.bodyRadius(0));
    expect(layer.bodyRadius(9)).toBe(0);
    expect(root.visible).toBe(true);
    layer.setAlpha(0);
    expect(root.visible).toBe(false);
    layer.dispose();
  });

  it('a colony or a selection makes it pulse when motion is allowed', () => {
    const layer = createSystemLayer(new Scene(), true, 12);
    layer.setSystem(2, 0, 0, 0, 2);
    layer.setAlpha(1);
    layer.refresh(data([1, 1], [0, 0], [0, 0]));
    expect(layer.animated).toBe(false);
    layer.refresh(data([1, 1], [0, 1], [0, 0]));
    expect(layer.animated).toBe(true);
    layer.dispose();
  });
});

describe('sources and style', () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');

  it('the new render code uses neither the clock nor Math.random', () => {
    for (const f of ['zoom.ts', 'systemLayer.ts', 'zoomFx.ts']) {
      const src = read(`../src/render/${f}`);
      expect(src).not.toMatch(/Math\.random|Date\.now|performance\.now/);
    }
  });

  it('the colony grade is a token-driven layer', () => {
    const css = read('../src/ui/style.css');
    expect(css).toMatch(/\.zoom-fx \{[^}]*pointer-events: none/);
    expect(css).toContain('--vignette:');
    expect(css).toContain('--grade:');
  });

  it('transitions respect prefers-reduced-motion in both views', () => {
    // M8 (D-150): both views ask src/render/motion.ts, which reads the media query and the Settings override.
    expect(read('../src/render/motion.ts')).toContain("'(prefers-reduced-motion: reduce)'");
    expect(read('../src/render/galaxyView.ts')).toContain("from './motion'");
    expect(read('../src/render/planetView.ts')).toContain("from './motion'");
    expect(read('../src/render/galaxyView.ts')).toMatch(/slideStart\([\s\S]*?!motionOk/);
    expect(read('../src/render/planetView.ts')).toMatch(/slideStart\([\s\S]*?reducedMotion/);
  });
});
