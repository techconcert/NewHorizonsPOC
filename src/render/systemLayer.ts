import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  type Scene,
} from 'three';
import {
  PIP_COLORS,
  SHIP_KIND_COLORS,
  SYSTEM_COLONY_COLOR,
  SYSTEM_ORBIT_COLOR,
  SYSTEM_ORBIT_SELECTED_COLOR,
  SYSTEM_SELECT_COLOR,
} from './palette';
import {
  habBand,
  HAB_BAND_COLORS,
  orbitRadius,
  PLANET_RADIUS,
  planetOffset,
  planetSizeJitter,
  surveyLook,
} from './zoom';

/**
 * The planets of one system, drawn over the galaxy camera once it has flown into the star (M6c,
 * D-123): thin orbit rings, one lit sphere per planet (colour by habitability band, tone and size
 * by survey level), a ring pattern per survey level, a pulsing ring on a colony, a dashed turning
 * ring on the selected planet and small arrows for ships parked in orbit. Everything is a fixed
 * capacity InstancedMesh or one LineSegments, filled in place; nothing allocates after creation.
 */

/** Most planets a system can hold here (the sim allows 5). */
export const MAX_SYSTEM_PLANETS = 8;
const RING_SEGMENTS = 72;
const MAX_PARKED_SHOWN = 3;
const SHIP_ARROW_RADIUS = 3.2;

// Ring kinds in the fragment shader (0..3 = RING_* of zoom.ts).
const KIND_COLONY = 4;
const KIND_SELECT = 5;

const PLANET_VERTEX = /* glsl */ `
attribute vec2 aTone;
attribute float aLevel;
attribute vec2 aDir;
varying vec2 vP;
varying vec3 vCol;
varying vec2 vTone;
varying float vLevel;
varying vec2 vDir;
void main() {
  vP = position.xy;
  vCol = instanceColor;
  vTone = aTone;
  vLevel = aLevel;
  vDir = aDir;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const PLANET_FRAGMENT = /* glsl */ `
