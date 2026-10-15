import { isSoftwareRendererName, parseFx, type Fx } from './perf';

/** `?fx=` flags, read once when the module loads. */
let fxCache: Fx | null = null;
export function getFx(): Fx {
  if (!fxCache) {
    fxCache = parseFx(typeof location === 'undefined' ? '' : location.search);
  }
  return fxCache;
}

let softwareCache: boolean | null = null;
/** True when WebGL runs on a software rasteriser (SwiftShader, llvmpipe). Probed once, false on any failure. */
export function isSoftwareGl(): boolean {
  if (softwareCache !== null) return softwareCache;
  softwareCache = false;
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl') as WebGLRenderingContext | null;
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        const name = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
        softwareCache = isSoftwareRendererName(name);
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    softwareCache = false;
  }
  return softwareCache;
}

/** MSAA only on real GPUs and unless `?fx=nomsaa`. */
export function wantAntialias(): boolean {
  return !getFx().noMsaa && !isSoftwareGl();
}

/** Starting render scale: the pinned `?fx=scale`, else 0.5 on software GL, else 1. */
export function startRenderScale(): number {
  const fx = getFx();
  if (fx.scale > 0) return fx.scale;
  return isSoftwareGl() ? 0.5 : 1;
}
