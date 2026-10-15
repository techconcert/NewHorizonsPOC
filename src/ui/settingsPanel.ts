import { bindArrowNav, focusableIn, trapFocus } from './a11y';
import { el, setText } from './dom';
import { ERROR_LOG_CAPACITY, type ErrorLog } from './errorLog';
import {
  MOTION_OPTIONS,
  percentText,
  QUALITY_OPTIONS,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
  TEXT_SCALE_STEP,
  THEME_OPTIONS,
  type Settings,
  type SettingsStore,
} from './settingsModel';

export interface SettingsPanelOptions {
  store: SettingsStore;
  errorLog: ErrorLog;
  /** "Show the guide now": open the step-by-step guide. */
  onShowGuide(): void;
}

export interface SettingsPanel {
  /** Open the dialog; focus goes inside and returns to `opener` (or the previous focus) on close. */
  open(opener?: HTMLElement | null): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

/** Copy text to the clipboard; false when the browser refuses both ways. */
async function copyToClipboard(text: string, fallbackHost: HTMLElement): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the selection fallback */
  }
  const ta = el('textarea', 'sr-only', fallbackHost);
  ta.value = text;
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/**
 * The Settings dialog (M8, D-139): sound, display, accessibility, render quality, the guide and the
 * local error log. A modal dialog with a focus trap; Escape or the Close button closes it and
 * focus goes back to the button that opened it. Changes apply at once through the settings store.
 */
