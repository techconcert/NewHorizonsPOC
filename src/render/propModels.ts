import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { Model } from './settlementPlan';
import { PropKind } from './propPlan';

/**
 * Low-poly models for props, districts, huts and crowd dots, each one merged from a few
 * primitives into a single non-indexed BufferGeometry with vertex colours (flat shaded, with a
 * little fake ambient occlusion that darkens the foot of every part). Built once per planet view;
 * instances then only differ by matrix and tint. Footprints are in hex units (a hex has a
 * circumradius of 1), so a model fits inside about +-0.5 of its tile centre.
 */

interface Part {
  geo: BufferGeometry;
  color: number;
  x?: number;
  y?: number;
  z?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  /** Rotation about X, Z and then Y, in radians. */
  rx?: number;
  rz?: number;
  ry?: number;
  /** Foot darkening, 0 none .. 1 black at the bottom (default 0.35). */
  ao?: number;
}

const tmpColor = new Color();

/** Merge `parts` into one flat-shaded, vertex-coloured geometry. The part geometries are disposed. */
export function mergeParts(parts: Part[]): BufferGeometry {
  let total = 0;
  const sources: BufferGeometry[] = [];
  for (const part of parts) {
    const g = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    sources.push(g);
    total += g.getAttribute('position').count;
  }
  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let v = 0;
  for (let n = 0; n < parts.length; n++) {
    const part = parts[n];
    const src = sources[n].getAttribute('position');
    const count = src.count;
    const sx = part.sx ?? 1;
    const sy = part.sy ?? 1;
    const sz = part.sz ?? 1;
    const rx = part.rx ?? 0;
    const rz = part.rz ?? 0;
    const ry = part.ry ?? 0;
    const cxr = Math.cos(rx);
    const sxr = Math.sin(rx);
    const czr = Math.cos(rz);
    const szr = Math.sin(rz);
    const cyr = Math.cos(ry);
    const syr = Math.sin(ry);
    const start = v;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      let x = src.getX(i) * sx;
      let y = src.getY(i) * sy;
      let z = src.getZ(i) * sz;
      // about X
      let t = y * cxr - z * sxr;
      z = y * sxr + z * cxr;
      y = t;
      // about Z
      t = x * czr - y * szr;
      y = x * szr + y * czr;
      x = t;
      // about Y
      t = x * cyr + z * syr;
      z = -x * syr + z * cyr;
      x = t;
      x += part.x ?? 0;
      y += part.y ?? 0;
      z += part.z ?? 0;
      pos[v * 3] = x;
      pos[v * 3 + 1] = y;
      pos[v * 3 + 2] = z;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      v++;
    }
    tmpColor.setHex(part.color);
    const ao = part.ao ?? 0.35;
    const span = maxY - minY > 1e-6 ? maxY - minY : 1;
    for (let i = start; i < v; i++) {
      const f = 1 - ao * (1 - (pos[i * 3 + 1] - minY) / span);
      col[i * 3] = tmpColor.r * f;
      col[i * 3 + 1] = tmpColor.g * f;
      col[i * 3 + 2] = tmpColor.b * f;
    }
  }
  for (const part of parts) part.geo.dispose();
  for (const g of sources) g.dispose();
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new Float32BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}

const cyl = (rt: number, rb: number, h: number, seg = 6): CylinderGeometry =>
  new CylinderGeometry(rt, rb, h, seg, 1);
const cone = (r: number, h: number, seg = 6): ConeGeometry => new ConeGeometry(r, h, seg, 1);
const box = (w: number, h: number, d: number): BoxGeometry => new BoxGeometry(w, h, d);
const ico = (r: number): IcosahedronGeometry => new IcosahedronGeometry(r, 0);
const dome = (r: number): SphereGeometry =>
  new SphereGeometry(r, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);

const BROWN = 0x6b4a2b;

function pine(): BufferGeometry {
  return mergeParts([
    { geo: cyl(0.025, 0.035, 0.1, 5), color: BROWN, y: 0.05 },
    { geo: cone(0.17, 0.22), color: 0x2f6b3a, y: 0.2 },
    { geo: cone(0.135, 0.2), color: 0x388043, y: 0.33 },
    { geo: cone(0.1, 0.18), color: 0x409350, y: 0.45 },
  ]);
}

function roundTree(): BufferGeometry {
  return mergeParts([
    { geo: cyl(0.03, 0.04, 0.16, 5), color: BROWN, y: 0.08 },
    { geo: ico(0.15), color: 0x56a64a, y: 0.27, sy: 0.9 },
    { geo: ico(0.1), color: 0x66b857, x: 0.08, y: 0.2, z: 0.04 },
  ]);
}

