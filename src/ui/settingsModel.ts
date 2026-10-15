import type { Theme } from './theme';

/**
 * Player settings (M8, D-139). Pure model: defaults, sanitising and a small store over an injected
 * key-value storage. Only settings live here, never game state. Storage can throw or be missing
 * (private windows, blocked site data): the store then keeps the values in memory and says so.
 */

export const SETTINGS_KEY = 'colony-ship.settings.v1';

export const TEXT_SCALE_MIN = 90;
export const TEXT_SCALE_MAX = 150;
export const TEXT_SCALE_STEP = 5;

/** Reduced motion: follow the system, force it on, or force animation on. */
export type MotionChoice = 'system' | 'reduce' | 'full';
/** Render quality: the automatic scaler, or a pinned low (half) or high (full) render scale. */
export type QualityChoice = 'auto' | 'low' | 'high';

export interface Settings {
  /** Volumes are whole percents, 0 to 100. */
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  /** Mute everything. Also the "sound off" switch: a muted game never starts the audio engine. */
  muted: boolean;
  theme: Theme;
  /** Percent of the browser's text size, 90 to 150 in steps of 5. */
  textScale: number;
  motion: MotionChoice;
  /** Colour-blind-safe palette (blue / orange / magenta instead of green / amber / red). */
  colourBlind: boolean;
  quality: QualityChoice;
  /** Show the step-by-step guide at the start of a game. */
  showTutorial: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
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
};

/** A whole number inside [lo, hi]; anything else (NaN, string, missing) gives `fallback`. */
export function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const r = Math.round(v);
  return r < lo ? lo : r > hi ? hi : r;
}

/** Text scale snapped to the step grid inside the allowed range. */
export function clampTextScale(v: unknown): number {
  const n = clampInt(v, TEXT_SCALE_MIN, TEXT_SCALE_MAX, DEFAULT_SETTINGS.textScale);
  return TEXT_SCALE_MIN + Math.round((n - TEXT_SCALE_MIN) / TEXT_SCALE_STEP) * TEXT_SCALE_STEP;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** Any value (parsed JSON, a half-written object, null) to a complete, valid Settings. */
export function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    masterVolume: clampInt(r.masterVolume, 0, 100, d.masterVolume),
    musicVolume: clampInt(r.musicVolume, 0, 100, d.musicVolume),
    sfxVolume: clampInt(r.sfxVolume, 0, 100, d.sfxVolume),
    muted: bool(r.muted, d.muted),
    theme: oneOf(r.theme, ['dark', 'light'] as const, d.theme),
    textScale: clampTextScale(r.textScale),
    motion: oneOf(r.motion, ['system', 'reduce', 'full'] as const, d.motion),
    colourBlind: bool(r.colourBlind, d.colourBlind),
    quality: oneOf(r.quality, ['auto', 'low', 'high'] as const, d.quality),
    showTutorial: bool(r.showTutorial, d.showTutorial),
  };
}

/** Stored text to Settings; null, empty or broken JSON gives the defaults. */
export function parseSettings(text: string | null): Settings {
  if (text === null || text === '') return sanitizeSettings(null);
  try {
    return sanitizeSettings(JSON.parse(text));
  } catch {
    return sanitizeSettings(null);
  }
}

export function serializeSettings(s: Settings): string {
  return JSON.stringify(s);
}

/** True when animation should be reduced: the override wins, 'system' follows the media query. */
export function reducedMotionEffective(
  choice: MotionChoice,
  systemPrefersReduced: boolean,
): boolean {
  if (choice === 'reduce') return true;
  if (choice === 'full') return false;
  return systemPrefersReduced;
}

/** The slice of Storage the store needs. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** window.localStorage, or null when it is missing or its accessor throws. */
export function browserStorage(): KeyValueStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export interface SettingsStore {
  get(): Readonly<Settings>;
  /** Merge a patch (sanitised), save, notify. Returns the new settings. */
  set(patch: Partial<Settings>): Readonly<Settings>;
  /** Back to the defaults. */
  reset(): Readonly<Settings>;
  /** False when saving failed or no storage exists: the settings last until the page closes. */
  persisted(): boolean;
  /** Called after every change. Returns the unsubscribe function. */
  subscribe(fn: (s: Readonly<Settings>) => void): () => void;
}

export function createSettingsStore(storage: KeyValueStorage | null): SettingsStore {
  let current: Settings;
  let ok = storage !== null;
  try {
    current = parseSettings(storage === null ? null : storage.getItem(SETTINGS_KEY));
  } catch {
    current = sanitizeSettings(null);
    ok = false;
  }
  const listeners = new Set<(s: Readonly<Settings>) => void>();
  function commit(next: Settings): Readonly<Settings> {
    current = next;
    if (storage !== null) {
      try {
        storage.setItem(SETTINGS_KEY, serializeSettings(next));
        ok = true;
      } catch {
        ok = false;
      }
    }
    for (const fn of [...listeners]) fn(current);
    return current;
  }
  return {
    get: () => current,
    set: (patch) => commit(sanitizeSettings({ ...current, ...patch })),
    reset: () => commit(sanitizeSettings(null)),
    persisted: () => ok,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** Value for `html { font-size }`, e.g. 120 gives "120%". */
export function textScaleCss(scale: number): string {
  return `${clampTextScale(scale)}%`;
}

export const THEME_OPTIONS: readonly { value: Theme; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

export const MOTION_OPTIONS: readonly { value: MotionChoice; label: string }[] = [
  { value: 'system', label: 'Follow my system setting' },
  { value: 'reduce', label: 'Always reduce motion' },
  { value: 'full', label: 'Allow motion' },
];

export const QUALITY_OPTIONS: readonly { value: QualityChoice; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'low', label: 'Low (half resolution, fastest)' },
  { value: 'high', label: 'High (full resolution)' },
];

/** "70%" for a slider read-out. */
export function percentText(v: number): string {
  return `${v}%`;
}
