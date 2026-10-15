import { applyTheme } from './theme';
import { textScaleCss, type MotionChoice, type Settings } from './settingsModel';

/** What the settings write on the document element. Pure, so it can be tested. */
export interface RootAppearance {
  theme: 'dark' | 'light';
  /** 'cb' for the colour-blind-safe palette, null for the default one. */
  palette: 'cb' | null;
  /** data-motion value; null for 'system' (no attribute). */
  motion: Exclude<MotionChoice, 'system'> | null;
  /** html font-size, e.g. "120%". */
  fontSize: string;
}

export function rootAppearance(
  s: Pick<Settings, 'theme' | 'colourBlind' | 'motion' | 'textScale'>,
): RootAppearance {
  return {
    theme: s.theme,
    palette: s.colourBlind ? 'cb' : null,
    motion: s.motion === 'system' ? null : s.motion,
    fontSize: textScaleCss(s.textScale),
  };
}

/** Write the appearance onto `root` (the document element). */
export function applyAppearance(root: HTMLElement, a: RootAppearance): void {
  applyTheme(root, a.theme);
  if (a.palette === null) root.removeAttribute('data-palette');
  else root.setAttribute('data-palette', a.palette);
  if (a.motion === null) root.removeAttribute('data-motion');
  else root.setAttribute('data-motion', a.motion);
  if (root.style.fontSize !== a.fontSize) root.style.fontSize = a.fontSize;
}
