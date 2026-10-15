import './ui/style.css';
import type { Command, GameSpeed } from './shared/commands';
import type { FromWorker, ToWorker } from './shared/messages';
import {
  copySnapshotInto,
  createSnapshot,
  META_STATE_HASH,
  META_TICK_MS,
  snapshotBuffers,
} from './shared/snapshot';
import { createGalaxyView } from './render/galaxyView';
import { reducedMotion, setMotionOverride } from './render/motion';
import type { PlanetView } from './render/planetView';
import {
  createCommandTracker,
  describeRejectFor,
  NO_REPLY_TEXT,
  type CommandKind,
} from './ui/commandGate';
import { createColonyPanel } from './ui/colonyPanel';
import { createDebugOverlay } from './ui/debugOverlay';
import { createErrorBanner } from './ui/errorBanner';
import { createEventCard } from './ui/eventCardPanel';
import { createEndScreen } from './ui/endScreenPanel';
import { createHud, STAR_NAMES } from './ui/hud';
import { createIdbStorage } from './ui/idbSave';
import { createMenu } from './ui/menuPanel';
import { createMenuGate } from './ui/menuGate';
import { createMissionCommand } from './ui/missionCommand';
import { createReroutePanel } from './ui/reroutePanel';
import { createPlanetUi, type PlanetUi } from './ui/planetUi';
import {
  canLand,
  closePlanet,
  createPlanetContext,
  createPlanetSession,
  fillPlanetContext,
  openPlanet,
  pickShip,
  reconcile,
  selectRegion,
} from './ui/planetSession';
import { createShipList } from './ui/shipListPanel';
import { createTechPanel } from './ui/techPanel';
import { createSystemPlanetsPanel } from './ui/systemPlanetsPanel';
import { createTutorialPanel } from './ui/tutorialPanel';
import { NOTHING_TO_OPEN_TEXT, planetClickAction } from './ui/openPlanetModel';
import { createAutoPause } from './ui/visibility';
import { SAVE_SLOT } from './shared/save';
import { exportSaveText, saveFileName } from './shared/saveFile';
import { bindArrowNav, createLiveRegions, createSkipLink } from './ui/a11y';
import { applyAppearance, rootAppearance } from './ui/appearance';
import { createAudioEngine } from './ui/audio';
import { cueForEvent } from './ui/audioModel';
import { createErrorLog, installErrorCapture } from './ui/errorLog';
import {
  createGameEventDetector,
  createGameFacts,
  eventAnnouncement,
  readGameFacts,
  type GameEventKind,
} from './ui/gameEvents';
import { createAnnouncer, nextSystem, systemAnnouncement } from './ui/navModel';
import { downloadTextFile, readSaveFile } from './ui/saveIo';
import { createSettingsPanel } from './ui/settingsPanel';
import { browserStorage, createSettingsStore, type Settings } from './ui/settingsModel';
import { META_SPEED, META_SYSTEM_COUNT, META_HOME_SYSTEM } from './shared/snapshot';

const DEFAULT_SEED = 42;

function parseSeed(search: string): number {
  const raw = new URLSearchParams(search).get('seed');
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) ? n : DEFAULT_SEED;
}

const worker = new Worker(new URL('./worker/worker.ts', import.meta.url), { type: 'module' });
const send = (msg: ToWorker, transfer: Transferable[] = []): void =>
  worker.postMessage(msg, transfer);

const canvas = document.getElementById('galaxy') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;
const overlay = new URLSearchParams(location.search).has('debug') ? createDebugOverlay() : null;

