import { getFx, startRenderScale, wantAntialias } from './gpuProbe';
import { reducedMotion as motionReduced } from './motion';
import {
  applyQuality,
  createScaler,
  effectivePixelRatio,
  type RenderQuality,
  scalerSample,
  scalerScale,
} from './perf';
import { computeViewArea, createViewArea } from './viewArea';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  SphereGeometry,
  WebGLRenderer,
} from 'three';
import { FOG_EXPLORED, FOG_VISIBLE } from '../shared/fog';
import { isLiveStatus } from '../shared/planetfall';
import { colonyRowOfPlanet } from '../shared/planetSnapshot';
import {
  C_POPULATION,
  CD_SITE,
  COLONY_DETAIL_STRIDE,
  COLONY_STRIDE,
  EXPEDITION_STRIDE,
  META_EXPEDITION_COUNT,
  META_PLANET_COUNT,
  SNAPSHOT_MAX_PLANETS,
  SNAPSHOT_MAX_REGIONS,
  SNAPSHOT_REGIONS_PER_COLONY,
  X_PLANET,
  X_REGION,
  X_STATUS,
  X_TARGET,
  X_TARGET2,
  type Snapshot,
} from '../shared/snapshot';
import { FIND_NONE_INDEX } from '../shared/terrain';
import { fillFogTexture, FOG_TEX_SIZE } from './fogTexture';
import { applyFogShading, createFogUniforms } from './fogShader';
import { layoutCentres, pickHex } from './hexLayout';
import {
  FIND_COLORS,
  HOVER_COLOR,
  LANDING_COLOR,
  SECOND_COLOR,
  SELECT_COLOR,
  TEAM_COLOR,
  tileBaseColorHex,
  tileCentreLift,
  tileTopY,
} from './hexPalette';
import {
  createOrbit,
  IDLE_PERIOD_MS,
  idleAzimuth,
  ORBIT_RADIANS_PER_PX,
  idlePolar,
  orbitFitDistance,
  orbitPosition,
  orbitRotate,
  orbitZoom,
  type OrbitState,
} from './orbitCamera';
import { normalizeWheelDelta } from './pick';
import { createBackdrop, type Backdrop } from './planetBackdrop';
import { createMarkerLists, planMarkers, teamRegions, type MarkerLists } from './planetMarkers';
import {
  buildPropGeometry,
  buildSimpleSiteGeometry,
  buildSiteGeometry,
  SIMPLE_MODEL_COUNT,
} from './propModels';
import {
  createPropList,
  planRegionProps,
  PropKind,
  PROP_KINDS,
  PROP_REGION_MAX,
  PROP_TINTS,
  surfaceOffset,
  writeInstanceMatrix,
} from './propPlan';
import {
  colonistDots as colonistDotsOf,
  createSiteList,
  Model,
  MODEL_COUNT,
  planSites,
  SITE_CAPACITY,
  type SiteInput,
} from './settlementPlan';
import { buildTerrain, createTerrainBuffers, HEX_VERTS, neighbourTable } from './terrainMesh';
import {
  colonyZoomBlend,
  COLONY_MIN_DISTANCE,
  createFit,
  createLod,
  createSlide,
  dollyFactor,
  easeInOutCubic,
  knownBounds,
  lerp,
  lodFor,
  PLANET_ENTER_MS,
  PLANET_EXIT_MS,
  slideDone,
  slidePos,
  slideStart,
  smoothstep,
  vignetteStrength,
} from './zoom';
import { createZoomFx, type ZoomFx } from './zoomFx';

export interface PlanetViewOptions {
  /** A click: the region under the pointer (local index) or -1 for empty space. */
  onSelectRegion(region: number): void;
  /** The pointer moved over a region (-1 when over none); sx, sy are pixels inside the canvas. */
  onHoverRegion(region: number, sx: number, sy: number): void;
  /** The entry dolly and fade finished: the view underneath may be hidden now. */
  onEntered?(): void;
}

export interface PlanetView {
  /** Copy the planet's region data out of `snap`; redraws only when something changed. */
  sync(snap: Snapshot, planet: number): void;
  /** Highlight the selected region and the explicit second region (-1 for none). */
  setSelected(region: number): void;
  setSecond(region: number): void;
  /**
   * Dolly out and fade away (M6c), then call `done` once (at once with prefers-reduced-motion). The
   * view stops reacting to the pointer; the caller disposes it from `done`.
   */
  beginExit(done: () => void): void;
  /** Render quality from Settings (M8): auto, or a pinned low / high render scale. */
  setQuality(quality: RenderQuality): void;
  /** Call from the shared requestAnimationFrame loop; draws only when something changed. */
  frame(nowMs: number): void;
  /** Free every GPU resource and listener. The canvas itself is left to the caller to remove. */
  dispose(): void;
}