function rock(): BufferGeometry {
  return mergeParts([
    { geo: ico(0.12), color: 0x8e8a86, y: 0.05, sy: 0.65, sz: 0.9 },
    { geo: ico(0.07), color: 0x7b7773, x: 0.12, y: 0.03, z: 0.05, ry: 0.8 },
  ]);
}

function crystal(): BufferGeometry {
  return mergeParts([
    { geo: new OctahedronGeometry(0.07, 0), color: 0xe6f4ff, y: 0.2, sy: 2.8, ao: 0.5 },
    {
      geo: new OctahedronGeometry(0.06, 0),
      color: 0xc8e6ff,
      x: 0.08,
      y: 0.12,
      z: 0.03,
      sy: 2,
      rz: -0.25,
      ao: 0.5,
    },
    {
      geo: new OctahedronGeometry(0.05, 0),
      color: 0xdcefff,
      x: -0.06,
      y: 0.09,
      z: -0.03,
      sy: 1.8,
      rz: 0.3,
      ao: 0.5,
    },
  ]);
}

function pillar(): BufferGeometry {
  return mergeParts([
    { geo: box(0.18, 0.05, 0.18), color: 0xb89a62, y: 0.025 },
    { geo: cyl(0.06, 0.07, 0.3, 6), color: 0xcaa86a, y: 0.2 },
    { geo: box(0.16, 0.04, 0.16), color: 0xb89a62, y: 0.37 },
  ]);
}

function slab(): BufferGeometry {
  return mergeParts([
    { geo: box(0.28, 0.07, 0.2), color: 0xb89a62, y: 0.035 },
    { geo: box(0.14, 0.1, 0.14), color: 0xc4a76e, x: 0.1, y: 0.05, z: 0.06, ry: 0.5 },
  ]);
}

function tuft(): BufferGeometry {
  return mergeParts([
    { geo: cone(0.025, 0.09, 4), color: 0x7bc04e, y: 0.045 },
    { geo: cone(0.022, 0.07, 4), color: 0x69b043, x: 0.04, y: 0.035, z: 0.02 },
    { geo: cone(0.02, 0.06, 4), color: 0x88cc5a, x: -0.03, y: 0.03, z: 0.03 },
  ]);
}

function farm(): BufferGeometry {
  const parts: Part[] = [
    { geo: box(0.8, 0.03, 0.62), color: 0xcaa64a, y: 0.015, ao: 0 },
    { geo: box(0.7, 0.02, 0.06), color: 0x6e9e3c, y: 0.04, z: -0.2, ao: 0 },
    { geo: box(0.7, 0.02, 0.06), color: 0x7aae44, y: 0.04, z: -0.05, ao: 0 },
    { geo: box(0.7, 0.02, 0.06), color: 0x6e9e3c, y: 0.04, z: 0.1, ao: 0 },
    { geo: box(0.22, 0.14, 0.2), color: 0xb5483a, x: 0.26, y: 0.1, z: 0.2 },
    { geo: cone(0.2, 0.1, 4), color: 0x7a2f26, x: 0.26, y: 0.22, z: 0.2, ry: Math.PI / 4 },
  ];
  return mergeParts(parts);
}

function mine(): BufferGeometry {
  return mergeParts([
    { geo: cone(0.28, 0.24, 7), color: 0x6b5f57, x: -0.16, y: 0.12, z: 0.12 },
    { geo: box(0.04, 0.44, 0.04), color: 0x39414d, x: 0.14, y: 0.22, z: -0.1, rz: 0.22 },
    { geo: box(0.04, 0.44, 0.04), color: 0x39414d, x: 0.26, y: 0.22, z: -0.1, rz: -0.22 },
    { geo: box(0.2, 0.03, 0.03), color: 0x4a5461, x: 0.2, y: 0.36, z: -0.1 },
    {
      geo: cyl(0.06, 0.06, 0.03, 8),
      color: 0xf08a2e,
      x: 0.2,
      y: 0.42,
      z: -0.1,
      rx: Math.PI / 2,
      ao: 0,
    },
    { geo: box(0.12, 0.06, 0.08), color: 0xf08a2e, x: 0.02, y: 0.05, z: -0.25 },
    { geo: ico(0.06), color: 0x9a8f86, x: -0.35, y: 0.04, z: -0.05 },
  ]);
}

function refinery(): BufferGeometry {
  return mergeParts([
    { geo: box(0.74, 0.03, 0.62), color: 0x4a5360, y: 0.015, ao: 0 },
    { geo: cyl(0.14, 0.14, 0.2, 10), color: 0x8da3b5, x: -0.2, y: 0.13, z: 0.1 },
    { geo: cyl(0.11, 0.11, 0.3, 10), color: 0xa4b6c4, x: 0.04, y: 0.18, z: 0.2 },
    { geo: cyl(0.05, 0.07, 0.56, 8), color: 0x5a6572, x: 0.24, y: 0.3, z: -0.12 },
    { geo: cyl(0.055, 0.055, 0.05, 8), color: 0xff7a2f, x: 0.24, y: 0.52, z: -0.12, ao: 0 },
    { geo: box(0.44, 0.03, 0.03), color: 0x6c7886, x: -0.05, y: 0.26, z: 0.0 },
  ]);
}