// ---- Local error log, settings, audio, announcements (M8) ----------------------------------------
const errorLog = createErrorLog();
const removeErrorCapture = installErrorCapture(window, errorLog);
const settings = createSettingsStore(browserStorage());
setMotionOverride(settings.get().motion);
applyAppearance(document.documentElement, rootAppearance(settings.get()));
const audio = createAudioEngine();
audio.apply(settings.get());
// Sound starts only after the first user gesture (browsers require it anyway).
const GESTURES = ['pointerdown', 'keydown', 'touchstart'] as const;
const unlockAudio = (): void => {
  audio.unlock();
  for (const t of GESTURES) document.removeEventListener(t, unlockAudio, true);
};
for (const t of GESTURES) document.addEventListener(t, unlockAudio, true);
const onClickCue = (e: MouseEvent): void => {
  if (!(e.target instanceof Element)) return;
  const b = e.target.closest('button');
  if (b !== null && !b.disabled) audio.play('click');
};
document.addEventListener('click', onClickCue, true);
const live = createLiveRegions(document.body);
const announcer = createAnnouncer((text) => live.polite(text));
const gameFacts = createGameFacts();
const eventDetector = createGameEventDetector();
/** An important event: said to screen readers and, if there is a cue for it, played. */
function onGameEvent(kind: GameEventKind): void {
  if (kind === 'won' || kind === 'lost') live.assertive(eventAnnouncement(kind));
  else announcer.say(eventAnnouncement(kind));
  const cue = cueForEvent(kind);
  if (cue !== null) audio.play(cue);
}
const mainEl = document.getElementById('main-content');
if (mainEl) createSkipLink(document.body, mainEl, 'Skip to the game map');

// Main-thread copy of the latest snapshot; the worker's buffers go straight back after copying.
const mirror = createSnapshot();
let haveSnapshot = false;

// D-022: auto-pause while the tab is hidden; see src/ui/visibility.ts.
/** World generation (D-107): a new game or an adopted load starts a new one; stale replies are dropped. */
let genCounter = 1;
let generation = 1;
/** After a new game or a load the first snapshot tells which speed the world runs at. */
let syncSpeed = false;
const autoPause = createAutoPause((speed) => send({ kind: 'setSpeed', gen: generation, speed }));
// One column holds the system, reroute and ship list panels so they never overlap.
const rightCol = document.createElement('div');
rightCol.className = 'hud-col-right';
hudRoot.appendChild(rightCol);
rightCol.setAttribute('role', 'complementary');
rightCol.setAttribute('aria-label', 'System, planets, ships and colonies');
const banner = createErrorBanner(hudRoot);
const hud = createHud(hudRoot, {
  onSpeed: (speed) => autoPause.userSpeed(speed),
  panelRoot: rightCol,
  onZoomSystem: () => zoomToSystem(),
  onZoomOut: () => view.exitSystem(),
});
// Commands get ids from 1; id 0 is reserved for setSpeed replies.
let nextCommandId = 1;
const tracker = createCommandTracker();
function sendCommand(command: Command, kind: CommandKind): void {
  const id = nextCommandId++;
  tracker.track(id, kind, performance.now());
  send({ kind: 'command', id, gen: generation, command });
}
const mission = createMissionCommand(hudRoot, {
  onLaunch(command) {
    sendCommand(command, 'launch');
  },
  onPlanetChange: (slot) => pickPlanetSlot(slot),
});

/** Slot of the destination planet in the selected system: shared by the dropdown, the rows and the system map. */
let selectedSlot = -1;
function pickPlanetSlot(slot: number): void {
  selectedSlot = slot;
  view.setSelectedPlanet(slot);
  systemPlanets.setSelected(slot);
}

/** 'Zoom to system': fly the map camera into the selected star. */
function zoomToSystem(): void {
  if (selectedSystem < 0) return;
  view.setSelectedPlanet(selectedSlot);
  view.enterSystem(selectedSystem);
}

/** Select a ship everywhere (map highlight, list row, reroute panel); -1 clears. */
function selectShip(entity: number): void {
  reroute.selectShip(entity);
  view.setSelectedShip(entity);
  shipList.setSelected(entity);
}

