import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DataTexture,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LineLoop,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  OrthographicCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RepeatWrapping,
  RGBAFormat,
  RingGeometry,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  WebGLRenderer,
} from 'three';
import { colonisedSystems, isParkedState } from '../shared/planetSnapshot';
import {
  META_DAY,
  META_HOME_SYSTEM,
  META_SHIP_COUNT,
  META_SPEED,
  META_SYSTEM_COUNT,
  SHIP_POS_STRIDE,
  META_PLANET_COUNT,
  SNAPSHOT_MAX_PLANETS,
  SNAPSHOT_MAX_SHIPS,
  SNAPSHOT_MAX_SYSTEMS,
  type Snapshot,
} from '../shared/snapshot';
import { isFlying, legOrigin, SHIP_KINDS, SHIP_STATE, shipKindOf } from '../shared/transit';
import { fillNebula, fillStarField, NEBULA_SEED, STAR_FIELD_SEED } from './background';
import {
  fillColonyRanges,
  fillGlowTexture,
  fillSystemSurvey,
  isDoubleClick,
  launchOriginSystem,
  pipOffsetX,
  shipMarginWarning,
  starCoreRadius,
  starGlowGain,
  starGlowRadius,
  surveyBrightness,
  writeDashes,
} from './galaxyModel';
import {
  clampDt,
  clockAdvance,
  clockAlpha,
  clockOnSnapshot,
  createInterpClock,
  lerpShipPositions,
} from './interp';
import {
  BACKGROUND_COLOR,
  COLONY_RANGE_COLOR,
  COLONY_RING_COLOR,
  DEST_LINE_COLOR,
  HOME_COLOR,
  MARGIN_WARN_COLORS,
  PIP_COLORS,
  PREVIEW_COLOR,
  RANGE_COLOR,
  RANGE_FILL_OPACITY,
  REACH_COLOR,
  ROUTE_COLOR,
  ROUTE_SELECTED_COLOR,
  SELECTED_SHIP_RING_COLOR,
  SELECTED_SHIP_SCALE,
  SELECTION_COLOR,
  SHIP_KIND_COLORS,
  SHIP_KIND_SCALE,
  STAR_COLORS,
  STAR_FIELD_COUNT,
} from './palette';
import {
  createView,
  fitScale,
  normalizeWheelDelta,
  panBy,
  pickNearest,
  resizeView,
  screenX,
  screenY,
  zoomAt,
  type ViewState,
} from './pick';
import {
  createTrailStore,
  trailSyncShip,
  TRAIL_POINTS,
  writeTrailSegments,
  type TrailStore,
} from './trails';
import { getFx, isSoftwareGl, startRenderScale, wantAntialias } from './gpuProbe';
import { reducedMotion } from './motion';
import {
  animStepMs,
  applyQuality,
  clampGlowRadius,
  createScaler,
  effectivePixelRatio,
  glowGainCompensation,
  GLOW_QUAD_SCALE,
  rangeFillVisible,
  type RenderQuality,
  scalerSample,
  scalerScale,
} from './perf';
import { createSystemLayer, type SystemLayer, type SystemPlanetData } from './systemLayer';
import { computeSystemArea, createViewArea } from './viewArea';
import {
  createSlide,
  easeInOutCubic,
  EXIT_WHEEL_PX,
  focusView,
  galaxyFade,
  slideDone,
  slidePos,
  slideStart,
  systemFade,
  systemFitScale,
  SYSTEM_ZOOM_MS,
  wheelEntersSystem,
  type ViewTransform,
} from './zoom';

const SHIP_RADIUS = 6.5;
const SHIP_Z = 0.5;
const HOME_CORE_SCALE = 1.25;
const SELECTED_SCALE = 1.3;
const PICK_RADIUS_PX = 24;
const SHIP_PICK_RADIUS_PX = 14;
const CLICK_SLOP_PX = 4;
const PLANET_PICK_RADIUS_PX = 28;
const ENTER_PICK_RADIUS_PX = 40;
const ZOOM_PER_WHEEL_NOTCH = 1.0015;
const RANGE_SEGMENTS = 96;
/** Index of 'drifting' in SHIP_KINDS: kinds up to it (transit, event, drifting) get trails. */
const KIND_DRIFTING = SHIP_KINDS.indexOf('drifting');
const TRAIL_MAX_SEGMENTS = SNAPSHOT_MAX_SHIPS * TRAIL_POINTS;

// Art budget (M6a). Everything is a fixed-capacity buffer filled in place.
const GLOW_TEX_SIZE = 64;
const NEBULA_TEX_SIZE = 256;
/** World units one nebula tile covers. */
const NEBULA_TILE_WORLD = 1800;
const MARKER_CAP = 256;
const ROUTE_MAX_DASHES = 40;
const PREVIEW_MAX_DASHES = 60;
const DEST_MAX_DASHES = 60;
/** Glow strength on top of the per-type gain, and for ship engines. */
const GLOW_GAIN = 1.5;
const SHIP_GLOW_GAIN = 0.5;
const SHIP_GLOW_SCALE = 2.6;
const PIP_RADIUS = 2;
const PIP_SPACING = 6.2;
const PIP_DROP = 4;

// Marker kinds (see the fragment shader).
const MK_HOME = 0;
const MK_COLONY = 1;
const MK_SELECT = 2;
const MK_REACH = 3;
const MK_WARN = 4;

const MARKER_VERTEX = /* glsl */ `
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

const MARKER_FRAGMENT = /* glsl */ `
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
  float a = 0.0;
  if (vKind < 0.5) {
    a = band(d, 0.78, 0.86, aa) + 0.55 * band(d, 0.5, 0.55, aa);
    float p = fract(t * 0.42 + vPhase);
    float pr = 0.45 + 0.55 * p;
    a += (1.0 - p) * 0.8 * band(d, pr - 0.04, pr + 0.04, aa);
  } else if (vKind < 1.5) {
    a = band(d, 0.8, 0.88, aa);
    float p = fract(t * 0.3 + vPhase);
    float pr = 0.5 + 0.5 * p;
    a += (1.0 - p) * 0.7 * band(d, pr - 0.04, pr + 0.04, aa);
  } else if (vKind < 2.5) {
    float ang = atan(vP.y, vP.x) / TAU + 0.5;
    float dashes = step(0.5, fract(ang * 10.0 + t * 0.15));
    a = band(d, 0.84, 0.94, aa) * (0.35 + 0.65 * dashes);
  } else if (vKind < 3.5) {
    float breathe = 0.75 + 0.25 * sin(t * 2.2 + vPhase * TAU);
    a = band(d, 0.9, 0.98, aa) * breathe;
  } else {
    float p = fract(t * 0.9 + vPhase);
    a = band(d, 0.72, 0.84, aa) * (0.55 + 0.45 * (1.0 - p));
    float pr = 0.6 + 0.4 * p;
    a += (1.0 - p) * 0.6 * band(d, pr - 0.05, pr + 0.05, aa);
  }
  if (a <= 0.003) discard;
  gl_FragColor = vec4(vCol, min(a, 1.0) * uAlpha);
  #include <colorspace_fragment>
}
`;

const BACKDROP_VERTEX = /* glsl */ `
varying vec2 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xy;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const BACKDROP_FRAGMENT = /* glsl */ `
uniform sampler2D uTex;
uniform float uTile;
varying vec2 vW;
void main() {
  gl_FragColor = vec4(texture2D(uTex, vW / uTile).rgb, 1.0);
}
`;

export interface GalaxyView {
  /** Copy system and ship data out of `snap` (which may be returned to the worker right after). */
  sync(snap: Snapshot): void;
  setSelected(index: number): void;
  /** Highlight a ship by entity id (-1 for none). */
  setSelectedShip(entity: number): void;
  /**
   * Draw the reroute range ring around the selected ship and light up systems: `radiusWorld` is the
   * ring radius (0 hides ring and halos), `reachable[system] = 1` marks a system inside range.
   */
  setRange(radiusWorld: number, reachable: Uint8Array | null): void;
  /** Draw a preview line from the selected ship to a system (-1 hides it). */
  setPreviewTarget(system: number): void;
  /**
   * Show or hide the galaxy view. While hidden (the planet view is open) the canvas is not
   * displayed and frame() draws nothing; sync() still keeps the mirrors current.
   */
  setActive(active: boolean): void;
  /**
   * Stop the marker pulses and the turning ring (D-127): the planet view is opening over the
   * galaxy, so animation redraws would only slow the entry. Input and data still redraw.
   */
  setPulsesFrozen(frozen: boolean): void;
  /** Render quality from Settings (M8): auto, or a pinned low / high render scale. */
  setQuality(quality: RenderQuality): void;
  /** Reduced motion changed in Settings (M8): marker pulses and the turning ring stop or start. */
  setReducedMotion(reduced: boolean): void;
  /**
   * Fly the camera into `system` (M6c): its planets appear on orbit rings round the star. Returns
   * false when the system does not exist or has no planets. With prefers-reduced-motion the move
   * is instant.
   */
  enterSystem(system: number): boolean;
  /** Fly back out to the galaxy; `instant` skips the animation (new game, load). */
  exitSystem(instant?: boolean): void;
  /** True while the camera is in, or heading into, a system. */
  inSystem(): boolean;
  /** The system the camera is in or heading into, or -1. */
  focusedSystem(): number;
  /** Highlight the planet in this slot of the focused system (-1 for none). */
  setSelectedPlanet(slot: number): void;
  /** Call from the shared requestAnimationFrame loop with its timestamp; draws only when needed. */
  frame(nowMs: number): void;
  dispose(): void;
}