const MAX_REGIONS = Math.floor(SNAPSHOT_MAX_REGIONS / SNAPSHOT_MAX_PLANETS);
const HEX_SIZE = 1;
const FOV_DEG = 40;
const CLICK_SLOP_PX = 4;
const KEY_ROTATE_PX = 24;
const KEY_ZOOM_PX = 80;
const MAX_TEAM_MARKERS = 8;
const BACKGROUND = 0x070b14;
/** Idle drift redraws at most this often (ms), about 15 Hz (D-127). */
const DRIFT_FRAME_MS = 66;
/** Props on ground that is visible but not yet explored: share of the full density (percent). */
const VISIBLE_DENSITY_PCT = 55;
/** A region with a building or a hut cluster keeps this disc free of props. */
const SITE_CLEAR_RADIUS = 0.55;
const PROP_CAPACITY = MAX_REGIONS * PROP_REGION_MAX;
/** Instance capacity per site model: Farm..Spaceport, Core, Hut, Dot. */
const SITE_CAPS: readonly number[] = [
  MAX_REGIONS,
  MAX_REGIONS,
  MAX_REGIONS,
  MAX_REGIONS,
  MAX_REGIONS,
  MAX_REGIONS,
  2,
  128,
  SITE_CAPACITY,
];
const RING_LIFT = 0.05;

/** Marker slots inside a hex (x, z offsets in hex units), so markers on one tile never overlap. */
const SLOT_LANDING = [-0.38, -0.28];
const SLOT_FIND = [0.36, -0.26];
const SLOT_TEAM = [-0.36, 0.3];

/**
 * The planet view: a perspective orbit camera over a hex map (planet view art pass, D-117).
 * Terrain is one indexed mesh with vertex-colour blending, bevelled edges and fake occlusion;
 * props, buildings, huts and crowd dots are InstancedMesh per model, placed by a render-local
 * hash; one fog DataTexture tints all of it; an ocean and an atmosphere rim sit behind. Markers
 * (landing, finds, teams) and highlight rings are small instanced meshes. Created when the player
 * opens a planet and disposed when they leave. Nothing allocates per frame; it draws only when
 * the data or the camera changed, except for the slow idle drift (about 30 Hz, off for
 * prefers-reduced-motion and after the first interaction).
 */