const reroute = createReroutePanel(rightCol, {
  onConfirm: (command) => sendCommand(command, 'reroute'),
  onRange: (radius, reachable) => view.setRange(radius, reachable),
  onPreview: (system) => view.setPreviewTarget(system),
  onOpenPlanet: (planet) => openPlanetAnywhere(planet),
  onClose: () => selectShip(-1),
});
const shipList = createShipList(rightCol, {
  onSelect: selectShip,
  onOpenPlanet: (planet) => openPlanetAnywhere(planet),
});
let selectedSystem = -1;
const systemPlanets = createSystemPlanetsPanel(rightCol, { onLand: (p) => enterPlanet(p) });
// Keep the Planets panel right under the System panel (hud created its panel first).
rightCol.insertBefore(rightCol.lastElementChild as Node, rightCol.children[1] ?? null);
// M5: colonies and research sit in the same column (hidden in the planet view like the others).
const colonyPanel = createColonyPanel(rightCol, {
  onCommand: (command) =>
    sendCommand(command, command.type === 'SetColonyStance' ? 'stance' : 'build'),
  onOpenColony: (planet) => openPlanetAnywhere(planet),
});
const techPanel = createTechPanel(rightCol, {
  onChoose: (command) => sendCommand(command, 'tech'),
});

// ---- Save, load, new game ----------------------------------------------------------------------
const storage = createIdbStorage();
const menuGate = createMenuGate();
const menu = createMenu(hud.bar, {
  onSave() {
    if (menuGate.busy || !haveSnapshot) return;
    const id = menuGate.begin(performance.now());
    menu.setBusy(true);
    menu.setStatus('Saving...');
    send({ kind: 'save', id, gen: generation });
  },
  onLoad() {
    if (menuGate.busy) return;
    const id = menuGate.begin(performance.now());
    menu.setBusy(true);
    menu.setStatus('Loading...');
    storage
      .get(SAVE_SLOT)
      .then((data) => {
        if (!menuGate.isActive(id)) return; // gave up waiting meanwhile
        if (data === null) {
          menuDone(id, 'There is no saved game yet.');
          return;
        }
        // The new generation is adopted only when the worker confirms the load.
        send({ kind: 'load', id, gen: ++genCounter, data });
      })
      .catch((err: unknown) =>
        menuDone(id, err instanceof Error ? err.message : 'The saved game could not be read.'),
      );
  },
  onNewGame: () => newGame(),
  onHelp: () => tutorial.toggle(),
  onExport() {
    if (menuGate.busy || !haveSnapshot) return;
    const id = menuGate.begin(performance.now());
    exportId = id;
    menu.setBusy(true);
    menu.setStatus('Preparing the save file...');
    send({ kind: 'save', id, gen: generation });
  },
  onImport(file) {
    if (menuGate.busy) return;
    const id = menuGate.begin(performance.now());
    menu.setBusy(true);
    menu.setStatus('Reading the file...');
    void readSaveFile(file).then((res) => {
      if (!menuGate.isActive(id)) return; // gave up waiting meanwhile
      if (!res.ok) {
        menuDone(id, `Import failed: ${res.error}`);
        return;
      }
      // Same path as Load: the worker replays the log and checks the state hash before it adopts it.
      menu.setStatus('Checking the save by replaying it...');
      importId = id;
      send({ kind: 'load', id, gen: ++genCounter, data: res.data });
    });
  },
  onSettings: (opener) => settingsPanel.open(opener),
});
/** Menu operation ids of an export and of an import under way (0 when none). */
let exportId = 0;
let importId = 0;

/** An operation finished: free the menu and show `text`. Ignored when `id` is no longer the active one. */
function menuDone(id: number, text: string): void {
  if (!menuGate.accept(id)) return;
  menu.setBusy(false);
  menu.setStatus(text);
}

