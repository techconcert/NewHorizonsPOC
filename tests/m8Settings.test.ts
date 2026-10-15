// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { motionOverride, resolveReducedMotion, setMotionOverride } from '../src/render/motion';
import { applyQuality, createScaler, QUALITY_SCALE, scalerScale } from '../src/render/perf';
import { applyAppearance, rootAppearance } from '../src/ui/appearance';
import {
  clampInt,
  clampTextScale,
  createSettingsStore,
  DEFAULT_SETTINGS,
  MOTION_OPTIONS,
  parseSettings,
  percentText,
  QUALITY_OPTIONS,
  reducedMotionEffective,
  sanitizeSettings,
  serializeSettings,
  SETTINGS_KEY,
  textScaleCss,
  THEME_OPTIONS,
  type KeyValueStorage,
} from '../src/ui/settingsModel';

function fakeStorage(
  initial: Record<string, string> = {},
): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe('settings model', () => {
  it('has literal defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      masterVolume: 70,
      musicVolume: 40,
      sfxVolume: 70,
      muted: false,
      theme: 'dark',
      textScale: 100,
      motion: 'system',
      colourBlind: false,
      quality: 'auto',
      showTutorial: true,
    });
  });

  it('clamps numbers and rejects non-numbers', () => {
    expect(clampInt(55.6, 0, 100, 7)).toBe(56);
    expect(clampInt(-5, 0, 100, 7)).toBe(0);
    expect(clampInt(500, 0, 100, 7)).toBe(100);
    expect(clampInt('50', 0, 100, 7)).toBe(7);
    expect(clampInt(NaN, 0, 100, 7)).toBe(7);
    expect(clampInt(Infinity, 0, 100, 7)).toBe(7);
  });

  it('snaps the text scale to 90..150 in steps of 5', () => {
    expect(clampTextScale(100)).toBe(100);
    expect(clampTextScale(50)).toBe(90);
    expect(clampTextScale(200)).toBe(150);
    expect(clampTextScale(112)).toBe(110);
    expect(clampTextScale(113)).toBe(115);
    expect(clampTextScale('big')).toBe(100);
    expect(textScaleCss(120)).toBe('120%');
  });

  it('sanitizes junk field by field and keeps the good fields', () => {
    const s = sanitizeSettings({
      masterVolume: 300,
      musicVolume: 'loud',
      sfxVolume: 20,
      muted: 'yes',
      theme: 'purple',
      textScale: 130,
      motion: 'reduce',
      colourBlind: true,
      quality: 'ultra',
      showTutorial: false,
      extra: 1,
    });
    expect(s).toEqual({
      masterVolume: 100,
      musicVolume: 40,
      sfxVolume: 20,
      muted: false,
      theme: 'dark',
      textScale: 130,
      motion: 'reduce',
      colourBlind: true,
      quality: 'auto',
      showTutorial: false,
    });
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('x')).toEqual(DEFAULT_SETTINGS);
  });

  it('parses stored text; broken or empty text gives the defaults', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{oops')).toEqual(DEFAULT_SETTINGS);
    const round = { ...DEFAULT_SETTINGS, theme: 'light' as const, textScale: 125 };
    expect(parseSettings(serializeSettings(round))).toEqual(round);
  });

  it('option lists cover exactly the allowed values', () => {
    expect(THEME_OPTIONS.map((o) => o.value)).toEqual(['dark', 'light']);
    expect(MOTION_OPTIONS.map((o) => o.value)).toEqual(['system', 'reduce', 'full']);
    expect(QUALITY_OPTIONS.map((o) => o.value)).toEqual(['auto', 'low', 'high']);
    expect(percentText(70)).toBe('70%');
  });
});

