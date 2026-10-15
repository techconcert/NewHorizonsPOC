// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createErrorLog,
  describeThrown,
  ERROR_LOG_CAPACITY,
  ERROR_TEXT_MAX,
  installErrorCapture,
} from '../src/ui/errorLog';

describe('error log ring buffer', () => {
  it('holds 50 entries and drops the oldest', () => {
    expect(ERROR_LOG_CAPACITY).toBe(50);
    const log = createErrorLog();
    for (let i = 1; i <= 60; i++) log.add('error', `boom ${i}`, '', i);
    expect(log.entries().length).toBe(50);
    expect(log.entries()[0].message).toBe('boom 11');
    expect(log.entries()[0].seq).toBe(11);
    expect(log.entries()[49].message).toBe('boom 60');
    expect(log.total()).toBe(60);
  });

  it('cuts huge messages and names empty ones', () => {
    const log = createErrorLog();
    log.add('error', 'x'.repeat(ERROR_TEXT_MAX + 500));
    log.add('error', '');
    expect(log.entries()[0].message.length).toBe(ERROR_TEXT_MAX + 3);
    expect(log.entries()[1].message).toBe('Unknown error');
  });

  it('formats for the clipboard', () => {
    const log = createErrorLog(2);
    expect(log.format()).toBe('No errors recorded.');
    log.add('error', 'first', 'a.js:1:2', Date.UTC(2026, 9, 11, 12, 0, 0));
    log.add('rejection', 'second');
    log.add('worker', 'third');
    expect(log.format()).toBe(
      [
        '(1 older entry dropped)',
        '#2 time unknown [rejection] second',
        '#3 time unknown [worker] third',
      ].join('\n'),
    );
    const one = createErrorLog();
    one.add('error', 'first', 'a.js:1:2', Date.UTC(2026, 9, 11, 12, 0, 0));
    expect(one.format()).toBe('#1 2026-10-11T12:00:00.000Z [error] first\n    a.js:1:2');
  });

  it('notifies subscribers on add and clear, and clear empties the ring', () => {
    const log = createErrorLog();
    let n = 0;
    const off = log.subscribe(() => n++);
    log.add('manual', 'a');
    log.clear();
    expect(n).toBe(2);
    expect(log.entries().length).toBe(0);
    expect(log.total()).toBe(1);
    off();
    log.add('manual', 'b');
    expect(n).toBe(2);
  });
});

describe('describeThrown', () => {
  it('reads errors, strings and odd values', () => {
    const e = new Error('bad thing');
    expect(describeThrown(e).message).toBe('bad thing');
    expect(describeThrown('plain').message).toBe('plain');
    expect(describeThrown({ a: 1 }).message).toBe('{"a":1}');
    expect(describeThrown(undefined).message).toBe('undefined');
    expect(describeThrown(42).message).toBe('42');
  });
});

describe('capture hooks', () => {
  it('records window errors and unhandled rejections, and can be removed', () => {
    const handlers = new Map<string, (e: unknown) => void>();
    const target = {
      addEventListener: (t: string, fn: (e: unknown) => void) => handlers.set(t, fn),
      removeEventListener: (t: string) => handlers.delete(t),
    } as unknown as Window;
    const log = createErrorLog();
    const remove = installErrorCapture(target, log);
    handlers.get('error')?.({ message: 'Uncaught oops', filename: 'app.js', lineno: 4, colno: 7 });
    handlers.get('unhandledrejection')?.({ reason: new Error('nope') });
    expect(log.entries().map((e) => [e.source, e.message, e.detail.split(' | ')[0]])).toEqual([
      ['error', 'Uncaught oops', 'app.js:4:7'],
      ['rejection', 'nope', expect.any(String)],
    ]);
    remove();
    expect(handlers.size).toBe(0);
  });
});