/** Back to the galaxy view with nothing selected, for a new or a loaded game. */
function resetViews(): void {
  if (session.mode === 'planet') leavePlanet();
  disposePlanetView();
  view.exitSystem(true);
  hud.setZoomState(false);
  pickPlanetSlot(-1);
  selectShip(-1);
  selectedSystem = -1;
  hud.setSelected(-1);
  view.setSelected(-1);
  mission.setSystem(-1);
  // Controls waiting for a reply from the old world get released; the replies will be dropped.
  for (const c of tracker.drain()) settle(c.kind, false, 'NO_REPLY');
  hud.setStatus('');
  colonyPanel.reset();
  techPanel.reset();
  tutorial.reset();
  eventDetector.reset();
  announcer.clear();
  menu.cancelConfirm();
  syncSpeed = true;
  autoPause.reset();
}

/** A new game with a fresh seed. The seed is chosen here, on the main thread, never in the sim. */
function newGame(): void {
  if (menuGate.busy) return; // a save or load is under way: do not replace the world under it
  generation = ++genCounter;
  resetViews();
  haveSnapshot = false;
  menu.setStatus('');
  send({ kind: 'init', seed: (Date.now() >>> 0) % 1_000_000_007, gen: generation });
}

// Guided first launch (M7c): coach-marks that follow what the player does; Help reopens them.
const tutorial = createTutorialPanel(hudRoot, {
  getView: () => ({
    starSelected: selectedSystem >= 0,
    planet: session.mode === 'planet' ? session.planet : -1,
  }),
  onOpenChange: (open) => menu.setHelpOpen(open),
  // Skip or Done saves "do not show the guide at the start", so a reload keeps it closed.
  onDismiss: () => settings.set({ showTutorial: false }),
});

// ---- Planet view (view switch) -------------------------------------------------------------
const session = createPlanetSession();
const planetCtx = createPlanetContext();
let planetUi: PlanetUi | null = null;
let planetCanvas: HTMLCanvasElement | null = null;
let planetView: PlanetView | null = null;
let planetToken = 0;

function refreshPlanet(): void {
  if (session.mode !== 'planet' || !haveSnapshot) return;
  fillPlanetContext(mirror, session.planet, session.ship, planetCtx);
  planetView?.sync(mirror, session.planet);
  planetView?.setSelected(session.region);
  planetView?.setSecond(session.region2);
  planetUi?.update(mirror, session, planetCtx);
}

function enterPlanet(planet: number): void {
  if (!haveSnapshot || !openPlanet(session, mirror, planet)) return;
  disposePlanetView(); // a view still fading out from the last visit
  const token = ++planetToken;
  hudRoot.classList.add('planet-mode');
  // The map camera flies into the planet's system while the planet map fades in over it (M6c). The
  // galaxy canvas stays on until the fade is done (onEntered below), so there is no hard cut.
  const system = mirror.planetSystem[planet];
  pickPlanetSlot(planet - mirror.systemPlanetStart[system]);
  view.enterSystem(system);
  view.setPulsesFrozen(true); // no marker pulses under the planet map (D-127)
  planetCanvas = document.createElement('canvas');
  planetCanvas.style.opacity = '0';
  planetCanvas.id = 'planet';
  planetCanvas.tabIndex = 0;
  planetCanvas.setAttribute('aria-label', 'Planet map. Arrow keys rotate, plus and minus zoom.');
  document.body.insertBefore(planetCanvas, hudRoot);
  planetUi = createPlanetUi(hudRoot, {
    onBack: leavePlanet,
    onSelectRegion: (r) => {
      selectRegion(session, mirror, r);
      refreshPlanet();
    },
    onSessionChanged: refreshPlanet,
    onPickShip: (entity) => {
      pickShip(session, mirror, entity);
      refreshPlanet();
    },
    onCommand: (command, kind) => sendCommand(command, kind),
  });
  refreshPlanet();
  planetUi.focusBack();
  const canvasNow = planetCanvas;
  // Loaded on first use so the galaxy view starts without the planet renderer code.
  import('./render/planetView')
    .then((m) => {
      if (token !== planetToken || planetCanvas !== canvasNow) return;
      planetView = m.createPlanetView(canvasNow, {
        onSelectRegion: (r) => {
          selectRegion(session, mirror, r);
          refreshPlanet();
        },
        onHoverRegion: (r, sx, sy) => planetUi?.showTooltip(mirror, session.planet, r, sx, sy),
        onEntered: () => {
          if (token === planetToken) view.setActive(false);
        },
      });
      planetView.setQuality(settings.get().quality);
      refreshPlanet();
    })
    .catch((err: unknown) => {
      // The map could not load; the panels still work and Back / Escape leave the planet view.
      if (token !== planetToken) return;
      planetView = null;
      const why = err instanceof Error ? err.message : String(err);
      errorLog.add('error', `The planet map could not be loaded: ${why}`, '', Date.now());
      banner.show(`The planet map could not be loaded (${why}). Use Back to return to the galaxy.`);
    });
}