function habitat(): BufferGeometry {
  return mergeParts([
    { geo: cyl(0.46, 0.48, 0.03, 12), color: 0xd9e4e8, y: 0.015, ao: 0 },
    { geo: dome(0.2), color: 0x4fd0c4, x: -0.13, y: 0.03, z: 0.05 },
    { geo: dome(0.15), color: 0x7ee0d6, x: 0.22, y: 0.03, z: 0.12 },
    { geo: dome(0.13), color: 0x4fd0c4, x: 0.08, y: 0.03, z: -0.26 },
    { geo: box(0.04, 0.16, 0.04), color: 0xeaf4f6, x: -0.3, y: 0.11, z: -0.16 },
  ]);
}

function research(): BufferGeometry {
  return mergeParts([
    { geo: cyl(0.3, 0.34, 0.04, 8), color: 0x6a5aa8, y: 0.02, ao: 0 },
    { geo: cyl(0.06, 0.09, 0.5, 8), color: 0xe2dcff, y: 0.29 },
    { geo: new SphereGeometry(0.12, 8, 6), color: 0xb98cff, y: 0.58, ao: 0.2 },
    { geo: new TorusGeometry(0.2, 0.015, 5, 14), color: 0x7fe9ff, y: 0.58, rx: Math.PI / 2, ao: 0 },
    { geo: box(0.22, 0.12, 0.18), color: 0x9c8ae0, x: 0.25, y: 0.1, z: 0.2 },
  ]);
}

function spaceport(): BufferGeometry {
  const red = 0xe5483b;
  return mergeParts([
    { geo: cyl(0.46, 0.46, 0.03, 16), color: 0x7d8794, y: 0.015, ao: 0 },
    { geo: cyl(0.3, 0.3, 0.036, 16), color: 0xaab3bf, y: 0.018, ao: 0 },
    { geo: cyl(0.07, 0.08, 0.38, 8), color: 0xf4f6f8, y: 0.22 },
    { geo: cone(0.07, 0.14, 8), color: red, y: 0.48, ao: 0 },
    { geo: box(0.02, 0.1, 0.1), color: red, x: 0.08, y: 0.1, ao: 0 },
    { geo: box(0.02, 0.1, 0.1), color: red, x: -0.08, y: 0.1, ao: 0 },
    { geo: box(0.1, 0.1, 0.02), color: red, z: 0.08, y: 0.1, ao: 0 },
    { geo: box(0.06, 0.3, 0.06), color: 0xcfd6dd, x: 0.32, y: 0.17, z: 0.2 },
    { geo: box(0.12, 0.05, 0.12), color: 0x7fe9ff, x: 0.32, y: 0.34, z: 0.2, ao: 0 },
  ]);
}

function core(): BufferGeometry {
  return mergeParts([
    { geo: cyl(0.3, 0.34, 0.08, 8), color: 0xd8c9a0, y: 0.04 },
    { geo: cyl(0.22, 0.26, 0.14, 8), color: 0xf0e2b8, y: 0.15 },
    { geo: cyl(0.14, 0.18, 0.12, 8), color: 0xffe8a8, y: 0.28 },
    { geo: cone(0.06, 0.3, 6), color: 0xffcf5d, y: 0.49, ao: 0.1 },
    { geo: new SphereGeometry(0.045, 6, 4), color: 0xfff2b0, y: 0.68, ao: 0 },
  ]);
}

function hut(): BufferGeometry {
  return mergeParts([
    { geo: cyl(0.1, 0.11, 0.1, 7), color: 0xb59568, y: 0.05 },
    { geo: cone(0.14, 0.13, 7), color: 0xf2ead8, y: 0.165 },
  ]);
}

function dot(): BufferGeometry {
  return mergeParts([
    { geo: cyl(0.025, 0.03, 0.06, 5), color: 0xf0e6d0, y: 0.03 },
    { geo: new SphereGeometry(0.03, 5, 4), color: 0xffffff, y: 0.085, ao: 0 },
  ]);
}

const PROP_BUILDERS: Record<number, () => BufferGeometry> = {
  [PropKind.Pine]: pine,
  [PropKind.Round]: roundTree,
  [PropKind.Rock]: rock,
  [PropKind.Crystal]: crystal,
  [PropKind.Pillar]: pillar,
  [PropKind.Slab]: slab,
  [PropKind.Tuft]: tuft,
};

