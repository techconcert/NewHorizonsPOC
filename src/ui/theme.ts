/**
 * Interface theme (pure state plus one DOM write). The game starts dark whatever the system
 * scheme says, because the galaxy and planet canvases are always dark; light is an explicit
 * choice made with the menu button and lives in memory only and is never persisted.
 */

export type Theme = 'dark' | 'light';

export interface ThemeState {
  current(): Theme;
  toggle(): Theme;
}

export function createThemeState(initial: Theme = 'dark'): ThemeState {
  let theme: Theme = initial;
  return {
    current: () => theme,
    toggle() {
      theme = theme === 'dark' ? 'light' : 'dark';
      return theme;
    },
  };
}

/** Button text: it names the theme a press switches to. */
export function themeButtonLabel(theme: Theme): string {
  return theme === 'dark' ? 'Light theme' : 'Dark theme';
}

/** Set (or clear) data-theme on the document element. */
export function applyTheme(root: HTMLElement, theme: Theme): void {
  if (theme === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
}