/** Free the planet renderer and its canvas at once (no leaks). */
function disposePlanetView(): void {
  planetToken++;
  planetView?.dispose();
  planetView = null;
  planetCanvas?.remove();
  planetCanvas = null;
}

/**
 * Leave the planet view: the panels go at once, the map dollies out and fades over the system view,
 * which flies back out to the galaxy; the renderer is freed when the fade is done (M6c).
 */
function leavePlanet(): void {
  planetToken++;
  closePlanet(session);
  planetUi?.dispose();
  planetUi = null;
  hudRoot.classList.remove('planet-mode');
  view.setPulsesFrozen(false);
  view.setActive(true);
  if (haveSnapshot) view.sync(mirror);
  view.exitSystem();
  const leaving = planetView;
  if (leaving) {
    leaving.beginExit(() => {
      if (planetView === leaving) disposePlanetView();
    });
  } else disposePlanetView();
}
const eventCard = createEventCard(hudRoot, {
  onChoose: (command) => sendCommand(command, 'event'),
});
const endScreen = createEndScreen(hudRoot, { onRestart: newGame });

/** Make star `index` the selected star everywhere (map, System panel, Mission Command, Planets panel). */
function selectStar(index: number): void {
  if (index < 0) selectShip(-1);
  mission.setSystem(index);
  pickPlanetSlot(index >= 0 ? 0 : -1); // a new star starts on its first planet, like the dropdown
  view.setSelected(index);
  selectedSystem = index;
  hud.setSelected(index);
  if (haveSnapshot) {
    hud.update(mirror);
    // A paused game sends no snapshot: refresh the Planets rows right now, not at the next one.
    systemPlanets.update(mirror, index);
  }
}

/**
 * Open the planet view for `planet` from anywhere (reroute panel, ship list, Colonies panel, a
 * click in the system view): select its star, fly the map into the system and fade the hex world in.
 */
function openPlanetAnywhere(planet: number): void {
  if (!haveSnapshot || session.mode === 'planet') return;
  if (!canLand(mirror, planet)) {
    menu.setStatus(NOTHING_TO_OPEN_TEXT);
    return;
  }
  const system = mirror.planetSystem[planet];
  if (system !== selectedSystem) {
    if (reroute.selectedShip() < 0) selectStar(system);
    else {
      view.setSelected(system);
      selectedSystem = system;
      hud.setSelected(system);
    }
  }
  enterPlanet(planet);
}

/** A star was chosen by a click or by the keyboard (arrow keys on the map). */
function onStarSelected(index: number): void {
  if (index >= 0 && reroute.selectedShip() >= 0) {
    // With a ship selected a star click picks a reroute target; Mission Command keeps its own.
    reroute.pickSystem(index);
    view.setSelected(index);
    selectedSystem = index;
    hud.setSelected(index);
    if (haveSnapshot) {
      hud.update(mirror);
      systemPlanets.update(mirror, index);
    }
  } else selectStar(index);
}

