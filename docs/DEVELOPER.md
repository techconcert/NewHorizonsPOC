# Colony Ship

A browser strategy game in the spirit of "Oregon Trail in space". You are a mission director: you
launch colony ships, answer event cards on the way, and found colonies on procedurally generated
planets. You never control individual units. Design: `docs/GAME_DESIGN.md`.

Stack: TypeScript (strict), Vite, Three.js (WebGL2), bitecs, Vitest. The simulation runs in a Web
Worker; saves go to IndexedDB. No server, no network calls, no analytics.

## Run it (development)

```
npm run dev
```

Starts the Vite dev server on the first free port from 5273 and prints the link, for example
`http://localhost:5273/`. Add `?debug` for the frame overlay (fps, frame ms, p50 and p95 of the last
240 frames, worker tick, state hash), `?seed=123` for a fixed galaxy, and `?fx=...` for render
flags (see `docs/WORKFLOW.md`).

## Build and preview

```
npm run build      # type check, then the production build into dist/
npm run preview    # serves dist/ locally to try the production build
npm run ci         # typecheck, lint, dependency rules, tests, build
```

The build uses relative URLs (`base: './'`) and writes no source maps, so the contents of `dist/`
work from the root of a site or from any sub-folder.

## Host it as a static site

`dist/` is plain static files: `index.html` plus `assets/` (scripts, the simulation worker and the
stylesheet). Any static host works; there is nothing to configure on the server.

- **Any static host** (Netlify, Cloudflare Pages, S3 + CDN, nginx, Apache): upload the contents of
  `dist/`. No rewrite rules are needed because the game is one page.
- **GitHub Pages**: publish the contents of `dist/` to the `gh-pages` branch (or point Pages at a
  folder or a workflow artifact). The game works from `https://<user>.github.io/<repo>/` because
  every URL is relative. Pages serves JavaScript with the right MIME type, which module workers need.
- **Opening `dist/index.html` from disk (`file://`)** does not work in most browsers: module workers
  and IndexedDB are blocked there. Use `npm run preview` or any local static server instead.
- Serve over HTTPS where you can (browsers treat IndexedDB and audio more strictly on plain HTTP
  outside localhost).

## Controls

Mouse and keyboard; every part of the interface can be reached with the keyboard.

| Where | Keys |
| --- | --- |
| Anywhere | Tab and Shift+Tab move between controls; the first Tab stop is "Skip to the game map"; Escape closes the open dialog, menu, planet view or system view |
| Galaxy map (focus it with Tab) | Left/Right (or Up/Down) choose the next or previous star, Enter flies into its system, Escape flies back out; mouse: click a star, drag to pan, wheel to zoom, double-click a star to enter it |
| Lists and button groups | Up/Down (or Left/Right in a row of buttons), Home and End move between items: ships, colony sites, regions, speed buttons, hull and speed choices, event card choices |
| Event card | 1, 2 or 3 pick a choice (or arrow keys then Enter) |
| Planet view | Arrow keys rotate, + and - zoom, the Regions list picks a region, Escape or "Back to galaxy" leaves |
| Top bar | Pause, 1x, 2x, 4x; "Save game", "Load game", and "Menu" (New game, Export save, Import save, Help, Settings) |

Settings (Menu, then Settings): sound (master, music and effects volume, mute), theme (dark or
light), text size (90 to 150%), reduced motion, a colour-blind-safe palette, render quality
(automatic, low, high), the guide, and Diagnostics (a local log of the last 50 errors with a Copy
button; it never leaves your browser). Settings are kept in the browser's local storage; the game
itself is never stored there.

Save files: "Save game" keeps one save in the browser (IndexedDB). "Export save" downloads the game
as a `.json` file; "Import save" loads such a file after checking it (the game replays the saved
commands and compares the result with the saved state, so an edited or foreign file is refused with
a message).

## Known limits

- One manual save slot in the browser, plus exported files. A save is a replay (seed plus command
  log), so it only loads in a build with the same rules version; after a game update an old save is
  refused with a message and can no longer be played.
- Sound is synthesised in the browser (no audio files). Browsers start audio only after your first
  click or key press; it stops while the tab is hidden, and the game pauses itself then too.
- The galaxy map has keyboard star selection but no keyboard pan or zoom; the planet view can be
  rotated and zoomed from the keyboard.
- The "Allow motion" setting cannot override a system-wide reduce-motion request for the small
  CSS animations (it does for the maps); the system-view planet pulses follow the setting at the
  next page load.
- WebGL2 is required. On software rendering (no GPU) the game starts at half resolution and may be
  slow; choose Low in Settings if frames drop.
- A browser tab that stays in the background does not advance the game (auto-pause).
- Not tested here: real-device frame budgets, screen reader behaviour in every browser, and
  mobile or touch layouts below 640 px wide.