export interface GalaxyViewOptions {
  /** A click: the system nearest the pointer, or -1 for empty space. */
  onSelect(index: number): void;
  /** A click on a ship marker: its entity id. */
  onSelectShip(entity: number): void;
  /** A click on a planet in the system view: its slot in the system. */
  onSelectPlanet?(slot: number): void;
  /** The camera started flying into (true) or out of (false) a system. */
  onSystemZoom?(entering: boolean): void;
  /** A double-click on a star (already selected by the first click): zoom into it. */
  onActivateSystem?(index: number): void;
  /** A double-click on a planet in the system view: its slot in the system. */
  onActivatePlanet?(slot: number): void;
}

/**
 * Top-down galaxy (M6a art pass): a nebula and star-field backdrop, glowing stars sized by type and
 * dimmed by survey level, survey pips, pulsing home and colony markers, a turning selection ring,
 * ship arrows with engine glow and fading trails, dashed routes, and range rings. Mass objects are
 * InstancedMesh with fixed capacity; the frame loop writes typed arrays only.
 */
export function createGalaxyView(canvas: HTMLCanvasElement, opts: GalaxyViewOptions): GalaxyView {
  const fx = getFx();
  const software = isSoftwareGl();
  const renderer = new WebGLRenderer({ canvas, antialias: wantAntialias() });
  // Render scale: pinned by ?fx=scale=n, else a frame-time scaler that starts at 0.5 on software GL.
  const scaler = createScaler(startRenderScale(), fx.scale > 0);
  let lastCostMs = 0;
  renderer.setClearColor(BACKGROUND_COLOR);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.z = 10;

  // Palettes as linear floats, converted once (instanceColor and vertex colours are written directly).
  const tmp = new Color();
  function linear(hex: number, out: Float32Array, at: number): void {
    tmp.setHex(hex);
    out[at] = tmp.r;
    out[at + 1] = tmp.g;
    out[at + 2] = tmp.b;
  }
  const palette = new Float32Array((STAR_COLORS.length + 1) * 3);
  for (let i = 0; i <= STAR_COLORS.length; i++) {
    linear(i < STAR_COLORS.length ? STAR_COLORS[i] : HOME_COLOR, palette, i * 3);
  }
  const HOME_PALETTE_INDEX = STAR_COLORS.length;
  const kindPalette = new Float32Array(SHIP_KINDS.length * 3);
  const kindScale = new Float32Array(SHIP_KINDS.length);
  SHIP_KINDS.forEach((k, i) => {
    linear(SHIP_KIND_COLORS[k], kindPalette, i * 3);
    kindScale[i] = SHIP_KIND_SCALE[k];
  });
  const routeColor = new Float32Array(3);
  const routeSelColor = new Float32Array(3);
  linear(ROUTE_COLOR, routeColor, 0);
  linear(ROUTE_SELECTED_COLOR, routeSelColor, 0);
  const pipPalette = new Float32Array(PIP_COLORS.length * 3);
  PIP_COLORS.forEach((c, i) => linear(c, pipPalette, i * 3));
  const warnPalette = new Float32Array(MARGIN_WARN_COLORS.length * 3);
  MARGIN_WARN_COLORS.forEach((c, i) => linear(c, warnPalette, i * 3));
  // Marker colours by kind.
  const markerPalette = new Float32Array(5 * 3);
  linear(HOME_COLOR, markerPalette, MK_HOME * 3);
  linear(COLONY_RING_COLOR, markerPalette, MK_COLONY * 3);
  linear(SELECTION_COLOR, markerPalette, MK_SELECT * 3);
  linear(REACH_COLOR, markerPalette, MK_REACH * 3);

  // Motion: pulses and the turning ring stand still when the player asks for reduced motion.
  let motionOk = !reducedMotion();
  const markerUniforms = {
    uTime: { value: 0 },
    uMotion: { value: motionOk ? 1 : 0 },
    uAlpha: { value: 1 },
  };

  // ---- Backdrop: one quad following the camera, sampling a tiling nebula; field stars as points.
  const nebulaData = new Uint8Array(NEBULA_TEX_SIZE * NEBULA_TEX_SIZE * 4);
  fillNebula(nebulaData, NEBULA_TEX_SIZE, NEBULA_SEED);
  const nebulaTex = new DataTexture(
    nebulaData,
    NEBULA_TEX_SIZE,
    NEBULA_TEX_SIZE,
    RGBAFormat,
    UnsignedByteType,
  );
  nebulaTex.wrapS = nebulaTex.wrapT = RepeatWrapping;
  nebulaTex.magFilter = nebulaTex.minFilter = LinearFilter;
  nebulaTex.generateMipmaps = false;
  nebulaTex.needsUpdate = true;
  const backdrop = new Mesh(
    new PlaneGeometry(1, 1),
    new ShaderMaterial({
      uniforms: { uTex: { value: nebulaTex }, uTile: { value: NEBULA_TILE_WORLD } },
      vertexShader: BACKDROP_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    }),
  );
  backdrop.frustumCulled = false;
  backdrop.renderOrder = 0;
  backdrop.position.z = -5;
  backdrop.visible = !fx.noNebula;
  scene.add(backdrop);

  const fieldPos = new Float32Array(STAR_FIELD_COUNT * 3);
  const fieldCol = new Float32Array(STAR_FIELD_COUNT * 3);
  fillStarField(fieldPos, fieldCol, STAR_FIELD_COUNT, STAR_FIELD_SEED);
  const fieldGeo = new BufferGeometry();
  fieldGeo.setAttribute('position', new BufferAttribute(fieldPos, 3));
  fieldGeo.setAttribute('color', new BufferAttribute(fieldCol, 3));
  const fieldMat = new PointsMaterial({
    size: 1.5,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const field = new Points(fieldGeo, fieldMat);
  field.frustumCulled = false;
  field.renderOrder = 1;
  field.position.z = -4;
  field.visible = !fx.noField;
  scene.add(field);

  // ---- Shared textures and materials
  const glowData = new Uint8Array(GLOW_TEX_SIZE * GLOW_TEX_SIZE * 4);
  fillGlowTexture(glowData, GLOW_TEX_SIZE);
  const glowTex = new DataTexture(
    glowData,
    GLOW_TEX_SIZE,
    GLOW_TEX_SIZE,
    RGBAFormat,
    UnsignedByteType,
  );
  glowTex.magFilter = glowTex.minFilter = LinearFilter;
  glowTex.generateMipmaps = false;
  glowTex.needsUpdate = true;
  const glowMat = new MeshBasicMaterial({
    map: glowTex,
    transparent: true,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const markerMat = new ShaderMaterial({
    uniforms: markerUniforms,
    vertexShader: MARKER_VERTEX,
    fragmentShader: MARKER_FRAGMENT,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const flatMat = (): MeshBasicMaterial =>
    new MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
  const lineMat = (additive: boolean, vertexColors: boolean, color = 0xffffff): LineBasicMaterial =>
    new LineBasicMaterial({
      vertexColors,
      color,
      transparent: true,
      blending: additive ? AdditiveBlending : NormalBlending,
      depthTest: false,
      depthWrite: false,
    });

  function colored(mesh: InstancedMesh, cap: number): void {
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.instanceColor.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
  }

  // Star glows (additive sprites) and core dots.
  const glows = new InstancedMesh(new PlaneGeometry(2, 2), glowMat, SNAPSHOT_MAX_SYSTEMS);
  colored(glows, SNAPSHOT_MAX_SYSTEMS);
  glows.renderOrder = 3;
  glows.visible = !fx.noGlow;
  scene.add(glows);

  // Additive: a dimmed core darkens nothing (D-127), it only adds less light.
  const dotMat = flatMat();
  dotMat.blending = AdditiveBlending;
  const dots = new InstancedMesh(new CircleGeometry(1, 24), dotMat, SNAPSHOT_MAX_SYSTEMS);
  colored(dots, SNAPSHOT_MAX_SYSTEMS);
  dots.renderOrder = 5;
  scene.add(dots);

  // Survey pips: one tiny dot per planet under its star, coloured by survey level.
  const pips = new InstancedMesh(new CircleGeometry(1, 10), flatMat(), SNAPSHOT_MAX_PLANETS);
  colored(pips, SNAPSHOT_MAX_PLANETS);
  pips.renderOrder = 6;
  scene.add(pips);

  // Markers (home, colonies, selection, reach halos): one shader, per-instance kind.
  function markerMesh(cap: number, order: number): InstancedMesh {
    const geo = new PlaneGeometry(2, 2);
    geo.setAttribute(
      'aKind',
      new InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(DynamicDrawUsage),
    );
    geo.setAttribute(
      'aPhase',
      new InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(DynamicDrawUsage),
    );
    const mesh = new InstancedMesh(geo, markerMat, cap);
    colored(mesh, cap);
    mesh.renderOrder = order;
    scene.add(mesh);
    return mesh;
  }
  const markers = markerMesh(MARKER_CAP, 7);
  // Supply warnings on ships follow the interpolated position every frame.
  const shipMarks = markerMesh(SNAPSHOT_MAX_SHIPS, 10);

  // Ships: arrow model (a notched dart pointing along +x), engine glow behind the same position.
  const arrowGeo = new BufferGeometry();
  arrowGeo.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([1, 0, 0, -0.8, 0.62, 0, -0.35, 0, 0, -0.8, -0.62, 0]), 3),
  );
  arrowGeo.setIndex([0, 1, 2, 0, 2, 3]);
  const ships = new InstancedMesh(arrowGeo, flatMat(), SNAPSHOT_MAX_SHIPS);
  colored(ships, SNAPSHOT_MAX_SHIPS);
  ships.renderOrder = 9;
  scene.add(ships);
  // Own material (not the stars' glowMat) so the system zoom can fade ships without dimming the sun.
  const shipGlowMat = glowMat.clone();
  const shipGlow = new InstancedMesh(new PlaneGeometry(2, 2), shipGlowMat, SNAPSHOT_MAX_SHIPS);
  colored(shipGlow, SNAPSHOT_MAX_SHIPS);
  shipGlow.renderOrder = 8;
  shipGlow.visible = !fx.noGlow;
  scene.add(shipGlow);

  // Route lines: dashed, one LineSegments for every ship in flight (leg origin to target).
  const routePos = new Float32Array(SNAPSHOT_MAX_SHIPS * ROUTE_MAX_DASHES * 6);
  const routeCol = new Float32Array(SNAPSHOT_MAX_SHIPS * ROUTE_MAX_DASHES * 6);
  const routeGeo = new BufferGeometry();
  routeGeo.setAttribute('position', new BufferAttribute(routePos, 3).setUsage(DynamicDrawUsage));
  routeGeo.setAttribute('color', new BufferAttribute(routeCol, 3).setUsage(DynamicDrawUsage));
  routeGeo.setDrawRange(0, 0);
  const routes = new LineSegments(routeGeo, lineMat(true, true));
  routes.frustumCulled = false;
  routes.renderOrder = 2;
  scene.add(routes);

  // Trails: one LineSegments, TRAIL_POINTS segments per ship at most, faded towards the tail.
  const trailPos = new Float32Array(TRAIL_MAX_SEGMENTS * 6);
  const trailCol = new Float32Array(TRAIL_MAX_SEGMENTS * 6);
  const trailFade = new Float32Array(TRAIL_MAX_SEGMENTS * 2);
  const trailGeo = new BufferGeometry();
  trailGeo.setAttribute('position', new BufferAttribute(trailPos, 3).setUsage(DynamicDrawUsage));
  trailGeo.setAttribute('color', new BufferAttribute(trailCol, 3).setUsage(DynamicDrawUsage));
  trailGeo.setDrawRange(0, 0);
  const trails = new LineSegments(trailGeo, lineMat(true, true));
  trails.frustumCulled = false;
  trails.renderOrder = 4;
  scene.add(trails);
  const trailStore: TrailStore = createTrailStore();

  // Reroute preview: dashed line from the selected ship to the clicked target.
  const previewPos = new Float32Array(PREVIEW_MAX_DASHES * 6);
  const previewGeo = new BufferGeometry();
  previewGeo.setAttribute(
    'position',
    new BufferAttribute(previewPos, 3).setUsage(DynamicDrawUsage),
  );
  previewGeo.setDrawRange(0, 0);
  const preview = new LineSegments(previewGeo, lineMat(false, false, PREVIEW_COLOR));
  preview.frustumCulled = false;
  preview.renderOrder = 11;
  preview.visible = false;
  scene.add(preview);

  // Destination line: launch colony to the star picked in Mission Command.
  const destPos = new Float32Array(DEST_MAX_DASHES * 6);
  const destGeo = new BufferGeometry();
  destGeo.setAttribute('position', new BufferAttribute(destPos, 3).setUsage(DynamicDrawUsage));
  destGeo.setDrawRange(0, 0);
  const destLine = new LineSegments(destGeo, lineMat(false, false, DEST_LINE_COLOR));
  destLine.frustumCulled = false;
  destLine.renderOrder = 2;
  destLine.visible = false;
  scene.add(destLine);

  // Range rings (unit circle scaled to the radius) with a faint fill: ship reroute and colony launch range.
  const ringPts = new Float32Array(RANGE_SEGMENTS * 3);
  for (let i = 0; i < RANGE_SEGMENTS; i++) {
    const a = (i / RANGE_SEGMENTS) * Math.PI * 2;
    ringPts[i * 3] = Math.cos(a);
    ringPts[i * 3 + 1] = Math.sin(a);
  }
  const rangeGeo = new BufferGeometry();
  rangeGeo.setAttribute('position', new BufferAttribute(ringPts, 3));
  const fillGeo = new CircleGeometry(1, RANGE_SEGMENTS);
  function rangeVisual(color: number): { ring: LineLoop; fill: Mesh } {
    const ring = new LineLoop(rangeGeo, lineMat(true, false, color));
    ring.frustumCulled = false;
    ring.renderOrder = 11;
    ring.visible = false;
    scene.add(ring);
    const fill = new Mesh(
      fillGeo,
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: RANGE_FILL_OPACITY,
        depthTest: false,
        depthWrite: false,
      }),
    );
    fill.frustumCulled = false;
    fill.renderOrder = 2;
    fill.visible = false;
    scene.add(fill);
    return { ring, fill };
  }
  const shipRange = rangeVisual(RANGE_COLOR);
  const colonyRange = rangeVisual(COLONY_RANGE_COLOR);
  const rangeRing = shipRange.ring;
  const rangeFill = shipRange.fill;

  const shipRing = new Mesh(
    new RingGeometry(10, 12, 40),
    new MeshBasicMaterial({
      color: SELECTED_SHIP_RING_COLOR,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  shipRing.visible = false;
  shipRing.renderOrder = 11;
  scene.add(shipRing);

  // System view layer (M6c): planets on orbit rings over the star the camera flew into.
  const systemLayer: SystemLayer = createSystemLayer(scene, motionOk, 12);

  // Local mirrors: picking never touches a snapshot that may have been returned to the worker.
  const positions = new Float32Array(SNAPSHOT_MAX_SYSTEMS * 2);
  const starType = new Uint8Array(SNAPSHOT_MAX_SYSTEMS);
  const planetCountOf = new Uint8Array(SNAPSHOT_MAX_SYSTEMS);
  const sysSurvey = new Uint8Array(SNAPSHOT_MAX_SYSTEMS);
  /** Survey level per planet, indexed by planet; a system's planets start at planetStart[system]. */
  const planetSurveyOf = new Uint8Array(SNAPSHOT_MAX_PLANETS);
  const planetStart = new Uint16Array(SNAPSHOT_MAX_SYSTEMS);
  const colonyRangeOf = new Float32Array(SNAPSHOT_MAX_SYSTEMS);
  // Planet mirrors for the system view.
  const planetHabLoOf = new Uint8Array(SNAPSHOT_MAX_PLANETS);
  const planetHabHiOf = new Uint8Array(SNAPSHOT_MAX_PLANETS);
  const planetOwnedOf = new Uint8Array(SNAPSHOT_MAX_PLANETS);
  const planetParkedOf = new Uint8Array(SNAPSHOT_MAX_PLANETS);
  const parkedNext = new Uint8Array(SNAPSHOT_MAX_PLANETS);
  const layerData: SystemPlanetData = {
    survey: planetSurveyOf,
    habLo: planetHabLoOf,
    habHi: planetHabHiOf,
    owned: planetOwnedOf,
    parked: planetParkedOf,
  };
  let layerDirty = true;
  // Ship mirrors, indexed by snapshot row.
  const shipEntity = new Int32Array(SNAPSHOT_MAX_SHIPS);
  const shipKind = new Uint8Array(SNAPSHOT_MAX_SHIPS);
  const shipPosSnap = new Float32Array(SNAPSHOT_MAX_SHIPS * SHIP_POS_STRIDE);
  const shipHeading = new Float32Array(SNAPSHOT_MAX_SHIPS * 2);
  const shipRender = new Float32Array(SNAPSHOT_MAX_SHIPS * 2);
  /** Per ship in flight: leg origin x,y and target x,y (world units), 4 floats each. */
  const shipLeg = new Float32Array(SNAPSHOT_MAX_SHIPS * 4);
  const shipHasLeg = new Uint8Array(SNAPSHOT_MAX_SHIPS);
  const shipTrails = new Uint8Array(SNAPSHOT_MAX_SHIPS);
  const shipWarn = new Uint8Array(SNAPSHOT_MAX_SHIPS);
  const reach = new Uint8Array(SNAPSHOT_MAX_SYSTEMS);
  const clock = createInterpClock();
  let shipCount = 0;
  let shipsDirty = false;
  let lastTrailDay = -1;
  let syncSeq = 0;
  let count = 0;
  let planetTotal = 0;
  let homeSystem = -1;
  let originSystem = -1;
  let selected = -1;
  let selectedShip = -1;
  let rangeRadius = 0;
  let previewTarget = -1;
  let lastNow = 0;
  let active = true;
  let startMs = -1;
  let lastAnimMs = 0;
  let lastShipMs = 0;
  let clockDirty = false;
  let pulsesFrozen = false;
  let renderedFrames = 0;
  let animated = false;
  let markerCount = 0;
  /** Camera scale the glow quads were last clamped for (see glowKey). */
  let glowCamScale = 1;
  let glowKeyLast = -1;

  const view: ViewState = createView();
  /** The camera while the system zoom is on: the galaxy view flown towards the focused star. */
  const camView: ViewState = createView();
  const fromView: ViewTransform = { cx: 0, cy: 0, scale: 1 };
  const toView: ViewTransform = { cx: 0, cy: 0, scale: 1 };
  const area = createViewArea();
  const slide = createSlide(0);
  let focusSystem = -1;
  let galaxyAlpha = 1;
  let selectedPlanet = -1;
  let wheelIn = 0;
  let wheelOut = 0;
  let needsRender = true;
  let sized = false;
  let viewFitted = false;

  function coreRadius(i: number): number {
    return starCoreRadius(starType[i]) * (i === homeSystem ? HOME_CORE_SCALE : 1);
  }

  /** Galaxy alpha under which the unfocused stars get zero-size quads (D-127). */
  const STAR_HIDE_ALPHA = 0.004;

  /** Clamp key of the camera scale: -1 while no glow can reach the pixel cap, else 1/8 octaves. */
  function glowKey(scale: number): number {
    return scale < 1.7 ? -1 : Math.round(Math.log2(scale) * 8);
  }

  /** Nominal glow radius of system `i` (world units, before the clamp). */
  function glowNominal(i: number): number {
    return starGlowRadius(starType[i]) * (i === homeSystem ? 1.15 : 1);
  }

  /** Matrices of the core dot and glow quad of system `i`; unfocused stars vanish once faded out. */
  function writeStarGeom(i: number): void {
    const hide = i !== focusSystem && galaxyAlpha < STAR_HIDE_ALPHA;
    const dm = dots.instanceMatrix.array as Float32Array;
    const base = i * 16;
    const r = hide ? 0 : coreRadius(i) * (i === selected ? SELECTED_SCALE : 1);
    dm[base] = r;
    dm[base + 5] = r;
    dm[base + 10] = 1;
    dm[base + 12] = positions[i * 2];
    dm[base + 13] = positions[i * 2 + 1];
    dm[base + 15] = 1;

    const gm = glows.instanceMatrix.array as Float32Array;
    const g = hide ? 0 : clampGlowRadius(glowNominal(i), glowCamScale) * GLOW_QUAD_SCALE;
    gm[base] = g;
    gm[base + 5] = g;
    gm[base + 10] = 1;
    gm[base + 12] = positions[i * 2];
    gm[base + 13] = positions[i * 2 + 1];
    gm[base + 14] = -0.2;
    gm[base + 15] = 1;
  }

  /** Colours of the core dot and glow of system `i`: survey brightness times the galaxy fade. */
  function writeStarColours(i: number): void {
    const type = starType[i];
    const bright = surveyBrightness(sysSurvey[i]) * (i === focusSystem ? 1 : galaxyAlpha);
    const home = i === homeSystem;
    const dc = (dots.instanceColor as InstancedBufferAttribute).array as Float32Array;
    const p = (home ? HOME_PALETTE_INDEX : type) * 3;
    dc[i * 3] = palette[p] * bright;
    dc[i * 3 + 1] = palette[p + 1] * bright;
    dc[i * 3 + 2] = palette[p + 2] * bright;

    const nominal = glowNominal(i);
    const comp = glowGainCompensation(nominal, clampGlowRadius(nominal, glowCamScale));
    const gc = (glows.instanceColor as InstancedBufferAttribute).array as Float32Array;
    const sp = type * 3;
    const k = bright * starGlowGain(type) * GLOW_GAIN * comp;
    gc[i * 3] = palette[sp] * k;
    gc[i * 3 + 1] = palette[sp + 1] * k;
    gc[i * 3 + 2] = palette[sp + 2] * k;
  }

  /** Core dot and glow sprite of system `i`: size by star type, brightness by survey level. */
  function writeStar(i: number): void {
    writeStarGeom(i);
    writeStarColours(i);
  }

  function flushStarColours(): void {
    (dots.instanceColor as InstancedBufferAttribute).needsUpdate = true;
    (glows.instanceColor as InstancedBufferAttribute).needsUpdate = true;
  }

  function flushStars(): void {
    dots.instanceMatrix.needsUpdate = true;
    (dots.instanceColor as InstancedBufferAttribute).needsUpdate = true;
    glows.instanceMatrix.needsUpdate = true;
    (glows.instanceColor as InstancedBufferAttribute).needsUpdate = true;
  }

  /** One pip per planet in a row under its star, coloured by the planet's survey level. */
  function writePips(): void {
    const m = pips.instanceMatrix.array as Float32Array;
    const c = (pips.instanceColor as InstancedBufferAttribute).array as Float32Array;
    let n = 0;
    for (let i = 0; i < count; i++) {
      const np = planetCountOf[i];
      const y = positions[i * 2 + 1] - (coreRadius(i) * 2.3 + PIP_DROP);
      for (let k = 0; k < np && n < SNAPSHOT_MAX_PLANETS; k++) {
        const level = planetSurveyOf[planetStart[i] + k];
        const base = n * 16;
        m[base] = PIP_RADIUS;
        m[base + 5] = PIP_RADIUS;
        m[base + 10] = 1;
        m[base + 12] = positions[i * 2] + pipOffsetX(k, np, PIP_SPACING);
        m[base + 13] = y;
        m[base + 15] = 1;
        const pi = (level < PIP_COLORS.length ? level : PIP_COLORS.length - 1) * 3;
        c[n * 3] = pipPalette[pi];
        c[n * 3 + 1] = pipPalette[pi + 1];
        c[n * 3 + 2] = pipPalette[pi + 2];
        n++;
      }
    }
    pips.count = n;
    pips.instanceMatrix.needsUpdate = true;
    (pips.instanceColor as InstancedBufferAttribute).needsUpdate = true;
  }

  const colonyFlags = new Uint8Array(SNAPSHOT_MAX_SYSTEMS);
  const colonyFlagsPrev = new Uint8Array(SNAPSHOT_MAX_SYSTEMS);

  function putMarker(
    mesh: InstancedMesh,
    n: number,
    x: number,
    y: number,
    radius: number,
    kind: number,
    phase: number,
    rgb: Float32Array,
    rgbAt: number,
  ): void {
    const m = mesh.instanceMatrix.array as Float32Array;
    const base = n * 16;
    m[base] = radius;
    m[base + 1] = 0;
    m[base + 4] = 0;
    m[base + 5] = radius;
    m[base + 10] = 1;
    m[base + 12] = x;
    m[base + 13] = y;
    m[base + 15] = 1;
    const c = (mesh.instanceColor as InstancedBufferAttribute).array as Float32Array;
    c[n * 3] = rgb[rgbAt];
    c[n * 3 + 1] = rgb[rgbAt + 1];
    c[n * 3 + 2] = rgb[rgbAt + 2];
    ((mesh.geometry.attributes.aKind as InstancedBufferAttribute).array as Float32Array)[n] = kind;
    ((mesh.geometry.attributes.aPhase as InstancedBufferAttribute).array as Float32Array)[n] =
      phase;
  }

  function flushMarkers(mesh: InstancedMesh, n: number): void {
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    (mesh.instanceColor as InstancedBufferAttribute).needsUpdate = true;
    (mesh.geometry.attributes.aKind as InstancedBufferAttribute).needsUpdate = true;
    (mesh.geometry.attributes.aPhase as InstancedBufferAttribute).needsUpdate = true;
  }

  /** Home ring, colony rings, selection ring and reach halos. Rewritten when any of them changes. */
  function writeMarkers(): void {
    let n = 0;
    for (let i = 0; i < count && n < MARKER_CAP - 2; i++) {
      const x = positions[i * 2];
      const y = positions[i * 2 + 1];
      const core = coreRadius(i);
      const phase = (i * 0.37) % 1;
      if (i === homeSystem) {
        putMarker(markers, n++, x, y, core * 2.4, MK_HOME, phase, markerPalette, MK_HOME * 3);
      }
      if (colonyFlagsPrev[i] !== 0) {
        putMarker(markers, n++, x, y, core * 2.2, MK_COLONY, phase, markerPalette, MK_COLONY * 3);
      }
      if (rangeRadius > 0 && reach[i] !== 0) {
        putMarker(markers, n++, x, y, core * 3.3, MK_REACH, phase, markerPalette, MK_REACH * 3);
      }
    }
    if (selected >= 0 && selected < count) {
      putMarker(
        markers,
        n++,
        positions[selected * 2],
        positions[selected * 2 + 1],
        coreRadius(selected) * 2.9,
        MK_SELECT,
        0,
        markerPalette,
        MK_SELECT * 3,
      );
    }
    flushMarkers(markers, n);
    markerCount = n;
    animated = motionOk && n > 0;
    needsRender = true;
  }

  /** Colony markers: rewritten only when the set of colonised systems changed. */
  function syncColonies(snap: Snapshot): void {
    colonisedSystems(snap, colonyFlags);
    fillColonyRanges(snap, colonyRangeOf);
    originSystem = launchOriginSystem(snap);
    let changed = false;
    for (let i = 0; i < SNAPSHOT_MAX_SYSTEMS && !changed; i++) {
      changed = colonyFlags[i] !== colonyFlagsPrev[i];
    }
    if (changed) {
      colonyFlagsPrev.set(colonyFlags);
      writeMarkers();
    }
    updateStaticOverlays();
  }

  /** Overlays that depend on the selected system, not on moving ships. */
  function updateStaticOverlays(): void {
    const sel = selected >= 0 && selected < count;
    // Launch range of the selected colony (hidden while a ship's reroute range is shown).
    const cr = sel && rangeRadius <= 0 ? colonyRangeOf[selected] : 0;
    colonyRange.ring.visible = cr > 0;
    colonyRange.fill.visible = cr > 0;
    if (cr > 0) {
      colonyRange.ring.position.set(positions[selected * 2], positions[selected * 2 + 1], 0);
      colonyRange.fill.position.set(positions[selected * 2], positions[selected * 2 + 1], 0);
      colonyRange.ring.scale.setScalar(cr);
      colonyRange.fill.scale.setScalar(cr);
    }
    // Dashed line from the launch colony to the picked destination star.
    const showDest =
      sel &&
      selectedShip < 0 &&
      originSystem >= 0 &&
      originSystem < count &&
      selected !== originSystem;
    destLine.visible = showDest;
    if (showDest) {
      const dashes = writeDashes(
        destPos,
        0,
        positions[originSystem * 2],
        positions[originSystem * 2 + 1],
        positions[selected * 2],
        positions[selected * 2 + 1],
        9,
        7,
        DEST_MAX_DASHES,
      );
      destGeo.setDrawRange(0, dashes * 2);
      (destGeo.attributes.position as BufferAttribute).needsUpdate = true;
    }
    needsRender = true;
  }

  /** Copy the ship rows out of a snapshot; derive heading, kind, route leg and trail points. */
  function syncShips(snap: Snapshot): void {
    const n = Math.min(snap.meta[META_SHIP_COUNT], SNAPSHOT_MAX_SHIPS);
    const newDay = snap.meta[META_DAY] !== lastTrailDay;
    syncSeq++;
    shipCount = n;
    for (let i = 0; i < n; i++) {
      const o = i * SHIP_POS_STRIDE;
      for (let k = 0; k < SHIP_POS_STRIDE; k++) shipPosSnap[o + k] = snap.shipPos[o + k];
      const state = snap.shipState[i];
      shipEntity[i] = snap.shipEntity[i];
      shipKind[i] = SHIP_KINDS.indexOf(shipKindOf(state));
      const flying = isFlying(state) || state === SHIP_STATE.Event;
      // Target system position from the destination planet.
      const sys = snap.planetSystem[snap.shipDest[i]];
      const tx = positions[sys * 2];
      const ty = positions[sys * 2 + 1];
      const cx = shipPosSnap[o + 2];
      const cy = shipPosSnap[o + 3];
      // Heading: along the last step, else towards the target, else keep pointing right.
      let hx = cx - shipPosSnap[o];
      let hy = cy - shipPosSnap[o + 1];
      let len = Math.sqrt(hx * hx + hy * hy);
      if (len < 1e-4 && flying) {
        hx = tx - cx;
        hy = ty - cy;
        len = Math.sqrt(hx * hx + hy * hy);
      }
      if (len >= 1e-4) {
        shipHeading[i * 2] = hx / len;
        shipHeading[i * 2 + 1] = hy / len;
      } else {
        shipHeading[i * 2] = 1;
        shipHeading[i * 2 + 1] = 0;
      }
      shipHasLeg[i] = flying ? 1 : 0;
      if (flying) {
        legOrigin(cx, cy, tx, ty, snap.shipProgress[i], snap.shipDistance[i], shipLeg, i * 4);
        shipLeg[i * 4 + 2] = tx;
        shipLeg[i * 4 + 3] = ty;
      }
      shipWarn[i] = shipMarginWarning(snap.shipMargin[i], snap.shipColonists[i], flying);
      // Trails only behind ships that move or may move (transit, event pending, drifting).
      shipTrails[i] = shipKind[i] <= KIND_DRIFTING ? 1 : 0;
      // The trail remembers where each day's step started; the head is the interpolated position.
      trailSyncShip(
        trailStore,
        snap.shipEntity[i],
        syncSeq,
        newDay,
        shipPosSnap[o],
        shipPosSnap[o + 1],
      );
    }
    lastTrailDay = snap.meta[META_DAY];
    ships.count = n;
    shipGlow.count = n;
    writeRoutes();
    shipsDirty = true;
  }

  /** Rebuild the static dashed route buffer (only changes with a snapshot or the selected ship). */
  function writeRoutes(): void {
    let verts = 0;
    for (let i = 0; i < shipCount; i++) {
      if (shipHasLeg[i] === 0) continue;
      const isSel = shipEntity[i] === selectedShip;
      const dashes = writeDashes(
        routePos,
        verts * 3,
        shipLeg[i * 4],
        shipLeg[i * 4 + 1],
        shipLeg[i * 4 + 2],
        shipLeg[i * 4 + 3],
        isSel ? 14 : 8,
        isSel ? 5 : 9,
        ROUTE_MAX_DASHES,
      );
      const c = isSel ? routeSelColor : routeColor;
      for (let v = 0; v < dashes * 2; v++) {
        routeCol[(verts + v) * 3] = c[0];
        routeCol[(verts + v) * 3 + 1] = c[1];
        routeCol[(verts + v) * 3 + 2] = c[2];
      }
      verts += dashes * 2;
    }
    routeGeo.setDrawRange(0, verts);
    (routeGeo.attributes.position as BufferAttribute).needsUpdate = true;
    (routeGeo.attributes.color as BufferAttribute).needsUpdate = true;
  }

  /**
   * Per-frame work while ships move: interpolate, then rewrite ship instances, trails and the
   * overlays that follow the selected ship. Typed-array writes only, no allocation.
   */
  function updateShips(): void {
    const alpha = clockAlpha(clock);
    lerpShipPositions(shipPosSnap, shipCount, alpha, shipRender);
    const m = ships.instanceMatrix.array as Float32Array;
    const ca = (ships.instanceColor as InstancedBufferAttribute).array as Float32Array;
    const gm = shipGlow.instanceMatrix.array as Float32Array;
    const gc = (shipGlow.instanceColor as InstancedBufferAttribute).array as Float32Array;
    let trailVerts = 0;
    let warnCount = 0;
    let selRow = -1;
    for (let i = 0; i < shipCount; i++) {
      const kind = shipKind[i];
      const isSel = shipEntity[i] === selectedShip;
      if (isSel) selRow = i;
      const r = SHIP_RADIUS * kindScale[kind] * (isSel ? SELECTED_SHIP_SCALE : 1);
      const hx = shipHeading[i * 2] * r;
      const hy = shipHeading[i * 2 + 1] * r;
      const px = shipRender[i * 2];
      const py = shipRender[i * 2 + 1];
      const base = i * 16;
      m[base] = hx;
      m[base + 1] = hy;
      m[base + 4] = -hy;
      m[base + 5] = hx;
      m[base + 10] = 1;
      m[base + 12] = px;
      m[base + 13] = py;
      m[base + 14] = SHIP_Z;
      m[base + 15] = 1;
      ca[i * 3] = kindPalette[kind * 3];
      ca[i * 3 + 1] = kindPalette[kind * 3 + 1];
      ca[i * 3 + 2] = kindPalette[kind * 3 + 2];
      // Engine glow, a little behind the nose so the arrow reads as the head.
      const nominalGlow = r * SHIP_GLOW_SCALE;
      const clampedGlow = clampGlowRadius(nominalGlow, glowCamScale);
      const g = clampedGlow * GLOW_QUAD_SCALE;
      const glowK = SHIP_GLOW_GAIN * glowGainCompensation(nominalGlow, clampedGlow);
      gm[base] = g;
      gm[base + 1] = 0;
      gm[base + 4] = 0;
      gm[base + 5] = g;
      gm[base + 10] = 1;
      gm[base + 12] = px - hx * 0.25;
      gm[base + 13] = py - hy * 0.25;
      gm[base + 14] = SHIP_Z - 0.1;
      gm[base + 15] = 1;
      gc[i * 3] = kindPalette[kind * 3] * glowK;
      gc[i * 3 + 1] = kindPalette[kind * 3 + 1] * glowK;
      gc[i * 3 + 2] = kindPalette[kind * 3 + 2] * glowK;
      if (shipWarn[i] !== 0) {
        putMarker(
          shipMarks,
          warnCount++,
          px,
          py,
          r * 2.2,
          MK_WARN,
          (i * 0.23) % 1,
          warnPalette,
          shipWarn[i] * 3,
        );
      }
      if (shipTrails[i] !== 0) {
        const segs = writeTrailSegments(
          trailStore,
          shipEntity[i],
          px,
          py,
          trailPos,
          trailVerts * 3,
          trailFade,
          trailVerts,
        );
        for (let v = 0; v < segs * 2; v++) {
          const f = trailFade[trailVerts + v];
          const at = (trailVerts + v) * 3;
          trailCol[at] = kindPalette[kind * 3] * f;
          trailCol[at + 1] = kindPalette[kind * 3 + 1] * f;
          trailCol[at + 2] = kindPalette[kind * 3 + 2] * f;
        }
        trailVerts += segs * 2;
      }
    }
    ships.instanceMatrix.needsUpdate = true;
    (ships.instanceColor as InstancedBufferAttribute).needsUpdate = true;
    shipGlow.instanceMatrix.needsUpdate = true;
    (shipGlow.instanceColor as InstancedBufferAttribute).needsUpdate = true;
    flushMarkers(shipMarks, warnCount);
    trailGeo.setDrawRange(0, trailVerts);
    (trailGeo.attributes.position as BufferAttribute).needsUpdate = true;
    (trailGeo.attributes.color as BufferAttribute).needsUpdate = true;

    if (selRow >= 0) {
      const sx = shipRender[selRow * 2];
      const sy = shipRender[selRow * 2 + 1];
      shipRing.visible = true;
      shipRing.position.x = sx;
      shipRing.position.y = sy;
      const hasRange = rangeRadius > 0;
      rangeRing.visible = hasRange;
      rangeFill.visible = hasRange;
      if (hasRange) {
        rangeRing.position.x = rangeFill.position.x = sx;
        rangeRing.position.y = rangeFill.position.y = sy;
        rangeRing.scale.setScalar(rangeRadius);
        rangeFill.scale.setScalar(rangeRadius);
      }
      if (previewTarget >= 0 && previewTarget < count) {
        const dashes = writeDashes(
          previewPos,
          0,
          sx,
          sy,
          positions[previewTarget * 2],
          positions[previewTarget * 2 + 1],
          10,
          6,
          PREVIEW_MAX_DASHES,
        );
        previewGeo.setDrawRange(0, dashes * 2);
        (previewGeo.attributes.position as BufferAttribute).needsUpdate = true;
        preview.visible = dashes > 0;
      } else {
        preview.visible = false;
      }
    } else {
      shipRing.visible = false;
      rangeRing.visible = false;
      rangeFill.visible = false;
      preview.visible = false;
    }
    shipsDirty = false;
    needsRender = true;
  }

  function applyCamera(): void {
    const cam = focusSystem >= 0 ? camView : view;
    const hw = cam.width / (2 * cam.scale);
    const hh = cam.height / (2 * cam.scale);
    camera.left = -hw;
    camera.right = hw;
    camera.top = hh;
    camera.bottom = -hh;
    camera.position.x = cam.cx;
    camera.position.y = cam.cy;
    camera.updateProjectionMatrix();
    // The backdrop quad covers exactly what the camera sees.
    backdrop.position.x = cam.cx;
    backdrop.position.y = cam.cy;
    backdrop.scale.set(hw * 2.02, hh * 2.02, 1);
    // Glow quads are capped in pixels, so a big zoom change rewrites their size (1/8 octave steps).
    const gk = glowKey(cam.scale);
    if (gk !== glowKeyLast) {
      glowKeyLast = gk;
      glowCamScale = cam.scale;
      for (let i = 0; i < count; i++) writeStar(i);
      flushStars();
      shipsDirty = true;
    }
    // A range fill that would cover most of the screen is dropped; the ring stays.
    const vp = Math.max(cam.width, cam.height);
    shipRange.fill.visible =
      shipRange.ring.visible && rangeFillVisible(shipRange.ring.scale.x, cam.scale, vp);
    colonyRange.fill.visible =
      colonyRange.ring.visible && rangeFillVisible(colonyRange.ring.scale.x, cam.scale, vp);
  }

  /** Pixel ratio = device ratio (max 2) x render scale; the star-field points follow it. */
  function applyRenderScale(): void {
    const ratio = effectivePixelRatio(window.devicePixelRatio || 1, scalerScale(scaler));
    renderer.setPixelRatio(ratio);
    fieldMat.size = 1.5 * ratio;
  }

  function resize(): void {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    if (sized && w === view.width && h === view.height) return;
    applyRenderScale();
    renderer.setSize(w, h, false);
    if (!viewFitted) {
      view.width = w;
      view.height = h;
      view.scale = fitScale(w, h);
      viewFitted = true;
    } else {
      resizeView(view, w, h);
    }
    sized = true;
    needsRender = true;
  }

  const onResize = (): void => {
    sized = false;
    needsRender = true;
  };
  window.addEventListener('resize', onResize);

  /** Squared screen distance from (sx, sy) to the point at `positions[idx]`. */
  function dist2(arr: Float32Array, idx: number, sx: number, sy: number): number {
    const dx = screenX(view, arr[idx * 2]) - sx;
    const dy = screenY(view, arr[idx * 2 + 1]) - sy;
    return dx * dx + dy * dy;
  }

  // Double-click detection (M7c): the previous click's time and target (stars by index, planets by
  // 100000 + slot) so a second click on the same target soon after activates it.
  let lastClickMs = -1e9;
  let lastClickKey = -1;

  /** A click picks the nearer of a ship marker and a star; a star wins ties. */
  function pickAt(sx: number, sy: number): void {
    const ship = pickNearest(shipRender, shipCount, view, sx, sy, SHIP_PICK_RADIUS_PX);
    const sys = pickNearest(positions, count, view, sx, sy, PICK_RADIUS_PX);
    if (ship >= 0 && (sys < 0 || dist2(shipRender, ship, sx, sy) < dist2(positions, sys, sx, sy))) {
      opts.onSelectShip(shipEntity[ship]);
      lastClickKey = -1;
    } else {
      opts.onSelect(sys);
      const now = performance.now();
      const double = isDoubleClick(lastClickMs, lastClickKey, now, sys);
      lastClickMs = now;
      lastClickKey = double ? -1 : sys;
      if (double) opts.onActivateSystem?.(sys);
    }
  }

  // Pointer: drag pans, a short press selects.
  let dragging = false;
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;
  let moved = 0;
  const onDown = (e: PointerEvent): void => {
    if (!e.isPrimary || e.button !== 0) return;
    dragging = true;
    downX = lastX = e.offsetX;
    downY = lastY = e.offsetY;
    moved = 0;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // capture is a convenience; dragging still works without it
    }
  };
  const onMove = (e: PointerEvent): void => {
    if (!dragging || !e.isPrimary) return;
    if (focusSystem < 0) panBy(view, e.offsetX - lastX, e.offsetY - lastY);
    lastX = e.offsetX;
    lastY = e.offsetY;
    const dx = e.offsetX - downX;
    const dy = e.offsetY - downY;
    moved = Math.max(moved, Math.abs(dx) + Math.abs(dy));
    needsRender = true;
  };
  const onUp = (e: PointerEvent): void => {
    if (!dragging || !e.isPrimary) return;
    dragging = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    if (moved <= CLICK_SLOP_PX) {
      if (focusSystem >= 0) pickPlanetAt(e.offsetX, e.offsetY);
      else pickAt(e.offsetX, e.offsetY);
    }
  };
  /** A click in the system view picks the planet nearest the pointer (once the planets have faded in). */
  function pickPlanetAt(sx: number, sy: number): void {
    if (slide.to !== 1 || systemFade(easeInOutCubic(slidePos(slide, performance.now()))) < 0.5) {
      return;
    }
    const slot = pickNearest(
      systemLayer.worldPos,
      systemLayer.count,
      camView,
      sx,
      sy,
      PLANET_PICK_RADIUS_PX,
    );
    if (slot >= 0) {
      const now = performance.now();
      const double = isDoubleClick(lastClickMs, lastClickKey, now, 100000 + slot);
      lastClickMs = now;
      lastClickKey = double ? -1 : 100000 + slot;
      opts.onSelectPlanet?.(slot);
      if (double) opts.onActivatePlanet?.(slot);
    }
  }
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const delta = normalizeWheelDelta(e.deltaY, e.deltaMode);
    if (focusSystem >= 0) {
      // Rolling out far enough leaves the system; rolling in does nothing here.
      wheelOut = delta > 0 ? wheelOut + delta : 0;
      if (wheelOut >= EXIT_WHEEL_PX) {
        wheelOut = 0;
        exitSystem(false);
      }
      return;
    }
    if (delta < 0) {
      // Rolling in over the selected star, with the galaxy already zoomed in, flies into it.
      const near =
        selected >= 0 &&
        selected < count &&
        pickNearest(positions, count, view, e.offsetX, e.offsetY, ENTER_PICK_RADIUS_PX) ===
          selected;
      wheelIn = near ? wheelIn - delta : 0;
      const ratio = view.scale / fitScale(view.width, view.height);
      if (wheelEntersSystem(near, ratio, wheelIn)) {
        wheelIn = 0;
        if (enterSystem(selected)) return;
      }
    } else {
      wheelIn = 0;
    }
    zoomAt(view, e.offsetX, e.offsetY, Math.pow(ZOOM_PER_WHEEL_NOTCH, -delta));
    needsRender = true;
  };
  let contextLost = false;
  const onContextLost = (e: Event): void => {
    e.preventDefault(); // allow restoration
    contextLost = true;
  };
  const onContextRestored = (): void => {
    contextLost = false;
    sized = false;
    flushStars();
    writePips();
    flushMarkers(markers, markers.count);
    flushMarkers(shipMarks, shipMarks.count);
    ships.instanceMatrix.needsUpdate = true;
    (ships.instanceColor as InstancedBufferAttribute).needsUpdate = true;
    shipGlow.instanceMatrix.needsUpdate = true;
    (shipGlow.instanceColor as InstancedBufferAttribute).needsUpdate = true;
    nebulaTex.needsUpdate = true;
    glowTex.needsUpdate = true;
    layerDirty = true;
    shipsDirty = true;
    needsRender = true;
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  /**
   * Systems first (ships need their positions for route targets), then ships. Rewrites the star
   * instances only when a position, star type, count, planet survey level or the home changed.
   */
  function syncSystems(snap: Snapshot): void {
    const n = snap.meta[META_SYSTEM_COUNT];
    const home = snap.meta[META_HOME_SYSTEM];
    const np = Math.min(snap.meta[META_PLANET_COUNT], SNAPSHOT_MAX_PLANETS);
    let changed = n !== count || home !== homeSystem || np !== planetTotal;
    for (let i = 0; i < n * 2 && !changed; i++) changed = positions[i] !== snap.positions[i];
    for (let i = 0; i < n && !changed; i++) {
      changed =
        starType[i] !== snap.starType[i] ||
        planetCountOf[i] !== snap.planetCount[i] ||
        planetStart[i] !== snap.systemPlanetStart[i];
    }
    for (let i = 0; i < np && !changed; i++) changed = planetSurveyOf[i] !== snap.planetSurvey[i];
    if (!changed) return; // the galaxy is static between surveys: nothing to upload
    layerDirty = true;
    count = n;
    homeSystem = home;
    planetTotal = np;
    positions.set(snap.positions);
    starType.set(snap.starType);
    planetCountOf.set(snap.planetCount);
    planetStart.set(snap.systemPlanetStart);
    planetSurveyOf.set(snap.planetSurvey.subarray(0, SNAPSHOT_MAX_PLANETS));
    fillSystemSurvey(snap, sysSurvey);
    for (let i = 0; i < count; i++) writeStar(i);
    dots.count = count;
    glows.count = count;
    flushStars();
    writePips();
    writeMarkers();
    updateStaticOverlays();
    needsRender = true;
  }

  /** Local copy of what the system view shows per planet; refreshes the layer when it changed. */
  function syncPlanetData(snap: Snapshot): void {
    const np = Math.min(snap.meta[META_PLANET_COUNT], SNAPSHOT_MAX_PLANETS);
    parkedNext.fill(0);
    const ns = Math.min(snap.meta[META_SHIP_COUNT], SNAPSHOT_MAX_SHIPS);
    for (let i = 0; i < ns; i++) {
      const d = snap.shipDest[i];
      if (isParkedState(snap.shipState[i]) && d >= 0 && d < np && parkedNext[d] < 255) {
        parkedNext[d]++;
      }
    }
    for (let p = 0; p < np; p++) {
      if (
        planetHabLoOf[p] !== snap.planetHabLo[p] ||
        planetHabHiOf[p] !== snap.planetHabHi[p] ||
        planetOwnedOf[p] !== snap.planetOwned[p] ||
        planetParkedOf[p] !== parkedNext[p]
      ) {
        layerDirty = true;
        planetHabLoOf[p] = snap.planetHabLo[p];
        planetHabHiOf[p] = snap.planetHabHi[p];
        planetOwnedOf[p] = snap.planetOwned[p];
        planetParkedOf[p] = parkedNext[p];
      }
    }
    if (layerDirty && focusSystem >= 0) {
      layerDirty = false;
      systemLayer.refresh(layerData);
      needsRender = true;
    }
  }

  /** Fade every galaxy layer except the stars (their colours carry the fade) by `f`. */
  function applyGalaxyFade(f: number): void {
    markerUniforms.uAlpha.value = f;
    const vis = f > 0.004;
    markers.visible = vis;
    shipMarks.visible = vis;
    ships.visible = vis;
    shipGlow.visible = vis && !fx.noGlow;
    pips.visible = vis;
    routes.visible = vis;
    trails.visible = vis;
    (ships.material as MeshBasicMaterial).opacity = f;
    (pips.material as MeshBasicMaterial).opacity = f;
    shipGlowMat.opacity = f;
    // Overlays that decide their own visibility fade through their material instead.
    for (const line of [routes, trails, preview, destLine, shipRange.ring, colonyRange.ring]) {
      (line.material as LineBasicMaterial).opacity = f;
    }
    (shipRange.fill.material as MeshBasicMaterial).opacity = RANGE_FILL_OPACITY * f;
    (colonyRange.fill.material as MeshBasicMaterial).opacity = RANGE_FILL_OPACITY * f;
    (shipRing.material as MeshBasicMaterial).opacity = f;
  }

  function rewriteStars(): void {
    for (let i = 0; i < count; i++) writeStar(i);
    flushStars();
  }

  /** During the fade only the colours change (the quads vanish or return at the 0.004 threshold). */
  function rewriteStarColours(): void {
    for (let i = 0; i < count; i++) writeStarColours(i);
    flushStarColours();
  }

  /** The camera is back at the galaxy view: drop the focus and show every layer again. */
  function finishExit(): void {
    focusSystem = -1;
    galaxyAlpha = 1;
    wheelIn = 0;
    wheelOut = 0;
    rewriteStars();
    applyGalaxyFade(1);
    systemLayer.setAlpha(0);
    shipsDirty = true;
    needsRender = true;
  }

  function enterSystem(sys: number): boolean {
    if (sys < 0 || sys >= count || planetCountOf[sys] === 0) return false;
    const now = performance.now();
    if (focusSystem >= 0 && focusSystem !== sys) {
      slide.from = slide.to = 0;
      slide.durationMs = 0;
      finishExit();
    }
    if (focusSystem === sys && slide.to === 1) return true;
    const from = focusSystem >= 0 ? slidePos(slide, now) : 0;
    focusSystem = sys;
    systemLayer.setSystem(
      sys,
      positions[sys * 2],
      positions[sys * 2 + 1],
      planetStart[sys],
      planetCountOf[sys],
    );
    systemLayer.setSelectedSlot(selectedPlanet);
    systemLayer.refresh(layerData);
    layerDirty = false;
    slideStart(slide, now, 1, SYSTEM_ZOOM_MS, !motionOk, from);
    wheelIn = 0;
    wheelOut = 0;
    updateZoom(now);
    needsRender = true;
    opts.onSystemZoom?.(true);
    return true;
  }

  function exitSystem(instant: boolean): void {
    if (focusSystem < 0) return;
    const now = performance.now();
    if (instant) {
      slide.from = slide.to = 0;
      slide.durationMs = 0;
      finishExit();
      return;
    }
    if (slide.to === 0) return;
    slideStart(slide, now, 0, SYSTEM_ZOOM_MS, !motionOk, slidePos(slide, now));
    wheelOut = 0;
    needsRender = true;
    opts.onSystemZoom?.(false);
  }

  /** Per frame while a system is focused: place the camera from the slide, fade layers, finish exits. */
  function updateZoom(nowMs: number): void {
    if (focusSystem < 0) return;
    const moving = !slideDone(slide, nowMs);
    const e = easeInOutCubic(slidePos(slide, nowMs));
    computeSystemArea(view.width, view.height, area);
    fromView.cx = view.cx;
    fromView.cy = view.cy;
    fromView.scale = view.scale;
    focusView(
      fromView,
      positions[focusSystem * 2],
      positions[focusSystem * 2 + 1],
      area.cx - view.width / 2,
      area.cy - view.height / 2,
      systemFitScale(planetCountOf[focusSystem], area.width, area.height),
      e,
      toView,
    );
    camView.cx = toView.cx;
    camView.cy = toView.cy;
    camView.scale = toView.scale;
    camView.width = view.width;
    camView.height = view.height;
    const fade = galaxyFade(e);
    if (fade !== galaxyAlpha) {
      const crossed = galaxyAlpha < STAR_HIDE_ALPHA !== fade < STAR_HIDE_ALPHA;
      galaxyAlpha = fade;
      if (crossed) rewriteStars();
      else rewriteStarColours();
      applyGalaxyFade(fade);
    }
    systemLayer.setAlpha(systemFade(e));
    if (moving) needsRender = true;
    else if (slide.to === 0) finishExit();
  }

  return {
    sync(snap) {
      syncSystems(snap);
      syncColonies(snap);
      syncPlanetData(snap);
      clockOnSnapshot(clock, snap.meta[META_DAY], snap.meta[META_SPEED]);
      syncShips(snap);
    },
    enterSystem,
    exitSystem(instant = false) {
      exitSystem(instant);
    },
    inSystem() {
      return focusSystem >= 0 && slide.to === 1;
    },
    focusedSystem() {
      return focusSystem;
    },
    setSelectedPlanet(slot) {
      selectedPlanet = slot;
      systemLayer.setSelectedSlot(slot);
      needsRender = true;
    },
    setSelected(index) {
      if (index === selected) return;
      const prev = selected;
      selected = index;
      if (prev >= 0 && prev < count) writeStar(prev);
      if (selected >= 0 && selected < count) writeStar(selected);
      flushStars();
      writeMarkers();
      updateStaticOverlays();
    },
    setSelectedShip(entity) {
      if (entity === selectedShip) return;
      selectedShip = entity;
      writeRoutes();
      updateStaticOverlays();
      shipsDirty = true;
    },
    setRange(radiusWorld, reachable) {
      rangeRadius = radiusWorld > 0 ? radiusWorld : 0;
      if (reachable && rangeRadius > 0) reach.set(reachable.subarray(0, reach.length));
      else reach.fill(0);
      writeMarkers();
      updateStaticOverlays();
      shipsDirty = true;
    },
    setPreviewTarget(system) {
      if (system === previewTarget) return;
      previewTarget = system;
      shipsDirty = true;
    },
    setQuality(quality) {
      if (applyQuality(scaler, quality, startRenderScale(), fx.scale > 0)) {
        applyRenderScale();
        needsRender = true;
      }
    },
    setReducedMotion(reduced) {
      if (motionOk === !reduced) return;
      motionOk = !reduced;
      markerUniforms.uMotion.value = motionOk ? 1 : 0;
      animated = motionOk && markerCount > 0;
      needsRender = true;
    },
    setPulsesFrozen(frozen) {
      if (frozen === pulsesFrozen) return;
      pulsesFrozen = frozen;
      needsRender = true;
    },
    setActive(on) {
      if (on === active) return;
      active = on;
      canvas.style.display = on ? '' : 'none';
      if (on) {
        sized = false;
        needsRender = true;
        shipsDirty = true;
        lastNow = 0;
      }
    },
    frame(nowMs) {
      if (contextLost) return;
      if (!active) {
        lastNow = 0;
        return;
      }
      const dt = lastNow === 0 ? 0 : clampDt(nowMs - lastNow);
      lastNow = nowMs;
      if (startMs < 0) startMs = nowMs;
      // Ship interpolation redraws on the same adaptive step as the pulses; other changes at once.
      const animStep = animStepMs(lastCostMs, software);
      if (clockAdvance(clock, dt)) clockDirty = true;
      if (clockDirty && nowMs - lastShipMs >= animStep) shipsDirty = true;
      if (shipsDirty) {
        updateShips();
        lastShipMs = nowMs;
        clockDirty = false;
      }
      if (!sized) resize();
      updateZoom(nowMs);
      // Pulses and the turning ring redraw on the adaptive animation step; the rest only when it changed.
      const pulsing = !pulsesFrozen && (focusSystem >= 0 ? systemLayer.animated : animated);
      const animDue = pulsing && nowMs - lastAnimMs >= animStep;
      if (!needsRender && !animDue) return;
      needsRender = false;
      lastAnimMs = nowMs;
      markerUniforms.uTime.value = (nowMs - startMs) / 1000;
      systemLayer.setTime(markerUniforms.uTime.value);
      applyCamera();
      const t0 = performance.now();
      renderer.render(scene, camera);
      lastCostMs = performance.now() - t0;
      // The first renders compile shaders: leave them out of the scaler.
      if (++renderedFrames > 3 && scalerSample(scaler, lastCostMs < 200 ? lastCostMs : 200)) {
        applyRenderScale();
        needsRender = true;
      }
    },
    dispose() {
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      for (const mesh of [glows, dots, pips, markers, shipMarks, ships, shipGlow]) {
        mesh.geometry.dispose();
        mesh.dispose();
      }
      for (const line of [routes, trails, preview, destLine, shipRange.ring, colonyRange.ring]) {
        (line.material as LineBasicMaterial).dispose();
      }
      for (const geo of [routeGeo, trailGeo, previewGeo, destGeo, rangeGeo, fillGeo, fieldGeo]) {
        geo.dispose();
      }
      (shipRange.fill.material as MeshBasicMaterial).dispose();
      (colonyRange.fill.material as MeshBasicMaterial).dispose();
      shipRing.geometry.dispose();
      (shipRing.material as MeshBasicMaterial).dispose();
      backdrop.geometry.dispose();
      (backdrop.material as ShaderMaterial).dispose();
      fieldMat.dispose();
      glowMat.dispose();
      markerMat.dispose();
      dotMat.dispose();
      (pips.material as MeshBasicMaterial).dispose();
      (ships.material as MeshBasicMaterial).dispose();
      systemLayer.dispose();
      shipGlowMat.dispose();
      nebulaTex.dispose();
      glowTex.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