const view = createGalaxyView(canvas, {
  onSelect: onStarSelected,
  onActivateSystem(index) {
    // Double-click on a star: the first click selected it; now fly into it.
    if (index === selectedSystem) zoomToSystem();
  },
  onActivatePlanet(slot) {
    // Double-click on a planet that the single click could not open: say why nothing happened.
    const sys = view.focusedSystem();
    if (!haveSnapshot || sys < 0) return;
    const planet = mirror.systemPlanetStart[sys] + slot;
    if (planetClickAction(mirror, planet, true) === 'none') menu.setStatus(NOTHING_TO_OPEN_TEXT);
  },
  onSelectShip: selectShip,
  onSelectPlanet: pickPlanetSlot2,
  onSystemZoom: (entering) => hud.setZoomState(entering),
});

// Keyboard on the map (M8): arrow keys choose the next or previous star, Enter flies into it.
canvas.tabIndex = 0;
canvas.setAttribute('role', 'application');
canvas.setAttribute('aria-roledescription', 'galaxy map');
canvas.setAttribute(
  'aria-label',
  'Galaxy map. Left and right arrow keys choose a star, Enter flies into its system, Escape flies back out.',
);
const onMapKey = (e: KeyboardEvent): void => {
  if (e.ctrlKey || e.metaKey || e.altKey || !haveSnapshot || session.mode !== 'galaxy') return;
  const count = mirror.meta[META_SYSTEM_COUNT];
  let to = -1;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = nextSystem(selectedSystem, count, 1);
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = nextSystem(selectedSystem, count, -1);
  else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    zoomToSystem();
    return;
  } else return;
  e.preventDefault();
  if (view.inSystem()) return; // in a system the planets are chosen in the Planets panel
  onStarSelected(to);
  announcer.say(
    systemAnnouncement(
      to,
      STAR_NAMES[mirror.starType[to]] ?? 'Unknown star',
      mirror.planetCount[to],
      mirror.meta[META_HOME_SYSTEM] === to,
    ),
  );
  announcer.flush();
};
canvas.addEventListener('keydown', onMapKey);
// Arrow keys inside the lists and button groups of the panels (D-143).
const unbindNavs = [
  bindArrowNav(hudRoot, '.sl-row', 'vertical', '.sl-panel'),
  bindArrowNav(hudRoot, '.col-site', 'vertical', '.col-body'),
  bindArrowNav(hudRoot, 'button', 'horizontal', '.col-tabs'),
  bindArrowNav(hudRoot, 'button', 'horizontal', '.hud-speeds'),
  bindArrowNav(hudRoot, 'button', 'horizontal', '.mc-seg'),
  bindArrowNav(hudRoot, '.ec-choice', 'vertical', '.ec-card'),
  bindArrowNav(hudRoot, '.pv-item', 'vertical', '.pv-list'),
];

// Settings (M8): the dialog, and one function that applies every setting to the running game.
const settingsPanel = createSettingsPanel(hudRoot, {
  store: settings,
  errorLog,
  onShowGuide: () => {
    if (!tutorial.isOpen()) tutorial.toggle();
  },
});
let lastShowTutorial: boolean | null = null;
function applySettings(s: Readonly<Settings>): void {
  applyAppearance(document.documentElement, rootAppearance(s));
  audio.apply(s);
  setMotionOverride(s.motion);
  view.setReducedMotion(reducedMotion());
  view.setQuality(s.quality);
  planetView?.setQuality(s.quality);
  if (s.showTutorial !== lastShowTutorial) {
    lastShowTutorial = s.showTutorial;
    tutorial.setAutoStart(s.showTutorial);
  }
}
const unsubSettings = settings.subscribe(applySettings);
applySettings(settings.get());

/** A planet was clicked on the system map: it becomes the Mission Command destination. */
function pickPlanetSlot2(slot: number): void {
  pickPlanetSlot(slot);
  mission.setPlanet(slot);
  // A planet with a colony, a parked ship or an expedition opens the hex world straight away (M7c).
  const sys = view.focusedSystem();
  if (haveSnapshot && sys >= 0 && session.mode === 'galaxy') {
    const planet = mirror.systemPlanetStart[sys] + slot;
    if (planetClickAction(mirror, planet, false) === 'open') openPlanetAnywhere(planet);
  }
}