describe('settings store', () => {
  it('reads saved settings, saves changes and notifies subscribers', () => {
    const st = fakeStorage({
      [SETTINGS_KEY]: JSON.stringify({ masterVolume: 10, theme: 'light' }),
    });
    const store = createSettingsStore(st);
    expect(store.get().masterVolume).toBe(10);
    expect(store.get().theme).toBe('light');
    expect(store.get().musicVolume).toBe(40);
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.set({ textScale: 140, muted: true });
    expect(calls).toBe(1);
    expect(JSON.parse(st.data[SETTINGS_KEY])).toMatchObject({
      textScale: 140,
      muted: true,
      masterVolume: 10,
    });
    expect(store.persisted()).toBe(true);
    off();
    store.set({ muted: false });
    expect(calls).toBe(1);
  });

  it('sanitizes patches', () => {
    const store = createSettingsStore(fakeStorage());
    store.set({ textScale: 9999, masterVolume: -4 });
    expect(store.get().textScale).toBe(150);
    expect(store.get().masterVolume).toBe(0);
  });

  it('reset returns to the defaults', () => {
    const store = createSettingsStore(fakeStorage());
    store.set({ colourBlind: true });
    expect(store.reset()).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to memory when storage is missing or throws', () => {
    const none = createSettingsStore(null);
    expect(none.persisted()).toBe(false);
    none.set({ muted: true });
    expect(none.get().muted).toBe(true);

    const bad: KeyValueStorage = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('quota');
      },
    };
    const store = createSettingsStore(bad);
    expect(store.get()).toEqual(DEFAULT_SETTINGS);
    expect(store.persisted()).toBe(false);
    store.set({ theme: 'light' });
    expect(store.get().theme).toBe('light');
    expect(store.persisted()).toBe(false);
  });

  it('stores only settings, never game state', () => {
    const st = fakeStorage();
    createSettingsStore(st).set({ muted: true });
    expect(Object.keys(st.data)).toEqual([SETTINGS_KEY]);
    expect(Object.keys(JSON.parse(st.data[SETTINGS_KEY])).sort()).toEqual(
      Object.keys(DEFAULT_SETTINGS).sort(),
    );
  });
});

describe('appearance, motion and render quality', () => {
  it('maps settings to document attributes', () => {
    expect(rootAppearance(DEFAULT_SETTINGS)).toEqual({
      theme: 'dark',
      palette: null,
      motion: null,
      fontSize: '100%',
    });
    expect(
      rootAppearance({ theme: 'light', colourBlind: true, motion: 'reduce', textScale: 150 }),
    ).toEqual({ theme: 'light', palette: 'cb', motion: 'reduce', fontSize: '150%' });
  });

  it('writes and clears the attributes', () => {
    const attrs = new Map<string, string>();
    const root = {
      style: { fontSize: '' },
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      removeAttribute: (k: string) => attrs.delete(k),
    } as unknown as HTMLElement;
    applyAppearance(root, { theme: 'light', palette: 'cb', motion: 'full', fontSize: '120%' });
    expect(Object.fromEntries(attrs)).toEqual({
      'data-theme': 'light',
      'data-palette': 'cb',
      'data-motion': 'full',
    });
    expect(root.style.fontSize).toBe('120%');
    applyAppearance(root, { theme: 'dark', palette: null, motion: null, fontSize: '100%' });
    expect(attrs.size).toBe(0);
  });

  it('reduced motion: the override wins, system otherwise (UI rule equals render rule)', () => {
    for (const choice of ['system', 'reduce', 'full'] as const) {
      for (const sys of [true, false]) {
        expect(reducedMotionEffective(choice, sys)).toBe(resolveReducedMotion(choice, sys));
      }
    }
    expect(reducedMotionEffective('reduce', false)).toBe(true);
    expect(reducedMotionEffective('full', true)).toBe(false);
    expect(reducedMotionEffective('system', true)).toBe(true);
    setMotionOverride('reduce');
    expect(motionOverride()).toBe('reduce');
    setMotionOverride('system');
  });

  it('quality pins or releases the render scale', () => {
    const s = createScaler(1);
    expect(QUALITY_SCALE).toEqual({ auto: 0, low: 0.5, high: 1 });
    expect(applyQuality(s, 'low', 1, false)).toBe(true);
    expect(scalerScale(s)).toBe(0.5);
    expect(s.pinned).toBe(true);
    expect(applyQuality(s, 'low', 1, false)).toBe(false);
    expect(applyQuality(s, 'auto', 0.5, false)).toBe(false);
    expect(s.pinned).toBe(false);
    expect(scalerScale(s)).toBe(0.5);
    expect(applyQuality(s, 'high', 0.5, false)).toBe(true);
    expect(scalerScale(s)).toBe(1);
  });

  it('a scale pinned by ?fx=scale wins over the setting', () => {
    const s = createScaler(0.75, true);
    expect(applyQuality(s, 'high', 1, true)).toBe(false);
    expect(scalerScale(s)).toBe(0.75);
  });
});