const SITE_BUILDERS: Record<number, () => BufferGeometry> = {
  [Model.Farm]: farm,
  [Model.Mine]: mine,
  [Model.Refinery]: refinery,
  [Model.Habitat]: habitat,
  [Model.Research]: research,
  [Model.Spaceport]: spaceport,
  [Model.Core]: core,
  [Model.Hut]: hut,
  [Model.Dot]: dot,
};

/** Geometry of prop kind `kind` (a PropKind). The caller owns and disposes it. */
export function buildPropGeometry(kind: number): BufferGeometry {
  return PROP_BUILDERS[kind]();
}

/** Geometry of site model `model` (a Model). The caller owns and disposes it. */
export function buildSiteGeometry(model: number): BufferGeometry {
  return SITE_BUILDERS[model]();
}

// ---- Simplified district silhouettes (colony LOD, M6c) ------------------------------------------
// Two or three parts each, low segment counts, the same colours and footprint as the full models,
// so a district reads the same from far away at a fraction of the triangles.

function farmSimple(): BufferGeometry {
  return mergeParts([
    { geo: box(0.8, 0.03, 0.62), color: 0xcaa64a, y: 0.015, ao: 0 },
    { geo: box(0.22, 0.2, 0.2), color: 0xb5483a, x: 0.26, y: 0.13, z: 0.2 },
  ]);
}

function mineSimple(): BufferGeometry {
  return mergeParts([
    { geo: cone(0.28, 0.24, 5), color: 0x6b5f57, x: -0.16, y: 0.12, z: 0.12 },
    { geo: box(0.2, 0.44, 0.06), color: 0x39414d, x: 0.2, y: 0.22, z: -0.1 },
  ]);
}

function refinerySimple(): BufferGeometry {
  return mergeParts([
    { geo: box(0.74, 0.03, 0.62), color: 0x4a5360, y: 0.015, ao: 0 },
    { geo: cyl(0.14, 0.14, 0.26, 5), color: 0x8da3b5, x: -0.1, y: 0.16, z: 0.12 },
    { geo: cyl(0.06, 0.07, 0.56, 5), color: 0x5a6572, x: 0.24, y: 0.3, z: -0.12 },
  ]);
}

function habitatSimple(): BufferGeometry {
  return mergeParts([
    { geo: cyl(0.46, 0.48, 0.03, 8), color: 0xd9e4e8, y: 0.015, ao: 0 },
    {
      geo: new SphereGeometry(0.2, 5, 3, 0, Math.PI * 2, 0, Math.PI / 2),
      color: 0x4fd0c4,
      x: -0.1,
      y: 0.03,
      z: 0.05,
    },
    {
      geo: new SphereGeometry(0.15, 5, 3, 0, Math.PI * 2, 0, Math.PI / 2),
      color: 0x7ee0d6,
      x: 0.2,
      y: 0.03,
      z: 0.1,
    },
  ]);
}

function researchSimple(): BufferGeometry {
  return mergeParts([
    { geo: cyl(0.3, 0.34, 0.04, 6), color: 0x6a5aa8, y: 0.02, ao: 0 },
    { geo: cyl(0.07, 0.09, 0.5, 5), color: 0xe2dcff, y: 0.29 },
    { geo: new SphereGeometry(0.12, 5, 4), color: 0xb98cff, y: 0.58, ao: 0.2 },
  ]);
}

function spaceportSimple(): BufferGeometry {
  return mergeParts([
    { geo: cyl(0.46, 0.46, 0.03, 8), color: 0x7d8794, y: 0.015, ao: 0 },
    { geo: cyl(0.07, 0.08, 0.38, 5), color: 0xf4f6f8, y: 0.22 },
    { geo: cone(0.07, 0.14, 5), color: 0xe5483b, y: 0.48, ao: 0 },
  ]);
}

function coreSimple(): BufferGeometry {
  return mergeParts([
    { geo: cyl(0.26, 0.34, 0.22, 6), color: 0xf0e2b8, y: 0.11 },
    { geo: cone(0.1, 0.5, 5), color: 0xffcf5d, y: 0.45, ao: 0.1 },
  ]);
}

const SIMPLE_BUILDERS: Record<number, () => BufferGeometry> = {
  [Model.Farm]: farmSimple,
  [Model.Mine]: mineSimple,
  [Model.Refinery]: refinerySimple,
  [Model.Habitat]: habitatSimple,
  [Model.Research]: researchSimple,
  [Model.Spaceport]: spaceportSimple,
  [Model.Core]: coreSimple,
};

/** Models that have a simplified silhouette: the six districts and the colony core. */
export const SIMPLE_MODEL_COUNT = 7;

/** Simplified geometry of site model `model` (Farm .. Core). The caller owns and disposes it. */
export function buildSimpleSiteGeometry(model: number): BufferGeometry {
  return SIMPLE_BUILDERS[model]();
}
