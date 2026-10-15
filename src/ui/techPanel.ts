import type { ChooseTechCommand } from '../shared/commands';
import { TECH_COUNT } from '../shared/research';
import type { Snapshot } from '../shared/snapshot';
import { bindDetails, sectionAccordion } from './accordion';
import { createCommandGate, gateReply, gateSend, gateSnapshot } from './commandGate';
import { el, setClass, setDisabled, setText } from './dom';
import { buildTechView } from './techModel';

export interface TechPanelOptions {
  onChoose(command: ChooseTechCommand): void;
}

export interface TechPanel {
  update(snap: Snapshot): void;
  commandReply(ok: boolean, text: string): void;
  /** Drop an armed switch, any in-flight command and the message (new game, load: D-110). */
  reset(): void;
  dispose(): void;
}

/**
 * Tech panel (M5): every tech with its effect and status; "Research <Tech name>" picks the next
 * one. Rows are created once. A CommandGate keeps one click to one command.
 */
export function createTechPanel(root: HTMLElement, opts: TechPanelOptions): TechPanel {
  const gate = createCommandGate();
  let message = '';
  /** Tech whose switch awaits a confirming second press, or -1. */
  let armed = -1;
  let current: ReturnType<typeof buildTechView> | null = null;

  const panel = el('details', 'hud-panel tech-panel', root);
  panel.setAttribute('aria-label', 'Research');
  el('summary', 'hud-title', panel, 'Research');
  const unbind = bindDetails(sectionAccordion, 'research', panel);
  const summary = el('div', 'col-line', panel);
  const list = el('div', 'tech-list', panel);
  const rows: {
    root: HTMLElement;
    head: HTMLElement;
    text: HTMLElement;
    status: HTMLElement;
    button: HTMLButtonElement;
  }[] = [];
  for (let i = 0; i < TECH_COUNT; i++) {
    const r = el('div', 'tech-row', list);
    const head = el('div', 'tech-head', r);
    const text = el('div', 'mc-dim', r);
    const status = el('div', 'col-line', r);
    const button = el('button', 'hud-btn', r);
    button.type = 'button';
    button.addEventListener('click', () => {
      const row = current?.rows[i];
      const c = row?.command;
      if (c === null || c === undefined) return;
      if (row?.needsConfirm === true && armed !== i) {
        // Switching drops the points gathered: ask once more (D-105).
        armed = i;
        message = '';
        render();
        return;
      }
      if (gateSend(gate)) {
        armed = -1;
        message = '';
        opts.onChoose(c);
        render();
      }
    });
    rows.push({ root: r, head, text, status, button });
  }
  const problem = el('div', 'mc-problem', panel);
  problem.setAttribute('role', 'status');
  let latest: Snapshot | null = null;

  function render(): void {
    if (latest === null) return;
    current = buildTechView(latest, armed);
    if (armed >= 0 && !current.rows[armed].needsConfirm) {
      armed = -1;
      current = buildTechView(latest, armed);
    }
    setText(summary, current.summary);
    for (let i = 0; i < TECH_COUNT; i++) {
      const row = current.rows[i];
      const d = rows[i];
      setText(d.head, `${row.branch}: ${row.name}`);
      setText(d.text, row.text);
      setText(d.status, row.status);
      setClass(d.root, `tech-row tech-${row.state}`);
      setText(d.button, row.buttonLabel);
      d.button.hidden = row.state === 'known' || row.state === 'current';
      setDisabled(d.button, !row.canChoose || gate.awaiting);
    }
    setText(problem, message);
  }

  return {
    update(snap) {
      gateSnapshot(gate);
      latest = snap;
      render();
    },
    commandReply(ok, text) {
      gateReply(gate, ok);
      message = ok ? '' : text;
      render();
    },
    reset() {
      gate.awaiting = false;
      gate.replied = false;
      armed = -1;
      message = '';
      current = null;
      latest = null;
      setText(problem, '');
    },
    dispose() {
      unbind();
      panel.remove();
    },
  };
}