export function createSettingsPanel(root: HTMLElement, opts: SettingsPanelOptions): SettingsPanel {
  const { store, errorLog } = opts;
  const overlay = el('div', 'settings-overlay', root);
  overlay.hidden = true;
  const dlg = el('section', 'settings-dialog', overlay);
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  dlg.setAttribute('aria-labelledby', 'settings-title');
  const head = el('div', 'settings-head', dlg);
  const title = el('h2', 'hud-title', head, 'Settings');
  title.id = 'settings-title';
  const closeBtn = el('button', 'hud-btn', head, 'Close');
  closeBtn.type = 'button';

  const body = el('div', 'settings-body', dlg);
  let idCounter = 0;
  const nextId = (): string => `set-${++idCounter}`;
  const group = (name: string): HTMLElement => {
    const f = el('fieldset', 'settings-group', body);
    el('legend', 'settings-legend', f, name);
    return f;
  };
  const row = (
    parent: HTMLElement,
    label: string,
    control: HTMLElement,
    out?: HTMLElement,
  ): void => {
    const r = el('div', 'settings-row', parent);
    const l = el('label', 'settings-label', r, label);
    if (control.id === '') control.id = nextId();
    l.htmlFor = control.id;
    r.appendChild(control);
    if (out) r.appendChild(out);
  };
  const range = (
    min: number,
    max: number,
    step: number,
    onInput: (v: number) => void,
  ): HTMLInputElement => {
    const i = document.createElement('input');
    i.type = 'range';
    i.className = 'settings-range';
    i.min = String(min);
    i.max = String(max);
    i.step = String(step);
    i.addEventListener('input', () => onInput(Number(i.value)));
    return i;
  };
  const checkbox = (
    parent: HTMLElement,
    label: string,
    onChange: (v: boolean) => void,
  ): HTMLInputElement => {
    const r = el('div', 'settings-row settings-check', parent);
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.id = nextId();
    c.addEventListener('change', () => onChange(c.checked));
    r.appendChild(c);
    const l = el('label', 'settings-label', r, label);
    l.htmlFor = c.id;
    return c;
  };
  const select = <T extends string>(
    options: readonly { value: T; label: string }[],
    onChange: (v: T) => void,
  ): HTMLSelectElement => {
    const s = document.createElement('select');
    s.className = 'mc-select settings-select';
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      s.appendChild(opt);
    }
    s.addEventListener('change', () => onChange(s.value as T));
    return s;
  };

  // Sound
  const sound = group('Sound');
  const mute = checkbox(sound, 'Mute all sound', (v) => store.set({ muted: v }));
  const mkVolume = (
    label: string,
    key: 'masterVolume' | 'musicVolume' | 'sfxVolume',
  ): [HTMLInputElement, HTMLElement] => {
    const out = el('span', 'settings-out', sound);
    const r = range(0, 100, 5, (v) => store.set({ [key]: v }));
    row(sound, label, r, out);
    r.setAttribute('aria-valuetext', '');
    return [r, out];
  };
  const [masterR, masterO] = mkVolume('Master volume', 'masterVolume');
  const [musicR, musicO] = mkVolume('Music volume', 'musicVolume');
  const [sfxR, sfxO] = mkVolume('Effects volume', 'sfxVolume');
  el(
    'p',
    'mc-dim settings-note',
    sound,
    'Sound starts after your first click or key press, and stops while this tab is hidden.',
  );

  // Display and accessibility
  const display = group('Display and accessibility');
  const themeS = select(THEME_OPTIONS, (v) => store.set({ theme: v }));
  row(display, 'Theme', themeS);
  const scaleO = el('span', 'settings-out', display);
  const scaleR = range(TEXT_SCALE_MIN, TEXT_SCALE_MAX, TEXT_SCALE_STEP, (v) =>
    store.set({ textScale: v }),
  );
  row(display, 'Text size', scaleR, scaleO);
  const motionS = select(MOTION_OPTIONS, (v) => store.set({ motion: v }));
  row(display, 'Motion', motionS);
  const cb = checkbox(
    display,
    'Colour-blind-safe colours (blue, orange and pink instead of green, amber and red)',
    (v) => store.set({ colourBlind: v }),
  );
  el(
    'p',
    'mc-dim settings-note',
    display,
    'Status is always also shown by a symbol and a word, never by colour alone.',
  );

  // Performance
  const perf = group('Performance');
  const qualityS = select(QUALITY_OPTIONS, (v) => store.set({ quality: v }));
  row(perf, 'Render quality', qualityS);

  // Guide
  const guide = group('Guide');
  const tut = checkbox(guide, 'Show the step-by-step guide when a game starts', (v) =>
    store.set({ showTutorial: v }),
  );
  const guideBtn = el('button', 'hud-btn', guide, 'Show the guide now');
  guideBtn.type = 'button';
  guideBtn.addEventListener('click', () => {
    close();
    opts.onShowGuide();
  });

  // Diagnostics
  const diag = group('Diagnostics');
  const diagNote = el('p', 'mc-dim settings-note', diag);
  const logBox = el('pre', 'settings-log', diag);
  logBox.tabIndex = 0;
  logBox.setAttribute('role', 'log');
  logBox.setAttribute('aria-label', 'Error log');
  const diagRow = el('div', 'settings-actions', diag);
  const copyBtn = el('button', 'hud-btn', diagRow, 'Copy log');
  copyBtn.type = 'button';
  const clearBtn = el('button', 'hud-btn', diagRow, 'Clear log');
  clearBtn.type = 'button';
  const diagStatus = el('span', 'mc-dim', diagRow);
  diagStatus.setAttribute('role', 'status');

  const foot = el('div', 'settings-actions settings-foot', dlg);
  const resetBtn = el('button', 'hud-btn hud-btn--danger', foot, 'Reset settings to defaults');
  resetBtn.type = 'button';
  const persistNote = el('span', 'mc-dim', foot);

  function paint(s: Readonly<Settings>): void {
    mute.checked = s.muted;
    for (const [r, o, v] of [
      [masterR, masterO, s.masterVolume],
      [musicR, musicO, s.musicVolume],
      [sfxR, sfxO, s.sfxVolume],
    ] as const) {
      if (r.value !== String(v)) r.value = String(v);
      setText(o, percentText(v));
      r.setAttribute('aria-valuetext', percentText(v));
    }
    themeS.value = s.theme;
    if (scaleR.value !== String(s.textScale)) scaleR.value = String(s.textScale);
    setText(scaleO, percentText(s.textScale));
    scaleR.setAttribute('aria-valuetext', percentText(s.textScale));
    motionS.value = s.motion;
    cb.checked = s.colourBlind;
    qualityS.value = s.quality;
    tut.checked = s.showTutorial;
    setText(
      persistNote,
      store.persisted()
        ? ''
        : 'Settings could not be saved in this browser; they last until you close the page.',
    );
  }

  function paintLog(): void {
    setText(
      diagNote,
      `Errors caught on this page (the last ${ERROR_LOG_CAPACITY} are kept). They stay in memory and are never sent anywhere. ${errorLog.total()} so far.`,
    );
    setText(logBox, errorLog.format());
  }

  let unsubSettings: (() => void) | null = null;
  let unsubLog: (() => void) | null = null;
  let release: (() => void) | null = null;
  let returnTo: HTMLElement | null = null;
  let unbindNav: (() => void) | null = null;
  let openState = false;

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  function open(opener?: HTMLElement | null): void {
    if (openState) return;
    openState = true;
    returnTo = opener ?? (document.activeElement as HTMLElement | null);
    paint(store.get());
    paintLog();
    overlay.hidden = false;
    unsubSettings = store.subscribe(paint);
    unsubLog = errorLog.subscribe(paintLog);
    release = trapFocus(dlg);
    // Arrow keys also move between the buttons of the action rows.
    unbindNav = bindArrowNav(dlg, '.settings-actions .hud-btn', 'horizontal');
    document.addEventListener('keydown', onKey, true);
    const first = focusableIn(dlg).find((n) => n !== closeBtn) ?? closeBtn;
    first.focus();
  }

  function close(): void {
    if (!openState) return;
    openState = false;
    overlay.hidden = true;
    unsubSettings?.();
    unsubLog?.();
    release?.();
    unbindNav?.();
    unsubSettings = unsubLog = release = unbindNav = null;
    document.removeEventListener('keydown', onKey, true);
    if (returnTo && document.contains(returnTo)) returnTo.focus();
    returnTo = null;
  }

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  resetBtn.addEventListener('click', () => store.reset());
  clearBtn.addEventListener('click', () => {
    errorLog.clear();
    setText(diagStatus, 'Log cleared.');
  });
  copyBtn.addEventListener('click', () => {
    void copyToClipboard(errorLog.format(), dlg).then((ok) => {
      setText(
        diagStatus,
        ok ? 'Copied to the clipboard.' : 'Copy failed: select the text above and copy it by hand.',
      );
    });
  });

  return {
    open,
    close,
    isOpen: () => openState,
    dispose() {
      close();
      overlay.remove();
    },
  };
}
