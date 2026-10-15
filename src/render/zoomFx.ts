/**
 * The colony close-up grade (M6c): one fixed DOM layer over the planet canvas that paints a radial
 * vignette, a soft dark band at the top and bottom edges (a cheap stand-in for tilt-shift) and a
 * faint warm tint, all from CSS gradients. Only its opacity changes, so it costs one composited
 * layer and no extra WebGL pass. The colours are tokens in style.css.
 */
export interface ZoomFx {
  /** Strength 0..1; the layer is hidden at 0. Writes the style only when the rounded value changed. */
  setStrength(strength: number): void;
  dispose(): void;
}

export function createZoomFx(after: HTMLElement): ZoomFx {
  const layer = document.createElement('div');
  layer.className = 'zoom-fx';
  layer.setAttribute('aria-hidden', 'true');
  after.after(layer);
  let shown = -1;
  return {
    setStrength(strength) {
      const q = Math.round((strength < 0 ? 0 : strength > 1 ? 1 : strength) * 100) / 100;
      if (q === shown) return;
      shown = q;
      layer.style.opacity = String(q);
    },
    dispose() {
      layer.remove();
    },
  };
}
