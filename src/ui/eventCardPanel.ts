import type { ResolveEventChoiceCommand } from '../shared/commands';
import { EVENT_CHOICE_SLOTS } from '../shared/events';
import type { Snapshot } from '../shared/snapshot';
import { createCommandGate, gateReply, gateSend, gateSnapshot } from './commandGate';
import { createKeyGuard } from './keyGuard';
import { el, setClass, setDisabled, setHidden, setText } from './dom';
import {
  buildCardView,
  choiceCommand,
  choiceForKey,
  pendingCardKey,
  type CardChoiceView,
  type CardView,
} from './eventCardModel';

export interface EventCardPanel {
  /** Read a snapshot (the main-thread mirror): show the oldest pending card, or hide the panel. */
  update(snap: Snapshot): void;
  /** The worker answered the last ResolveEventChoice; `text` is the reject message when not ok. */
  commandReply(ok: boolean, text: string): void;
  /** True while a card is on screen. */
  isOpen(): boolean;
  /** Remove the document listener and the DOM. */
  dispose(): void;
}

export interface EventCardOptions {
  onChoose(cmd: ResolveEventChoiceCommand): void;
}

const MAX_LINES = 8;

interface ChoiceDom {
  button: HTMLButtonElement;
  key: HTMLElement;
  label: HTMLElement;
  preview: HTMLElement;
  lines: HTMLElement[];
  risk: HTMLElement;
  fuel: HTMLElement;
  margin: HTMLElement;
  marginRisk: HTMLElement;
}

/**
 * Event card (M3b): a centred card shown while the sim is paused on a pending card. Each choice
 * button lists every cost before commit (the shared choiceCost numbers), the fuel left, the supply
 * margin after the choice and the odds of a risk. It does not block the speed controls or the map.
 * Keyboard: the first choice is focused and keys 1 to 3 pick a choice. A CommandGate makes one
 * click send one command; queued cards appear one at a time as each is answered.
 */
export function createEventCard(
  root: HTMLElement,
  opts: EventCardOptions,
  clock: () => number = () => performance.now(),
): EventCardPanel {
  const guard = createKeyGuard(clock);
  const gate = createCommandGate();
  const dim = el('div', 'ec-dim', root);
  dim.setAttribute('aria-hidden', 'true');
  dim.hidden = true;
  const card = el('section', 'ec-card', root);
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-labelledby', 'ec-title');
  card.setAttribute('aria-describedby', 'ec-body');
  card.hidden = true;
  const queue = el('div', 'ec-queue', card);
  const title = el('h2', 'ec-title', card);
  title.id = 'ec-title';
  const shipEl = el('div', 'ec-ship', card);
  const body = el('p', 'ec-body', card);
  body.id = 'ec-body';
  const choicesBox = el('div', 'ec-choices', card);
  const status = el('div', 'ec-status', card);
  status.setAttribute('role', 'status');

  const choices: ChoiceDom[] = [];
  for (let c = 0; c < EVENT_CHOICE_SLOTS; c++) {
    const button = el('button', 'ec-choice', choicesBox);
    button.type = 'button';
    const top = el('span', 'ec-choice-top', button);
    const key = el('span', 'ec-key', top, String(c + 1));
    const label = el('span', 'ec-label', top);
    const preview = el('span', 'ec-preview', button);
    const ul = el('ul', 'ec-lines', button);
    const lines: HTMLElement[] = [];
    for (let i = 0; i < MAX_LINES; i++) lines.push(el('li', '', ul));
    const risk = el('span', 'ec-risk', button);
    const fuel = el('span', 'ec-extra', button);
    const margin = el('span', 'ec-extra', button);
    const marginRisk = el('span', 'ec-extra', button);
    button.addEventListener('click', () => choose(c));
    choices.push({ button, key, label, preview, lines, risk, fuel, margin, marginRisk });
  }

  let view: CardView | null = null;
  let shownKey = '';
  let open = false;
  let prevFocus: Element | null = null;

  function choose(index: number): void {
    if (!view || gate.awaiting) return;
    const cmd = choiceCommand(view, index);
    if (!cmd || !gateSend(gate)) return;
    setText(status, 'Sending...');
    syncDisabled();
    opts.onChoose(cmd);
  }

  function syncDisabled(): void {
    for (let c = 0; c < choices.length; c++) setDisabled(choices[c].button, gate.awaiting);
  }

  function writeChoice(d: ChoiceDom, v: CardChoiceView): void {
    setText(d.label, v.label);
    setText(d.preview, v.preview);
    for (let i = 0; i < MAX_LINES; i++) {
      const line = d.lines[i];
      const text = i < v.lines.length ? v.lines[i] : '';
      setText(line, text);
      setHidden(line, text === '');
    }
    setText(d.risk, v.risk);
    setHidden(d.risk, v.risk === '');
    setText(d.fuel, v.fuelLine);
    setText(d.margin, v.marginLine);
    setClass(d.margin, `ec-extra mc-num-${v.marginClass}`);
    setText(d.marginRisk, v.marginRiskLine);
    setHidden(d.marginRisk, v.marginRiskLine === '');
    if (v.marginRiskLine !== '') setClass(d.marginRisk, `ec-extra mc-num-${v.marginIfRiskClass}`);
  }

  function show(v: CardView): void {
    view = v;
    shownKey = v.key;
    setText(title, v.title);
    setText(shipEl, v.shipLine);
    setText(body, v.body);
    setText(
      queue,
      v.queueLine !== '' ? `${v.queueLine}. The game is paused.` : 'The game is paused.',
    );
    for (let c = 0; c < choices.length; c++) {
      const present = c < v.choices.length;
      setHidden(choices[c].button, !present);
      if (present) writeChoice(choices[c], v.choices[c]);
    }
    setText(status, '');
    if (!open) {
      open = true;
      prevFocus = document.activeElement;
      card.hidden = false;
      dim.hidden = false;
    }
    syncDisabled();
    guard.cardShown();
    if (!gate.awaiting) choices[0].button.focus();
  }

  function hide(): void {
    if (!open) return;
    open = false;
    guard.cardClosed();
    view = null;
    shownKey = '';
    card.hidden = true;
    dim.hidden = true;
    const back = prevFocus;
    prevFocus = null;
    if (back instanceof HTMLElement && back !== document.body && document.contains(back))
      back.focus();
  }

  const onKey = (e: KeyboardEvent): void => {
    if (!open || !view || e.ctrlKey || e.metaKey || e.altKey) return;
    const i = choiceForKey(e.key, view.choices.length);
    if (i < 0) return;
    const tag = e.target instanceof Element ? e.target.tagName : '';
    if (!guard.accept({ repeat: e.repeat, targetTag: tag })) return;
    e.preventDefault();
    choose(i);
  };
  document.addEventListener('keydown', onKey);

  return {
    update(snap) {
      gateSnapshot(gate);
      const key = pendingCardKey(snap);
      if (key === '') {
        hide();
        return;
      }
      if (key !== shownKey) {
        const v = buildCardView(snap);
        if (v) show(v);
        else hide();
        return;
      }
      syncDisabled();
      if (!gate.awaiting && status.textContent === 'Sending...') setText(status, '');
    },
    commandReply(ok, text) {
      gateReply(gate, ok);
      if (!ok) {
        setText(status, text);
        guard.cardShown();
        syncDisabled();
        if (open) choices[0].button.focus();
      }
    },
    isOpen() {
      return open;
    },
    dispose() {
      document.removeEventListener('keydown', onKey);
      card.remove();
      dim.remove();
    },
  };
}