worker.onmessage = (e: MessageEvent<FromWorker>) => {
  const msg = e.data;
  if (msg.kind === 'snapshot') {
    copySnapshotInto(msg.snapshot, mirror);
    haveSnapshot = true;
    if (syncSpeed) {
      syncSpeed = false;
      autoPause.reset(mirror.meta[META_SPEED] as GameSpeed);
    }
    send({ kind: 'returnBuffers', snapshot: msg.snapshot }, snapshotBuffers(msg.snapshot));
    if (session.mode === 'galaxy') view.sync(mirror);
    hud.update(mirror);
    systemPlanets.update(mirror, selectedSystem);
    if (session.mode === 'planet') {
      if (reconcile(session, mirror) === 'closed') leavePlanet();
      else refreshPlanet();
    }
    mission.update(mirror);
    shipList.update(mirror);
    reroute.update(mirror);
    eventCard.update(mirror);
    colonyPanel.update(mirror);
    techPanel.update(mirror);
    endScreen.update(mirror);
    tutorial.update(mirror);
    // Important events: said to screen readers once per snapshot and played as sound cues (M8).
    readGameFacts(mirror, gameFacts);
    eventDetector.update(gameFacts, onGameEvent);
    announcer.flush();
    overlay?.setWorkerTickMs(mirror.meta[META_TICK_MS]);
    overlay?.setStateHash(mirror.meta[META_STATE_HASH]);
  } else if (msg.kind === 'saved') {
    if (msg.gen !== generation || !menuGate.isActive(msg.id)) return; // stale or too late
    if (!msg.ok) {
      if (msg.id === exportId) exportId = 0;
      menuDone(msg.id, msg.error);
      return;
    }
    const day = msg.data.day;
    const id = msg.id;
    if (id === exportId) {
      // Export: hand the same save data to the browser as a file instead of IndexedDB.
      exportId = 0;
      try {
        const name = saveFileName(msg.data);
        downloadTextFile(name, exportSaveText(msg.data));
        menuDone(id, `Save exported as ${name} (day ${day}).`);
      } catch {
        menuDone(id, 'The save file could not be created in this browser.');
      }
      return;
    }
    storage
      .put(SAVE_SLOT, msg.data)
      .then(() => {
        const why = storage.fallbackReason();
        menuDone(
          id,
          why === ''
            ? `Game saved on day ${day}.`
            : `Game saved on day ${day}, but only in memory until you close this page (${why})`,
        );
      })
      .catch(() => menuDone(id, 'The game could not be saved in this browser.'));
  } else if (msg.kind === 'loadResult') {
    if (msg.ok) {
      // Adopt the loaded world even when the menu already gave up waiting: the worker did switch.
      if (msg.gen <= generation) return;
      generation = msg.gen;
      resetViews();
      if (menuGate.accept(msg.id)) menu.setBusy(false);
      if (msg.id === importId) {
        importId = 0;
        menu.setStatus('Save imported. Press Save game to keep it in this browser.');
      } else menu.setStatus('Game loaded.');
    } else {
      const wasImport = msg.id === importId;
      if (wasImport) importId = 0;
      menuDone(msg.id, `${wasImport ? 'Import' : 'Load'} failed: ${msg.error}`);
    }
  } else if (msg.kind === 'error') {
    workerFailed(msg.message);
  } else {
    if (msg.gen !== generation) return; // a reply for a world that is gone
    settle(tracker.take(msg.id), msg.result.ok, msg.result.ok ? '' : msg.result.reason);
  }
};

