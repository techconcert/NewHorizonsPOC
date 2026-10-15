import { el, setHidden, setText } from './dom';
import type { BreakdownRow } from './rollModel';

/**
 * A small accessible table of factors: factor, value, running percentage, note. Rows are created
 * once and reused; text is written only when it changed.
 */
export interface FactorTable {
  root: HTMLTableElement;
  update(rows: readonly BreakdownRow[]): void;
}

interface RowDom {
  tr: HTMLTableRowElement;
  label: HTMLElement;
  value: HTMLElement;
  running: HTMLElement;
  note: HTMLElement;
}

export function createFactorTable(
  parent: HTMLElement,
  caption: string,
  runningHeader = 'Chance so far',
): FactorTable {
  const root = el('table', 'pv-table', parent);
  el('caption', 'pv-caption', root, caption);
  const head = el('thead', '', root);
  const hr = el('tr', '', head);
  for (const h of ['Factor', 'Value', runningHeader, 'Note']) {
    const th = el('th', 'pv-th', hr, h);
    th.scope = 'col';
  }
  const body = el('tbody', '', root);
  const rows: RowDom[] = [];

  function ensure(n: number): void {
    while (rows.length < n) {
      const tr = el('tr', 'pv-tr', body);
      const label = el('th', 'pv-td pv-label', tr);
      label.scope = 'row';
      const value = el('td', 'pv-td pv-num', tr);
      const running = el('td', 'pv-td pv-num', tr);
      const note = el('td', 'pv-td pv-note', tr);
      rows.push({ tr, label, value, running, note });
    }
  }

  return {
    root,
    update(data) {
      ensure(data.length);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const d = i < data.length ? data[i] : null;
        setHidden(r.tr, d === null);
        if (d === null) continue;
        setText(r.label, d.label);
        setText(r.value, d.value);
        setText(r.running, d.running);
        setText(r.note, d.note);
      }
    },
  };
}
