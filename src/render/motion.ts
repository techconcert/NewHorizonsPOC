/**
 * Reduced-motion switch shared by the views (M8, D-150). The Settings override ('system', 'reduce',
 * 'full') is kept here as module state; `reducedMotion()` combines it with the system preference.
 * The pure rule is duplicated from ui/settingsModel (render may not import ui) and tested for equality.
 */

export type MotionOverride = 'system' | 'reduce' | 'full';

let override: MotionOverride = 'system';

export function setMotionOverride(value: MotionOverride): void {
  override = value;
}

export function motionOverride(): MotionOverride {
  return override;
}

/** The pure rule: the override wins, otherwise the system preference. */
export function resolveReducedMotion(
  choice: MotionOverride,
  systemPrefersReduced: boolean,
): boolean {
  if (choice === 'reduce') return true;
  if (choice === 'full') return false;
  return systemPrefersReduced;
}

export function systemPrefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

export function reducedMotion(): boolean {
  return resolveReducedMotion(override, systemPrefersReducedMotion());
}
