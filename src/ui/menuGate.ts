/**
 * One menu operation at a time (save, load, new game) with a reply deadline (D-107). Pure: the
 * caller supplies the clock. A reply that arrives after the deadline (or for another operation) is
 * not accepted, so a lost worker message can never leave the menu busy for ever.
 */
export const MENU_REPLY_TIMEOUT_MS = 20000;

export interface MenuGate {
  readonly busy: boolean;
  /** Start an operation. Returns its id, or 0 when another one is under way. */
  begin(nowMs: number, timeoutMs?: number): number;
  /** True while `id` is the operation under way. */
  isActive(id: number): boolean;
  /** The reply for `id` arrived. True (and the gate is free again) only for the active operation. */
  accept(id: number): boolean;
  /** True once when the active operation has outlived its deadline; the gate is then free. */
  expire(nowMs: number): boolean;
}

export function createMenuGate(): MenuGate {
  let active = 0;
  let deadline = 0;
  let next = 1;
  return {
    get busy() {
      return active !== 0;
    },
    begin(nowMs, timeoutMs = MENU_REPLY_TIMEOUT_MS) {
      if (active !== 0) return 0;
      active = next++;
      deadline = nowMs + timeoutMs;
      return active;
    },
    isActive: (id) => id !== 0 && id === active,
    accept(id) {
      if (id === 0 || id !== active) return false;
      active = 0;
      return true;
    },
    expire(nowMs) {
      if (active === 0 || nowMs < deadline) return false;
      active = 0;
      return true;
    },
  };
}
