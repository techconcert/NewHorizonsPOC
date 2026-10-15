/**
 * Local error log (M8, D-147). A ring buffer of the last 50 uncaught errors and unhandled promise
 * rejections, kept in memory only. Nothing is sent anywhere: the Settings dialog shows the entries
 * and a Copy button puts them on the clipboard for the player to paste into a bug report.
 */

export const ERROR_LOG_CAPACITY = 50;
/** Longest message / stack kept per entry, so one huge error cannot fill the memory. */
export const ERROR_TEXT_MAX = 2000;

export type ErrorSource = 'error' | 'rejection' | 'worker' | 'manual';

export interface ErrorEntry {
  /** 1-based number over the whole session (keeps counting after the ring wraps). */
  seq: number;
  /** Wall-clock time in ms (Date.now at the moment of the error), for display only. */
  at: number;
  source: ErrorSource;
  message: string;
  /** Where it came from ("file:line:col") or the first stack lines; '' when unknown. */
  detail: string;
}

export interface ErrorLog {
  add(source: ErrorSource, message: string, detail?: string, at?: number): void;
  /** Oldest first. */
  entries(): readonly ErrorEntry[];
  /** Total errors seen, including the ones the ring has dropped. */
  total(): number;
  clear(): void;
  subscribe(fn: () => void): () => void;
  /** Plain text of all entries for the clipboard. */
  format(): string;
}

function cut(s: string): string {
  return s.length > ERROR_TEXT_MAX ? `${s.slice(0, ERROR_TEXT_MAX)}...` : s;
}

/** A readable message for anything that can be thrown or rejected. */
export function describeThrown(value: unknown): { message: string; detail: string } {
  if (value instanceof Error) {
    const stack = value.stack ?? '';
    const lines = stack
      .split('\n')
      .slice(1, 4)
      .map((l) => l.trim())
      .join(' | ');
    return { message: value.message || value.name, detail: lines };
  }
  if (typeof value === 'string') return { message: value, detail: '' };
  try {
    return { message: JSON.stringify(value) ?? String(value), detail: '' };
  } catch {
    return { message: String(value), detail: '' };
  }
}

export function createErrorLog(capacity: number = ERROR_LOG_CAPACITY): ErrorLog {
  const ring: ErrorEntry[] = [];
  let seq = 0;
  const listeners = new Set<() => void>();
  return {
    add(source, message, detail = '', at = 0) {
      seq++;
      const entry: ErrorEntry = {
        seq,
        at,
        source,
        message: cut(message === '' ? 'Unknown error' : message),
        detail: cut(detail),
      };
      ring.push(entry);
      if (ring.length > capacity) ring.shift();
      for (const fn of [...listeners]) fn();
    },
    entries: () => ring,
    total: () => seq,
    clear() {
      ring.length = 0;
      for (const fn of [...listeners]) fn();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    format() {
      if (ring.length === 0) return 'No errors recorded.';
      const dropped = seq - ring.length;
      const head =
        dropped > 0 ? [`(${dropped} older ${dropped === 1 ? 'entry' : 'entries'} dropped)`] : [];
      const lines = ring.map((e) => {
        const when = e.at > 0 ? new Date(e.at).toISOString() : 'time unknown';
        return `#${e.seq} ${when} [${e.source}] ${e.message}${e.detail === '' ? '' : `\n    ${e.detail}`}`;
      });
      return [...head, ...lines].join('\n');
    },
  };
}

/**
 * Hook window.onerror-style events and unhandled rejections into `log`. Uses addEventListener so it
 * does not replace handlers set by other code. Returns the function that removes the hooks.
 */
export function installErrorCapture(target: Window, log: ErrorLog): () => void {
  const onError = (e: ErrorEvent): void => {
    const where = e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : '';
    const thrown = e.error === undefined || e.error === null ? null : describeThrown(e.error);
    log.add(
      'error',
      e.message || thrown?.message || 'Script error',
      where || thrown?.detail || '',
      Date.now(),
    );
  };
  const onRejection = (e: PromiseRejectionEvent): void => {
    const d = describeThrown(e.reason);
    log.add('rejection', d.message, d.detail, Date.now());
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