export function createPlanetView(canvas: HTMLCanvasElement, opts: PlanetViewOptions): PlanetView {
  const fxFlags = getFx();
  const renderer = new WebGLRenderer({ canvas, antialias: wantAntialias() });
  const scaler = createScaler(startRenderScale(), fxFlags.scale > 0);
  let renderedFrames = 0;
  renderer.setClearColor(BACKGROUND);
  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV_DEG, 1, 0.1, 2500);
  // Soft warm sun from the upper left, cool sky and warm ground bounce as the ambient.
  scene.add(new HemisphereLight(0xcfdcff, 0x7a6244, 1.55));
  const sun = new DirectionalLight(0xffe2b8, 2.4);
  sun.position.set(-5, 9, 5);
  scene.add(sun);
  const backdrop: Backdrop = createBackdrop(scene);

  const tmp = new Color();
  const disposables: { dispose(): void }[] = [];
  const instancedMeshes: InstancedMesh[] = [];

  const fogMade = createFogUniforms();
  const fogU = fogMade.uniforms;
  disposables.push(fogU.tex.value);
  const fogScratch = new Uint8Array(FOG_TEX_SIZE * FOG_TEX_SIZE);

  // One fogged, vertex-coloured material for terrain, props and buildings; a plain one for markers.
  const worldMat = new MeshLambertMaterial({ vertexColors: true });
  applyFogShading(worldMat, fogU);
  const markerMat = new MeshLambertMaterial();
  disposables.push(worldMat, markerMat);

  function instanced(
    geometry: BufferGeometry,
    capacity: number,
    material: MeshLambertMaterial,
  ): InstancedMesh {
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.instanceColor.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);
    disposables.push(geometry);
    instancedMeshes.push(mesh);
    return mesh;
  }

  // Terrain: one indexed mesh over fixed buffers.
  const terrainBuf = createTerrainBuffers(MAX_REGIONS);
  const terrainGeo = new BufferGeometry();
  const posAttr = new BufferAttribute(terrainBuf.positions, 3);
  const colAttr = new BufferAttribute(terrainBuf.colors, 3);
  const nrmAttr = new BufferAttribute(new Float32Array(MAX_REGIONS * HEX_VERTS * 3), 3);
  posAttr.setUsage(DynamicDrawUsage);
  colAttr.setUsage(DynamicDrawUsage);
  nrmAttr.setUsage(DynamicDrawUsage);
  terrainGeo.setAttribute('position', posAttr);
  terrainGeo.setAttribute('color', colAttr);
  terrainGeo.setAttribute('normal', nrmAttr);
  terrainGeo.setIndex(new BufferAttribute(terrainBuf.index, 1));
  terrainGeo.setDrawRange(0, 0);
  const terrain3d = new Mesh(terrainGeo, worldMat);
  terrain3d.frustumCulled = false;
  scene.add(terrain3d);
  disposables.push(terrainGeo);

  // Props and buildings: one InstancedMesh per model.
  const propMeshes: InstancedMesh[] = [];
  for (let k = 0; k < PROP_KINDS; k++) {
    propMeshes.push(instanced(buildPropGeometry(k), PROP_CAPACITY, worldMat));
  }
  const siteMeshes: InstancedMesh[] = [];
  for (let m = 0; m < MODEL_COUNT; m++) {
    siteMeshes.push(instanced(buildSiteGeometry(m), SITE_CAPS[m], worldMat));
  }

  // Simplified district silhouettes share the instance buffers of the full models (colony LOD).
  const simpleMeshes: InstancedMesh[] = [];
  for (let m = 0; m < SIMPLE_MODEL_COUNT; m++) {
    const mesh = instanced(buildSimpleSiteGeometry(m), SITE_CAPS[m], worldMat);
    mesh.instanceMatrix = siteMeshes[m].instanceMatrix;
    mesh.instanceColor = siteMeshes[m].instanceColor;
    mesh.visible = false;
    simpleMeshes.push(mesh);
  }

  // Markers keep simple shapes and colours so they read on any terrain.
  const finds = instanced(new OctahedronGeometry(0.2), MAX_REGIONS, markerMat);
  const landings = instanced(new ConeGeometry(0.2, 0.55, 4), MAX_REGIONS, markerMat);
  const teams = instanced(new SphereGeometry(0.2, 12, 8), MAX_TEAM_MARKERS, markerMat);

  // Highlight rings, laid flat on the tile tops (pointy-top hexes: first vertex at 30 degrees).
  function ringMesh(color: number): Mesh {
    const geo = new RingGeometry(0.8, 0.96, 6, 1, Math.PI / 6);
    const mat = new MeshBasicMaterial({ color, side: DoubleSide });
    const m = new Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    scene.add(m);
    disposables.push(geo, mat);
    return m;
  }
  const hoverRing = ringMesh(HOVER_COLOR);
  const selectRing = ringMesh(SELECT_COLOR);
  const secondRing = ringMesh(SECOND_COLOR);

  // Local mirrors of the planet's regions: picking and redraws never touch a returned snapshot.
  let planet = -1;
  let count = 0;
  const q = new Int8Array(MAX_REGIONS);
  const r = new Int8Array(MAX_REGIONS);
  const fogB = new Uint8Array(MAX_REGIONS);
  const terrain = new Uint8Array(MAX_REGIONS);
  const find = new Uint8Array(MAX_REGIONS);
  const landing = new Uint8Array(MAX_REGIONS);
  const native = new Uint8Array(MAX_REGIONS);
  const districtKind = new Uint8Array(MAX_REGIONS);
  const districtLeft = new Uint8Array(MAX_REGIONS);
  const districtKindNext = new Uint8Array(MAX_REGIONS);
  const districtLeftNext = new Uint8Array(MAX_REGIONS);
  let nativeKind = 0;
  let colonyRegion = -1;
  let colonyDots = 0;
  const teamBuf = new Int16Array(MAX_TEAM_MARKERS);
  let teamCount = 0;
  const teamNext = new Int16Array(MAX_TEAM_MARKERS);
  const centres = new Float32Array(MAX_REGIONS * 3);
  const tops = new Float32Array(MAX_REGIONS);
  const lifts = new Float32Array(MAX_REGIONS);
  const baseHex = new Int32Array(MAX_REGIONS);
  const nbr = new Int8Array(MAX_REGIONS * 6);
  const propList = createPropList(PROP_CAPACITY);
  const siteList = createSiteList(SITE_CAPACITY);
  const siteInput: SiteInput = {
    count: 0,
    fog: fogB,
    native,
    nativeKind: 0,
    district: districtKind,
    districtLeft,
    colonyRegion: -1,
    colonyDots: 0,
  };
  const instanceCounts = new Int32Array(Math.max(PROP_KINDS, MODEL_COUNT));
  const lists: MarkerLists = createMarkerLists();
  let selected = -1;
  let second = -1;
  let hover = -1;

  const fx: ZoomFx = createZoomFx(canvas);
  const fit = createFit();
  const lod = createLod();
  /** Entry and exit: 0 = away, 1 = settled. The dolly and fade are functions of this alone. */
  const slide = createSlide(0);
  const reducedMotion = motionPrefersReduced();
  slideStart(slide, performance.now(), 1, PLANET_ENTER_MS, reducedMotion, 0);
  canvas.style.opacity = '0';
  let lastOpacity = 0;
  let entered = false;
  let enteredAt = 0;
  let exitDone: (() => void) | null = null;
  let exitNotified = false;
  let targetX = 0;
  let targetZ = 0;
  let dollyE = 0;

  const orbit: OrbitState = createOrbit(12, 4, 40);
  /** What the camera really uses: the orbit plus the idle drift. */
  const driven: OrbitState = createOrbit(12, 4, 40);
  let layoutRadius = HEX_SIZE;
  const camPos = new Float32Array(3);
  const viewProj = new Matrix4();
  let width = 1;
  let height = 1;
  let sized = false;
  let dirty = true;
  let contextLost = false;
  let needFit = true;

  function motionPrefersReduced(): boolean {
    return motionReduced();
  }

  // Idle drift: a slow sway until the first interaction; never with prefers-reduced-motion.
  const motionQuery =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
  let driftOn = !motionReduced();
  let driftStart = -1;
  let driftLastMs = 0;
  let driftAz = 0;
  let driftPo = 0;
  function stopDrift(): void {
    if (!driftOn) return;
    driftOn = false;
    // Keep the view where it is: bake the sway into the orbit so nothing jumps.
    orbitRotate(orbit, -driftAz / ORBIT_RADIANS_PER_PX, -driftPo / ORBIT_RADIANS_PER_PX);
    driftAz = 0;
    driftPo = 0;
  }
  const onMotionChange = (): void => {
    if (motionReduced()) {
      stopDrift();
      dirty = true;
    }
  };
  motionQuery?.addEventListener('change', onMotionChange);

  /** Does region `i` hold a building, the colony core or a native hut cluster? */
  function occupied(i: number): boolean {
    return districtKind[i] > 0 || i === colonyRegion || (native[i] === 1 && nativeKind > 0);
  }

  function writeColor(mesh: InstancedMesh, n: number, hex: number, mul: number): void {
    tmp.setHex(hex);
    const ca = (mesh.instanceColor as InstancedBufferAttribute).array as Float32Array;
    ca[n * 3] = tmp.r * mul;
    ca[n * 3 + 1] = tmp.g * mul;
    ca[n * 3 + 2] = tmp.b * mul;
  }

  /** Place marker instance `n` of `mesh` on region `region`'s tile at `slot`, `lift` above the surface. */
  function putMarker(
    mesh: InstancedMesh,
    n: number,
    region: number,
    slot: number[],
    lift: number,
    hex: number,
  ): void {
    const rad = Math.hypot(slot[0], slot[1]) * HEX_SIZE;
    writeInstanceMatrix(
      mesh.instanceMatrix.array as Float32Array,
      n,
      centres[region * 3] + slot[0] * HEX_SIZE,
      tops[region] + surfaceOffset(rad, lifts[region]) + lift,
      centres[region * 3 + 2] + slot[1] * HEX_SIZE,
      1,
      0,
    );
    writeColor(mesh, n, hex, 1);
  }

  function finish(mesh: InstancedMesh, n: number): void {
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    (mesh.instanceColor as InstancedBufferAttribute).needsUpdate = true;
  }

  function rebuildTerrain(): void {
    for (let i = 0; i < count; i++) {
      tops[i] = tileTopY(fogB[i], terrain[i]);
      // A tile with something built on it is levelled, so the building sits flat.
      lifts[i] = occupied(i) ? 0 : tileCentreLift(fogB[i], terrain[i]);
      baseHex[i] = tileBaseColorHex(fogB[i], terrain[i]);
      centres[i * 3 + 1] = tops[i]; // picking projects the tile top
    }
    neighbourTable(q, r, count, nbr);
    const indices = buildTerrain(
      count,
      q,
      r,
      centres,
      tops,
      lifts,
      baseHex,
      nbr,
      HEX_SIZE,
      planet,
      terrainBuf,
    );
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    terrainGeo.computeVertexNormals();
    nrmAttr.needsUpdate = true;
    terrainGeo.setDrawRange(0, indices);
    const ext = layoutRadius + 0.6;
    fogU.ext.value = ext;
    fillFogTexture(fogMade.data, fogScratch, FOG_TEX_SIZE, ext, centres, fogB, count);
    fogU.tex.value.needsUpdate = true;
  }

  function rebuildProps(): void {
    propList.count = 0;
    for (let i = 0; i < count; i++) {
      const f = fogB[i];
      if (f !== FOG_VISIBLE && f !== FOG_EXPLORED) continue;
      planRegionProps(
        planet,
        i,
        terrain[i],
        f === FOG_EXPLORED ? 100 : VISIBLE_DENSITY_PCT,
        occupied(i) ? SITE_CLEAR_RADIUS : 0,
        propList,
      );
    }
    instanceCounts.fill(0);
    for (let o = 0; o < propList.count; o++) {
      const k = propList.kind[o];
      const n = instanceCounts[k];
      if (n >= PROP_CAPACITY) continue;
      const region = propList.region[o];
      const x = propList.x[o];
      const z = propList.z[o];
      const mesh = propMeshes[k];
      writeInstanceMatrix(
        mesh.instanceMatrix.array as Float32Array,
        n,
        centres[region * 3] + x * HEX_SIZE,
        tops[region] + surfaceOffset(Math.hypot(x, z), lifts[region]),
        centres[region * 3 + 2] + z * HEX_SIZE,
        propList.scale[o],
        propList.rot[o],
      );
      writeColor(mesh, n, PROP_TINTS[propList.terrain[o]][k], propList.shade[o]);
      instanceCounts[k] = n + 1;
    }
    for (let k = 0; k < PROP_KINDS; k++) finish(propMeshes[k], instanceCounts[k]);
  }

  function rebuildSites(): void {
    siteInput.count = count;
    siteInput.nativeKind = nativeKind;
    siteInput.colonyRegion = colonyRegion;
    siteInput.colonyDots = colonyDots;
    planSites(planet, siteInput, siteList);
    instanceCounts.fill(0);
    for (let o = 0; o < siteList.count; o++) {
      const m = siteList.model[o];
      const n = instanceCounts[m];
      if (n >= SITE_CAPS[m]) continue;
      const region = siteList.region[o];
      const x = siteList.x[o];
      const z = siteList.z[o];
      const mesh = siteMeshes[m];
      writeInstanceMatrix(
        mesh.instanceMatrix.array as Float32Array,
        n,
        centres[region * 3] + x * HEX_SIZE,
        tops[region] + surfaceOffset(Math.hypot(x, z), lifts[region]),
        centres[region * 3 + 2] + z * HEX_SIZE,
        siteList.scale[o],
        siteList.rot[o],
      );
      writeColor(mesh, n, siteList.tint[o], 1);
      instanceCounts[m] = n + 1;
    }
    for (let m = 0; m < MODEL_COUNT; m++) finish(siteMeshes[m], instanceCounts[m]);
    for (let m = 0; m < SIMPLE_MODEL_COUNT; m++) simpleMeshes[m].count = instanceCounts[m];
  }

  function rebuild(): void {
    rebuildTerrain();
    rebuildProps();
    rebuildSites();
    planMarkers(
      {
        count,
        fog: fogB,
        find,
        landing,
        native,
        nativeMet: nativeKind > 0,
        noneFind: FIND_NONE_INDEX,
        colonyRegion,
        teams: teamBuf,
        teamCount,
      },
      lists,
    );
    for (let i = 0; i < lists.findCount; i++) {
      const kind = lists.findKinds[i];
      putMarker(finds, i, lists.finds[i], SLOT_FIND, 0.22, FIND_COLORS[kind] ?? 0xffffff);
    }
    finish(finds, lists.findCount);
    for (let i = 0; i < lists.landingCount; i++) {
      putMarker(landings, i, lists.landing[i], SLOT_LANDING, 0.28, LANDING_COLOR);
    }
    finish(landings, lists.landingCount);
    for (let i = 0; i < lists.teamCount; i++) {
      putMarker(teams, i, lists.teams[i], SLOT_TEAM, 0.2, TEAM_COLOR);
    }
    finish(teams, lists.teamCount);
    placeRings();
    dirty = true;
  }

  function placeRing(ring: Mesh, region: number): void {
    if (region < 0 || region >= count) {
      ring.visible = false;
      return;
    }
    ring.visible = true;
    ring.position.set(centres[region * 3], tops[region] + RING_LIFT, centres[region * 3 + 2]);
  }

  function placeRings(): void {
    placeRing(hoverRing, hover === selected || hover === second ? -1 : hover);
    placeRing(selectRing, selected);
    placeRing(secondRing, second);
  }

  const area = createViewArea();

  /** Show or hide detail by camera distance: crowd dots, small props, simple district models. */
  function applyLod(): void {
    siteMeshes[Model.Dot].visible = lod.crowd;
    propMeshes[PropKind.Tuft].visible = lod.smallProps;
    propMeshes[PropKind.Rock].visible = lod.smallProps;
    propMeshes[PropKind.Slab].visible = lod.smallProps;
    for (let m = 0; m < SIMPLE_MODEL_COUNT; m++) {
      siteMeshes[m].visible = !lod.simpleDistricts;
      simpleMeshes[m].visible = lod.simpleDistricts;
    }
  }

  function applyRenderScale(): void {
    renderer.setPixelRatio(effectivePixelRatio(window.devicePixelRatio || 1, scalerScale(scaler)));
  }

  function resize(): void {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    applyRenderScale();
    renderer.setSize(w, h, false);
    width = w;
    height = h;
    camera.aspect = w / h;
    computeViewArea(w, h, area);
    camera.setViewOffset(w, h, area.offsetX, area.offsetY, w, h);
    sized = true;
    dirty = true;
    if (needFit) fitOrbit();
  }

  /** Frame the explored and visible part of the map so it fills the free area (M6c). */
  function fitOrbit(): void {
    knownBounds(centres, fogB, count, HEX_SIZE, fit);
    const aspect = area.width / area.height;
    const d = orbitFitDistance(fit.radius, FOV_DEG, aspect) * area.distanceScale;
    const whole = orbitFitDistance(layoutRadius, FOV_DEG, aspect) * area.distanceScale;
    orbit.minDistance = Math.min(COLONY_MIN_DISTANCE, d);
    orbit.maxDistance = Math.max(d * 1.6, whole * 1.15);
    orbit.distance = d;
    orbit.azimuth = 0;
    orbit.polar = 0.6;
    needFit = false;
  }

  function applyCamera(): void {
    driven.azimuth = orbit.azimuth + driftAz;
    driven.polar = orbit.polar + driftPo;
    driven.distance = orbit.distance * dollyFactor(dollyE);
    // Rolling in close to a colony glides the view onto its core.
    const blend = colonyRegion >= 0 && colonyRegion < count ? colonyZoomBlend(orbit.distance) : 0;
    targetX = blend > 0 ? lerp(fit.cx, centres[colonyRegion * 3], blend) : fit.cx;
    targetZ = blend > 0 ? lerp(fit.cz, centres[colonyRegion * 3 + 2], blend) : fit.cz;
    orbitPosition(driven, targetX, 0, targetZ, camPos, 0);
    camera.position.set(camPos[0], camPos[1], camPos[2]);
    camera.lookAt(targetX, 0, targetZ);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  }

  function pick(sx: number, sy: number): number {
    applyCamera();
    return pickHex(centres, count, viewProj.elements, width, height, sx, sy, HEX_SIZE);
  }

  // Pointer: drag turns the camera, a short press selects, a move over the map hovers.
  let dragging = false;
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;
  let moved = 0;
  const onDown = (e: PointerEvent): void => {
    if (!e.isPrimary || e.button !== 0) return;
    stopDrift();
    dragging = true;
    downX = lastX = e.offsetX;
    downY = lastY = e.offsetY;
    moved = 0;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // capture is a convenience
    }
  };
  const onMove = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    if (dragging) {
      orbitRotate(orbit, e.offsetX - lastX, e.offsetY - lastY);
      lastX = e.offsetX;
      lastY = e.offsetY;
      moved = Math.max(moved, Math.abs(e.offsetX - downX) + Math.abs(e.offsetY - downY));
      dirty = true;
      return;
    }
    const h = pick(e.offsetX, e.offsetY);
    if (h !== hover) {
      hover = h;
      placeRings();
      dirty = true;
      opts.onHoverRegion(h, e.offsetX, e.offsetY);
    }
  };
  const onUp = (e: PointerEvent): void => {
    if (!dragging || !e.isPrimary) return;
    dragging = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    if (moved <= CLICK_SLOP_PX) opts.onSelectRegion(pick(e.offsetX, e.offsetY));
  };
  const onLeave = (): void => {
    if (hover === -1) return;
    hover = -1;
    placeRings();
    dirty = true;
    opts.onHoverRegion(-1, 0, 0);
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    stopDrift();
    orbitZoom(orbit, normalizeWheelDelta(e.deltaY, e.deltaMode));
    dirty = true;
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let used = true;
    switch (e.key) {
      case 'ArrowLeft':
        stopDrift();
        orbitRotate(orbit, -KEY_ROTATE_PX, 0);
        break;
      case 'ArrowRight':
        stopDrift();
        orbitRotate(orbit, KEY_ROTATE_PX, 0);
        break;
      case 'ArrowUp':
        stopDrift();
        orbitRotate(orbit, 0, -KEY_ROTATE_PX);
        break;
      case 'ArrowDown':
        stopDrift();
        orbitRotate(orbit, 0, KEY_ROTATE_PX);
        break;
      case '+':
      case '=':
        stopDrift();
        orbitZoom(orbit, -KEY_ZOOM_PX);
        break;
      case '-':
      case '_':
        stopDrift();
        orbitZoom(orbit, KEY_ZOOM_PX);
        break;
      default:
        used = false;
    }
    if (used) {
      e.preventDefault();
      dirty = true;
    }
  };
  const onResize = (): void => {
    sized = false;
    dirty = true;
  };
  const onContextLost = (e: Event): void => {
    e.preventDefault();
    contextLost = true;
  };
  const onContextRestored = (): void => {
    contextLost = false;
    sized = false;
    for (const mesh of instancedMeshes) {
      mesh.instanceMatrix.needsUpdate = true;
      (mesh.instanceColor as InstancedBufferAttribute).needsUpdate = true;
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    nrmAttr.needsUpdate = true;
    fogU.tex.value.needsUpdate = true;
    dirty = true;
  };
  window.addEventListener('resize', onResize);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKey);
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  return {
    sync(snap, p) {
      if (p < 0 || p >= snap.meta[META_PLANET_COUNT]) return;
      const start = snap.planetRegionStart[p];
      const n = Math.min(snap.planetRegionCount[p], MAX_REGIONS);
      let changed = p !== planet || n !== count;
      const newPlanet = p !== planet;
      for (let i = 0; i < n; i++) {
        const g = start + i;
        if (
          q[i] !== snap.regionQ[g] ||
          r[i] !== snap.regionR[g] ||
          fogB[i] !== snap.regionFog[g] ||
          terrain[i] !== snap.regionTerrain[g] ||
          find[i] !== snap.regionFind[g] ||
          landing[i] !== snap.regionLanding[g] ||
          native[i] !== snap.regionNative[g]
        ) {
          changed = true;
          q[i] = snap.regionQ[g];
          r[i] = snap.regionR[g];
          fogB[i] = snap.regionFog[g];
          terrain[i] = snap.regionTerrain[g];
          find[i] = snap.regionFind[g];
          landing[i] = snap.regionLanding[g];
          native[i] = snap.regionNative[g];
        }
      }
      // The natives' disposition (0 until met) tints their huts and dots.
      const kind = snap.planetNative[p];
      if (kind !== nativeKind) {
        nativeKind = kind;
        changed = true;
      }
      const crow = snap.planetOwned[p] !== 0 ? colonyRowOfPlanet(snap, p) : -1;
      const site = crow >= 0 ? snap.colonyDetail[crow * COLONY_DETAIL_STRIDE + CD_SITE] : -1;
      if (site !== colonyRegion) {
        colonyRegion = site;
        changed = true;
      }
      // Districts of the colony on this planet (kind and build days left per region).
      districtKindNext.fill(0);
      districtLeftNext.fill(0);
      let dots = 0;
      if (crow >= 0) {
        const base = crow * SNAPSHOT_REGIONS_PER_COLONY;
        for (let i = 0; i < n && i < SNAPSHOT_REGIONS_PER_COLONY; i++) {
          districtKindNext[i] = snap.colonyDistrictKind[base + i];
          districtLeftNext[i] = snap.colonyDistrictLeft[base + i];
        }
        dots = colonistDotsOf(snap.colonies[crow * COLONY_STRIDE + C_POPULATION]);
      }
      for (let i = 0; i < MAX_REGIONS; i++) {
        if (districtKind[i] !== districtKindNext[i] || districtLeft[i] !== districtLeftNext[i]) {
          districtKind[i] = districtKindNext[i];
          districtLeft[i] = districtLeftNext[i];
          changed = true;
        }
      }
      if (dots !== colonyDots) {
        colonyDots = dots;
        changed = true;
      }
      // Expedition teams on this planet: where each stands now.
      let t = 0;
      const ne = snap.meta[META_EXPEDITION_COUNT];
      for (let i = 0; i < ne; i++) {
        const o = i * EXPEDITION_STRIDE;
        if (snap.expeditions[o + X_PLANET] !== p) continue;
        t = teamRegions(
          isLiveStatus(snap.expeditions[o + X_STATUS]),
          snap.expeditions[o + X_TARGET],
          snap.expeditions[o + X_TARGET2],
          snap.expeditions[o + X_REGION],
          teamNext,
          t,
        );
      }
      let teamsChanged = t !== teamCount;
      for (let i = 0; i < t && !teamsChanged; i++) teamsChanged = teamNext[i] !== teamBuf[i];
      if (teamsChanged) {
        teamBuf.set(teamNext);
        teamCount = t;
        changed = true;
      }
      if (!changed) return;
      planet = p;
      count = n;
      if (newPlanet || layoutRadius === HEX_SIZE) {
        layoutRadius = layoutCentres(q, r, count, HEX_SIZE, 0, centres);
        needFit = true;
        if (sized) fitOrbit();
        selected = -1;
        second = -1;
        hover = -1;
      } else {
        layoutCentres(q, r, count, HEX_SIZE, 0, centres);
      }
      rebuild();
    },
    setSelected(region) {
      if (region === selected) return;
      selected = region;
      placeRings();
      dirty = true;
    },
    setSecond(region) {
      if (region === second) return;
      second = region;
      placeRings();
      dirty = true;
    },
    beginExit(done) {
      if (exitDone) return;
      exitDone = done;
      canvas.style.pointerEvents = 'none';
      slideStart(
        slide,
        performance.now(),
        0,
        PLANET_EXIT_MS,
        reducedMotion,
        slidePos(slide, performance.now()),
      );
      dirty = true;
    },
    frame(nowMs) {
      if (contextLost) return;
      if (!sized) resize();
      // Entry and exit are functions of real time: dolly and fade follow the slide position.
      const pos = slidePos(slide, nowMs);
      const moving = !slideDone(slide, nowMs);
      const e = easeInOutCubic(pos);
      if (e !== dollyE) {
        dollyE = e;
        dirty = true;
      }
      const opacity = smoothstep(0, 0.7, pos);
      if (Math.abs(opacity - lastOpacity) > 0.004 || (!moving && opacity !== lastOpacity)) {
        lastOpacity = opacity;
        canvas.style.opacity = String(Math.round(opacity * 1000) / 1000);
      }
      if (!moving) {
        if (slide.to === 1 && !entered) {
          entered = true;
          enteredAt = nowMs;
          opts.onEntered?.();
        } else if (slide.to === 0 && exitDone && !exitNotified) {
          exitNotified = true;
          exitDone();
          return;
        }
      }
      // The sway stops one period after the entry finished (baked in, so nothing jumps).
      if (driftOn && entered && nowMs - enteredAt >= IDLE_PERIOD_MS) {
        stopDrift();
        dirty = true;
      }
      if (driftOn) {
        if (driftStart < 0) driftStart = nowMs;
        if (nowMs - driftLastMs >= DRIFT_FRAME_MS) {
          driftLastMs = nowMs;
          driftAz = idleAzimuth(nowMs - driftStart);
          driftPo = idlePolar(nowMs - driftStart);
          dirty = true;
        }
      }
      if (!dirty) return;
      dirty = false;
      if (lodFor(orbit.distance, lod)) applyLod();
      fx.setStrength(vignetteStrength(colonyZoomBlend(orbit.distance)) * lastOpacity);
      applyCamera();
      const t0 = performance.now();
      renderer.render(scene, camera);
      const cost = performance.now() - t0;
      if (++renderedFrames > 3 && scalerSample(scaler, cost < 200 ? cost : 200)) {
        applyRenderScale();
        dirty = true;
      }
      if (moving) dirty = true;
    },
    setQuality(quality) {
      if (applyQuality(scaler, quality, startRenderScale(), fxFlags.scale > 0)) {
        applyRenderScale();
        dirty = true;
      }
    },
    dispose() {
      motionQuery?.removeEventListener('change', onMotionChange);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKey);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      backdrop.dispose();
      fx.dispose();
      for (const d of disposables) d.dispose();
      for (const mesh of instancedMeshes) mesh.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