uniform float uAlpha;
varying vec2 vP;
varying vec3 vCol;
varying vec2 vTone;
varying float vLevel;
varying vec2 vDir;
void main() {
  float d = length(vP);
  if (d > 1.0) discard;
  float aa = max(fwidth(d), 0.004);
  vec3 n = vec3(vP, sqrt(max(1.0 - d * d, 0.0)));
  vec3 L = normalize(vec3(vDir * 0.85, 0.5));
  float lit = clamp(dot(n, L), 0.0, 1.0);
  float shade = 0.14 + 0.86 * smoothstep(0.0, 0.85, lit);
  float luma = dot(vCol, vec3(0.299, 0.587, 0.114));
  vec3 c = mix(vec3(luma), vCol, vTone.x) * vTone.y * shade;
  if (vLevel < 0.5) {
    c *= 0.75 + 0.25 * step(0.5, fract((vP.x - vP.y) * 4.0));
  } else if (vLevel > 2.5) {
    c += vec3(0.20, 0.42, 0.62) * pow(1.0 - n.z, 3.0) * (0.35 + 0.65 * lit);
  }
  float a = 1.0 - smoothstep(1.0 - aa * 2.0, 1.0, d);
  gl_FragColor = vec4(c, a * uAlpha);
  #include <colorspace_fragment>
}
`;

const RING_VERTEX = /* glsl */ `
attribute float aKind;
attribute float aPhase;
varying vec2 vP;
varying vec3 vCol;
varying float vKind;
varying float vPhase;
void main() {
  vP = position.xy;
  vCol = instanceColor;
  vKind = aKind;
  vPhase = aPhase;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const RING_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uMotion;
uniform float uAlpha;
varying vec2 vP;
varying vec3 vCol;
varying float vKind;
varying float vPhase;
const float TAU = 6.28318530718;
float band(float d, float lo, float hi, float aa) {
  return smoothstep(lo - aa, lo + aa, d) * (1.0 - smoothstep(hi - aa, hi + aa, d));
}
void main() {
  float d = length(vP);
  if (d > 1.0) discard;
  float aa = max(fwidth(d), 0.003);
  float t = uTime * uMotion;
  float ang = atan(vP.y, vP.x) / TAU + 0.5;
  float a = 0.0;
  if (vKind < 0.5) {
    a = band(d, 0.84, 0.9, aa) * step(0.5, fract(ang * 10.0));
  } else if (vKind < 1.5) {
    a = band(d, 0.85, 0.89, aa);
  } else if (vKind < 2.5) {
    a = band(d, 0.76, 0.8, aa) + band(d, 0.88, 0.93, aa);
  } else if (vKind < 3.5) {
    a = 0.4 * smoothstep(0.64, 0.76, d) * (1.0 - smoothstep(0.76, 1.0, d)) + band(d, 0.86, 0.92, aa);
  } else if (vKind < 4.5) {
    a = band(d, 0.8, 0.88, aa);
    float p = fract(t * 0.3 + vPhase);
    float pr = 0.5 + 0.5 * p;
    a += (1.0 - p) * 0.7 * band(d, pr - 0.04, pr + 0.04, aa);
  } else {
    float dashes = step(0.5, fract(ang * 12.0 + t * 0.15));
    a = band(d, 0.86, 0.95, aa) * (0.35 + 0.65 * dashes);
  }
  if (a <= 0.003) discard;
  gl_FragColor = vec4(vCol, min(a, 1.0) * uAlpha);
  #include <colorspace_fragment>
}
`;

/** Planet-indexed arrays the layer reads (the galaxy view keeps local mirrors of these). */
export interface SystemPlanetData {
  survey: ArrayLike<number>;
  habLo: ArrayLike<number>;
  habHi: ArrayLike<number>;
  owned: ArrayLike<number>;
  /** Ships waiting in orbit per planet. */
  parked: ArrayLike<number>;
}

export interface SystemLayer {
  /** Lay out `count` planets (indices planetStart ..) round the star at (starX, starY). */
  setSystem(system: number, starX: number, starY: number, planetStart: number, count: number): void;
  /** Rewrite every instance from `data`. Cheap; call when the data changed. */
  refresh(data: SystemPlanetData): void;
  /** Highlight the planet in this slot (-1 for none). */
  setSelectedSlot(slot: number): void;
  /** Overall opacity 0..1; the group is hidden at 0. */
  setAlpha(alpha: number): void;
  setTime(seconds: number): void;
  /** World x, y of each planet, valid for `count` planets after setSystem. */
  readonly worldPos: Float32Array;
  readonly count: number;
  /** True while something pulses or turns (the view then redraws at its animation beat). */
  readonly animated: boolean;
  /** Screen radius in world units of the planet in `slot` (for hit tests). */
  bodyRadius(slot: number): number;
  dispose(): void;
}

export function createSystemLayer(
  scene: Scene,
  motionOk: boolean,
  renderOrderBase: number,
): SystemLayer {
  const root = new Group();
  root.visible = false;
  scene.add(root);

  const tmp = new Color();
  const toLinear = (hex: number, out: Float32Array, at: number): void => {
    tmp.setHex(hex);
    out[at] = tmp.r;
    out[at + 1] = tmp.g;
    out[at + 2] = tmp.b;
  };
  const bandLinear = new Float32Array(HAB_BAND_COLORS.length * 3);
  HAB_BAND_COLORS.forEach((c, i) => toLinear(c, bandLinear, i * 3));
  const ringLinear = new Float32Array(PIP_COLORS.length * 3);
  PIP_COLORS.forEach((c, i) => toLinear(c, ringLinear, i * 3));
  const colonyLinear = new Float32Array(3);
  toLinear(SYSTEM_COLONY_COLOR, colonyLinear, 0);
  const selectLinear = new Float32Array(3);
  toLinear(SYSTEM_SELECT_COLOR, selectLinear, 0);
  const orbitLinear = new Float32Array(3);
  toLinear(SYSTEM_ORBIT_COLOR, orbitLinear, 0);
  const orbitSelLinear = new Float32Array(3);
  toLinear(SYSTEM_ORBIT_SELECTED_COLOR, orbitSelLinear, 0);
  const shipLinear = new Float32Array(3);
  toLinear(SHIP_KIND_COLORS.arrived, shipLinear, 0);

  const uniforms = {
    uAlpha: { value: 0 },
    uTime: { value: 0 },
    uMotion: { value: motionOk ? 1 : 0 },
  };

  function instancedAttr(
    geo: BufferGeometry,
    name: string,
    size: number,
    cap: number,
  ): Float32Array {
    const arr = new Float32Array(cap * size);
    geo.setAttribute(name, new InstancedBufferAttribute(arr, size).setUsage(DynamicDrawUsage));
    return arr;
  }
  function prepare(mesh: InstancedMesh, cap: number, order: number): void {
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.instanceColor.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.renderOrder = order;
    root.add(mesh);
  }

  // Orbit rings: one LineSegments, a closed circle of RING_SEGMENTS segments per planet.
  const ringPos = new Float32Array(MAX_SYSTEM_PLANETS * RING_SEGMENTS * 6);
  const ringCol = new Float32Array(MAX_SYSTEM_PLANETS * RING_SEGMENTS * 6);
  const ringGeo = new BufferGeometry();
  ringGeo.setAttribute('position', new BufferAttribute(ringPos, 3).setUsage(DynamicDrawUsage));
  ringGeo.setAttribute('color', new BufferAttribute(ringCol, 3).setUsage(DynamicDrawUsage));
  ringGeo.setDrawRange(0, 0);
  const ringMat = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
  });
  const orbits = new LineSegments(ringGeo, ringMat);
  orbits.frustumCulled = false;
  orbits.renderOrder = renderOrderBase;
  root.add(orbits);

  // Planet bodies.
  const bodyGeo = new PlaneGeometry(2, 2);
  const aTone = instancedAttr(bodyGeo, 'aTone', 2, MAX_SYSTEM_PLANETS);
  const aLevel = instancedAttr(bodyGeo, 'aLevel', 1, MAX_SYSTEM_PLANETS);
  const aDir = instancedAttr(bodyGeo, 'aDir', 2, MAX_SYSTEM_PLANETS);
  const bodyMat = new ShaderMaterial({
    uniforms,
    vertexShader: PLANET_VERTEX,
    fragmentShader: PLANET_FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const bodies = new InstancedMesh(bodyGeo, bodyMat, MAX_SYSTEM_PLANETS);
  prepare(bodies, MAX_SYSTEM_PLANETS, renderOrderBase + 1);

  // Survey rings, colony rings and the selection ring share one shader (kind per instance).
  const ringCap = MAX_SYSTEM_PLANETS * 3;
  const markGeo = new PlaneGeometry(2, 2);
  const aKind = instancedAttr(markGeo, 'aKind', 1, ringCap);
  const aPhase = instancedAttr(markGeo, 'aPhase', 1, ringCap);
  const markMat = new ShaderMaterial({
    uniforms,
    vertexShader: RING_VERTEX,
    fragmentShader: RING_FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const marks = new InstancedMesh(markGeo, markMat, ringCap);
  prepare(marks, ringCap, renderOrderBase + 2);

  // Ships parked in orbit: small dart arrows, same outline as the galaxy ships.
  const arrowGeo = new BufferGeometry();
  arrowGeo.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([1, 0, 0, -0.8, 0.62, 0, -0.35, 0, 0, -0.8, -0.62, 0]), 3),
  );
  arrowGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const shipMat = new MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
  });
  const shipCap = MAX_SYSTEM_PLANETS * MAX_PARKED_SHOWN;
  const shipMesh = new InstancedMesh(arrowGeo, shipMat, shipCap);
  prepare(shipMesh, shipCap, renderOrderBase + 3);

  const worldPos = new Float32Array(MAX_SYSTEM_PLANETS * 2);
  const offset = new Float32Array(MAX_SYSTEM_PLANETS * 2);
  const bodyR = new Float32Array(MAX_SYSTEM_PLANETS);
  let system = -1;
  let start = 0;
  let count = 0;
  let selectedSlot = -1;
  let animated = false;
  let alpha = 0;
  let lastData: SystemPlanetData | null = null;

  function writeOrbits(): void {
    let v = 0;
    for (let k = 0; k < count; k++) {
      const r = orbitRadius(k);
      const c = k === selectedSlot ? orbitSelLinear : orbitLinear;
      for (let s = 0; s < RING_SEGMENTS; s++) {
        const a0 = (s / RING_SEGMENTS) * Math.PI * 2;
        const a1 = ((s + 1) / RING_SEGMENTS) * Math.PI * 2;
        const o = v * 3;
        ringPos[o] = Math.cos(a0) * r;
        ringPos[o + 1] = Math.sin(a0) * r;
        ringPos[o + 2] = 0;
        ringPos[o + 3] = Math.cos(a1) * r;
        ringPos[o + 4] = Math.sin(a1) * r;
        ringPos[o + 5] = 0;
        for (let q = 0; q < 2; q++) {
          ringCol[o + q * 3] = c[0];
          ringCol[o + q * 3 + 1] = c[1];
          ringCol[o + q * 3 + 2] = c[2];
        }
        v += 2;
      }
    }
    ringGeo.setDrawRange(0, v);
    (ringGeo.attributes.position as BufferAttribute).needsUpdate = true;
    (ringGeo.attributes.color as BufferAttribute).needsUpdate = true;
  }

  function putQuad(
    mesh: InstancedMesh,
    n: number,
    x: number,
    y: number,
    radius: number,
    rgb: Float32Array,
    rgbAt: number,
  ): void {
    const m = mesh.instanceMatrix.array as Float32Array;
    const b = n * 16;
    m[b] = radius;
    m[b + 1] = 0;
    m[b + 4] = 0;
    m[b + 5] = radius;
    m[b + 10] = 1;
    m[b + 12] = x;
    m[b + 13] = y;
    m[b + 15] = 1;
    const c = (mesh.instanceColor as InstancedBufferAttribute).array as Float32Array;
    c[n * 3] = rgb[rgbAt];
    c[n * 3 + 1] = rgb[rgbAt + 1];
    c[n * 3 + 2] = rgb[rgbAt + 2];
  }

  function flush(mesh: InstancedMesh, n: number): void {
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    (mesh.instanceColor as InstancedBufferAttribute).needsUpdate = true;
  }

  function write(data: SystemPlanetData): void {
    let marksN = 0;
    let shipsN = 0;
    let pulse = false;
    const sm = shipMesh.instanceMatrix.array as Float32Array;
    const sc = (shipMesh.instanceColor as InstancedBufferAttribute).array as Float32Array;
    for (let k = 0; k < count; k++) {
      const p = start + k;
      const level = data.survey[p] | 0;
      const look = surveyLook(level);
      const r = PLANET_RADIUS * planetSizeJitter(p) * look.size;
      bodyR[k] = r;
      const x = offset[k * 2];
      const y = offset[k * 2 + 1];
      const band = habBand(data.habLo[p], data.habHi[p]);
      putQuad(bodies, k, x, y, r, bandLinear, band * 3);
      aTone[k * 2] = look.sat;
      aTone[k * 2 + 1] = look.light;
      aLevel[k] = level;
      // Light comes from the star: the direction from the planet back to the centre.
      const len = Math.sqrt(x * x + y * y) || 1;
      aDir[k * 2] = -x / len;
      aDir[k * 2 + 1] = -y / len;
      // Survey ring pattern, a little outside the body.
      const ri = (level < PIP_COLORS.length ? level : PIP_COLORS.length - 1) * 3;
      putQuad(marks, marksN, x, y, r * 1.55, ringLinear, ri);
      aKind[marksN] = look.ring;
      aPhase[marksN] = 0;
      marksN++;
      if (data.owned[p] !== 0) {
        putQuad(marks, marksN, x, y, r * 2.1, colonyLinear, 0);
        aKind[marksN] = KIND_COLONY;
        aPhase[marksN] = (k * 0.37) % 1;
        marksN++;
        pulse = true;
      }
      if (k === selectedSlot) {
        putQuad(marks, marksN, x, y, r * 2.6, selectLinear, 0);
        aKind[marksN] = KIND_SELECT;
        aPhase[marksN] = 0;
        marksN++;
        pulse = true;
      }
      // Parked ships sit on a small circle round the planet, arrows pointing along the orbit.
      const parked = Math.min(data.parked[p] | 0, MAX_PARKED_SHOWN);
      for (let s = 0; s < parked; s++) {
        const a = 0.6 + s * 2.1;
        const sx = x + Math.cos(a) * r * 1.95;
        const sy = y + Math.sin(a) * r * 1.95;
        const hx = -Math.sin(a) * SHIP_ARROW_RADIUS;
        const hy = Math.cos(a) * SHIP_ARROW_RADIUS;
        const b = shipsN * 16;
        sm[b] = hx;
        sm[b + 1] = hy;
        sm[b + 4] = -hy;
        sm[b + 5] = hx;
        sm[b + 10] = 1;
        sm[b + 12] = sx;
        sm[b + 13] = sy;
        sm[b + 15] = 1;
        sc[shipsN * 3] = shipLinear[0];
        sc[shipsN * 3 + 1] = shipLinear[1];
        sc[shipsN * 3 + 2] = shipLinear[2];
        shipsN++;
      }
    }
    animated = motionOk && pulse;
    flush(bodies, count);
    flush(marks, marksN);
    flush(shipMesh, shipsN);
    for (const name of ['aTone', 'aLevel', 'aDir']) {
      (bodyGeo.attributes[name] as InstancedBufferAttribute).needsUpdate = true;
    }
    (markGeo.attributes.aKind as InstancedBufferAttribute).needsUpdate = true;
    (markGeo.attributes.aPhase as InstancedBufferAttribute).needsUpdate = true;
  }

  return {
    setSystem(sys, starX, starY, planetStart, n) {
      system = sys;
      start = planetStart;
      count = Math.max(0, Math.min(n, MAX_SYSTEM_PLANETS));
      root.position.set(starX, starY, 0.2);
      for (let k = 0; k < count; k++) {
        planetOffset(system, k, offset, k * 2);
        worldPos[k * 2] = starX + offset[k * 2];
        worldPos[k * 2 + 1] = starY + offset[k * 2 + 1];
      }
      writeOrbits();
      if (lastData) write(lastData);
    },
    refresh(data) {
      lastData = data;
      if (count > 0) write(data);
    },
    setSelectedSlot(slot) {
      if (slot === selectedSlot) return;
      selectedSlot = slot;
      writeOrbits();
      if (lastData) write(lastData);
    },
    setAlpha(a) {
      alpha = a;
      uniforms.uAlpha.value = a;
      ringMat.opacity = 0.85 * a;
      shipMat.opacity = a;
      root.visible = a > 0.003;
    },
    setTime(seconds) {
      uniforms.uTime.value = seconds;
    },
    worldPos,
    get count() {
      return count;
    },
    get animated() {
      return animated && alpha > 0.003;
    },
    bodyRadius(slot) {
      return slot >= 0 && slot < count ? bodyR[slot] : 0;
    },
    dispose() {
      scene.remove(root);
      for (const g of [ringGeo, bodyGeo, markGeo, arrowGeo]) g.dispose();
      for (const m of [ringMat, bodyMat, markMat, shipMat]) m.dispose();
      for (const mesh of [bodies, marks, shipMesh]) mesh.dispose();
    },
  };
}