/** A reply arrived (or was given up on): unlock the matching control and show the text. */
function settle(kind: CommandKind, ok: boolean, reason: string): void {
  const text = ok ? '' : reason === 'NO_REPLY' ? NO_REPLY_TEXT : describeRejectFor(kind, reason);
  if (kind === 'launch' && ok) audio.play('launch');
  if (kind === 'launch') mission.commandSettled();
  else if (kind === 'reroute') reroute.commandReply(ok, text);
  else if (kind === 'event') eventCard.commandReply(ok, text);
  else if (kind === 'stance' || kind === 'build') colonyPanel.commandReply(ok, text);
  else if (kind === 'tech') techPanel.commandReply(ok, text);
  else if (kind === 'form' || kind === 'explore' || kind === 'found' || kind === 'embark')
    planetUi?.commandReply(kind, ok, text);
  // Reroute and card refusals show in their own panel; launch and speed use the HUD bar.
  if (kind === 'launch' || kind === 'speed') hud.setStatus(text);
}

/** The worker died or cannot be understood: say so and give every waiting control back. */
function workerFailed(text: string): void {
  errorLog.add('worker', text, '', Date.now());
  banner.show(text);
  for (const c of tracker.drain()) settle(c.kind, false, 'NO_REPLY');
}
worker.onerror = (e) =>
  workerFailed(`The simulation stopped: ${e.message || 'unknown error'}. Reload the page.`);
worker.onmessageerror = () =>
  workerFailed('The simulation sent a message the page could not read. Reload the page.');

// Replies that never come (a lost message) must not leave a button disabled for ever.
const replyWatch = setInterval(() => {
  const now = performance.now();
  for (const c of tracker.expire(now)) settle(c.kind, false, 'NO_REPLY');
  if (menuGate.expire(now)) {
    menu.setBusy(false);
    menu.setStatus('The game did not answer in time. Try again.');
  }
}, 1000);

send({ kind: 'init', seed: parseSeed(location.search), gen: generation });

const onVisibility = (): void => {
  audio.setHidden(document.hidden);
  if (document.hidden) autoPause.hidden();
  else autoPause.shown();
};
document.addEventListener('visibilitychange', onVisibility);

// Escape clears the ship selection (the event card has no Escape: it must be answered).
const onEscape = (e: KeyboardEvent): void => {
  if (e.key !== 'Escape' || eventCard.isOpen() || endScreen.isOpen() || settingsPanel.isOpen())
    return;
  if (session.mode === 'planet') {
    // Escape first cancels an armed confirmation, and only then leaves the planet view.
    if (!planetUi?.cancelArmed()) leavePlanet();
  } else if (view.inSystem()) view.exitSystem();
  else if (reroute.selectedShip() >= 0) selectShip(-1);
};
document.addEventListener('keydown', onEscape);

let frameId = 0;
function loop(now: number): void {
  if (document.hidden) {
    // Nothing is drawn for a hidden tab (D-127); keep the loop alive for when it returns.
    frameId = requestAnimationFrame(loop);
    return;
  }
  overlay?.frame(now);
  planetView?.frame(now); // also draws the fade-out after Back
  view.frame(now); // draws nothing while hidden behind the planet map
  frameId = requestAnimationFrame(loop);
}
frameId = requestAnimationFrame(loop);

/** Single teardown: stop loops and timers, remove document listeners, dispose every panel. */
export function teardown(): void {
  cancelAnimationFrame(frameId);
  clearInterval(replyWatch);
  document.removeEventListener('visibilitychange', onVisibility);
  document.removeEventListener('keydown', onEscape);
  worker.terminate();
  canvas.removeEventListener('keydown', onMapKey);
  for (const unbind of unbindNavs) unbind();
  unsubSettings();
  settingsPanel.dispose();
  document.removeEventListener('click', onClickCue, true);
  for (const t of GESTURES) document.removeEventListener(t, unlockAudio, true);
  audio.dispose();
  live.dispose();
  removeErrorCapture();
  disposePlanetView();
  planetUi?.dispose();
  systemPlanets.dispose();
  eventCard.dispose();
  endScreen.dispose();
  colonyPanel.dispose();
  techPanel.dispose();
  menu.dispose();
  tutorial.dispose();
  reroute.dispose();
  shipList.dispose();
  mission.dispose();
  hud.dispose();
  banner.dispose();
  rightCol.remove();
  view.dispose();
}
