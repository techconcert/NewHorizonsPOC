import { bindArrowNav } from './a11y';
import { el, setDisabled, setText } from './dom';

/** How long a finished save, load or refusal message stays on screen. */
const STATUS_VISIBLE_MS = 8000;

export interface MenuOptions {
  onSave(): void;
  onLoad(): void;
  onNewGame(): void;
  /** The Help button: open or close the guide. */
  onHelp(): void;
  /** Export save: download the running game as a .json file. */
  onExport(): void;
  /** Import save: the player chose a file. */
  onImport(file: File): void;
  /** Settings: open the dialog; `opener` is the button to give focus back to. */
  onSettings(opener: HTMLElement): void;
}

export interface Menu {
  /** One line of feedback next to the buttons ("Game saved on day 120."). */
  setStatus(text: string): void;
  /** Turn the buttons off while a save or a load is under way. */
  setBusy(busy: boolean): void;
  /** Drop an armed "New game" confirmation (a new game or a load happened, or Escape was pressed). */
  cancelConfirm(): void;
  /** Mirror whether the guide is open (the Help button's pressed state). */
  setHelpOpen(open: boolean): void;
  dispose(): void;
}

/**
 * Game menu (M5, M8): "Save game" and "Load game" stay in the top bar; a "Menu" button opens a small
 * list with "New game", "Export save", "Import save", "Help" and "Settings", so the bar never
 * overflows at large text sizes or 200% zoom. The labels are clicked by text in the browser smoke
 * script: keep them stable.
 */
export function createMenu(root: HTMLElement, opts: MenuOptions): Menu {
  const box = el('span', 'menu-row', root);
  const mk = (label: string, fn: () => void, parent: HTMLElement = box): HTMLButtonElement => {
    const b = el('button', 'hud-btn', parent, label);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  };
  let busy = false;
  const saveBtn = mk('Save game', opts.onSave);
  const loadBtn = mk('Load game', opts.onLoad);
  const toggle = mk('Menu', () => setOpen(!!pop.hidden));
  toggle.classList.add('menu-toggle');
  toggle.setAttribute('aria-haspopup', 'true');
  toggle.setAttribute('aria-expanded', 'false');
  const pop = el('div', 'menu-pop', box);
  pop.id = 'menu-pop';
  pop.hidden = true;
  pop.setAttribute('role', 'group');
  pop.setAttribute('aria-label', 'More game actions');
  toggle.setAttribute('aria-controls', pop.id);

  // New game needs a second, separate press (D-110): it throws the running game away.
  const newBtn = mk('New game', () => setArmed(true), pop);
  const confirmBtn = mk(
    'Yes, start a new game',
    () => {
      setArmed(false);
      setOpen(false, false);
      opts.onNewGame();
    },
    pop,
  );
  const cancelBtn = mk('Cancel', () => setArmed(false), pop);
  confirmBtn.classList.add('hud-btn--danger');
  const exportBtn = mk(
    'Export save',
    () => {
      setOpen(false);
      opts.onExport();
    },
    pop,
  );
  exportBtn.title = 'Download the running game as a .json file.';
  // The file input is hidden; the visible button opens its chooser.
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.hidden = true;
  fileInput.tabIndex = -1;
  fileInput.setAttribute('aria-hidden', 'true');
  pop.appendChild(fileInput);
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    fileInput.value = '';
    if (f) opts.onImport(f);
  });
  const importBtn = mk(
    'Import save',
    () => {
      setOpen(false);
      fileInput.click();
    },
    pop,
  );
  importBtn.title = 'Load a game from a .json file made by Export save.';
  // Help and Settings are always available: not in `buttons`, so a save or load does not disable them.
  const helpBtn = mk(
    'Help',
    () => {
      setOpen(false);
      opts.onHelp();
    },
    pop,
  );
  helpBtn.setAttribute('aria-pressed', 'false');
  helpBtn.title = 'Show or hide the step-by-step guide.';
  const settingsBtn = mk(
    'Settings',
    () => {
      setOpen(false, false);
      opts.onSettings(toggle);
    },
    pop,
  );
  settingsBtn.title = 'Sound, display, accessibility and diagnostics.';
  const buttons = [saveBtn, loadBtn, newBtn, confirmBtn, cancelBtn, exportBtn, importBtn];

  function setOpen(open: boolean, refocus = true): void {
    if (open === !pop.hidden) return;
    pop.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      const first = pop.querySelector<HTMLButtonElement>('button:not([hidden]):not(:disabled)');
      first?.focus();
    } else {
      setArmed(false);
      if (refocus) toggle.focus();
    }
  }

  function setArmed(armed: boolean): void {
    if (armed && busy) return;
    newBtn.hidden = armed;
    confirmBtn.hidden = !armed;
    cancelBtn.hidden = !armed;
    if (armed) confirmBtn.focus();
    else if (document.activeElement === confirmBtn || document.activeElement === cancelBtn)
      newBtn.focus();
  }
  setArmed(false);

  // Escape closes the list (and an armed New game) before anything else reacts to it.
  const onPopKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
  };
  pop.addEventListener('keydown', onPopKey);
  toggle.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'ArrowDown' && pop.hidden) {
      e.preventDefault();
      setOpen(true);
    }
  });
  const unbindNav = bindArrowNav(pop, 'button', 'vertical');
  const onOutside = (e: PointerEvent): void => {
    if (!pop.hidden && !box.contains(e.target as Node)) setOpen(false, false);
  };
  document.addEventListener('pointerdown', onOutside);

  const status = el('span', 'hud-status menu-status', box);
  status.setAttribute('role', 'status');
  // A finished message fades after a while so an old "Game saved" does not stay on screen.
  let clearTimer: ReturnType<typeof setTimeout> | null = null;
  return {
    setStatus(text) {
      if (clearTimer !== null) clearTimeout(clearTimer);
      clearTimer = null;
      setText(status, text);
      if (text !== '' && !text.endsWith('...')) {
        clearTimer = setTimeout(() => setText(status, ''), STATUS_VISIBLE_MS);
      }
    },
    setBusy(b) {
      busy = b;
      for (const btn of buttons) setDisabled(btn, b);
      if (b) setArmed(false);
    },
    cancelConfirm: () => setArmed(false),
    setHelpOpen(open) {
      helpBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
      helpBtn.classList.toggle('active', open);
    },
    dispose() {
      if (clearTimer !== null) clearTimeout(clearTimer);
      document.removeEventListener('pointerdown', onOutside);
      unbindNav();
      box.remove();
    },
  };
}
