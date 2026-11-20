# StellarHub UI contract

How to write a module or a Home view without breaking the rest. Everything hangs off `window.SH` (see `ui/js/core.js`).

## Files

| Piece | JS | CSS |
|---|---|---|
| Module `<id>` | `ui/js/modules/<id>.js` | `ui/css/modules/<id>.css` (everything prefixed with `#v-<id>`) |
| Home view `<id>` | `ui/js/home/<id>.js` | `ui/css/home/<id>.css` (everything prefixed with `.hv-<id>`) |

They are already linked in `index.html`. No external resources: everything is local (three.js lives in `ui/vendor/three.module.min.js`).

## Modules

The master list (name, icon, description, tabs) is in `SH.MODS` (core.js). The shell creates the view, the header, the tab bar with its indicator and one `.tab` container per tab. The module only fills them in:

```js
SH.module({
  id: 'drivers',
  actions(el, ctx) { /* header buttons, to the right of the title */ },
  renderTab(tabId, el, ctx) { /* called ONCE, the first time the tab opens */ },
  enterTab(tabId, el, ctx) { /* every time it is shown */ },
  leaveTab(tabId, el) {},
  enter() {}, leave() {},
});
```

`ctx`: `go(id, {tab})`, `setTab(id)`, `tabEl(id)`, `setBadge(tabId, n)` (number on the tab), `el()` (the section).

- `.tab` is `position:absolute; inset:0; overflow:auto`. For a full-screen layout with its own internal scrolling, add the `fill` class to the tab's `el`.
- Anything marked `data-asm` inside a tab staggers in the first time (the shell does it).
- Per-frame loops: `SH.tickers.add((dt, t) => { if (SH.state.view !== 'drivers') return; ... })`.
- Live data: `SH.tele.v` (values), `SH.tele.hist[key]` (120 values), `SH.tele.on(fn)`.
- Before anything that needs administrator rights: `if (!SH.requireAdmin('to install drivers.')) return;` (suggests without nagging).
- Confirmations: `SH.toast('Done', { action: { label: 'Undo', run } })`. No `alert`/`confirm`.
- Palette actions: `SH.actions.add([{ t: 'Text', go: 'drivers', tab: 'backup', ic: 'download' }])`.
- Icons: `SH.ic('name')`; add new ones with `SH.icons.add({ name: '<path d="..."/>' })` (24×24 stroke, no fill).

## Shared pieces (base.css)

`.pan` (frame), `.btn` (`pri`, `sec`, `ghost`, `danger`, `sm`, `lg`), `.seg` + `.ind` (move it with `SH.placeSeg(seg)`), `.toggle`, `.check`, `.chip` (`ok`, `warn`, `bad`, `acc`), `.field`, `.bar>span` (with `transform: scaleX()`), `.rows/.row/.ri/.rt`, `.tbl-head`, `.empty`, `.sk` (skeleton), `.big`, `.muted`, `.faint`.

Tokens: `--void --deep --raise --raise2 --raise3 --line --line2 --ink --mute --faint --accent --accent2 --on-accent --ok --warn --bad --display --text --r-l --r-m --r-s --f` (multiply CSS durations by `var(--f)`).

## Animation

- `SH.anim(el, keyframes, { d, delay, e })` (WAAPI with the intensity applied; interrupts the previous one). `SH.EASE.out | io | spring | soft | snappy`.
- `SH.Spring(v, k, c)` with `.t` (target), `.step(dt)`, `.set(v)`. Interruptible by nature.
- Only `transform`, `opacity`, `filter`, `clip-path`, `stroke-dashoffset`. Quick ones: 83/167/250 ms; large ones ≤ 500 ms. Never `ease-in` on entry.
- Respect the intensity (`max`, `normal`, `min`): at `min`, nothing loops. Read it with `SH.effInt()`, never `SH.state.settings.intensity` (see "Lighter effects on battery"); `SH.motion()` already applies it.

## Lighter effects on battery

On battery, with "Lighter effects on battery" on (setting `batterySaver`, default on), the interface does less work. `js/telemetry.js` decides it (desktops, which report no charge state, are never on battery) and sets:

- `SH.state.lite` (boolean) and `html[data-lite="1"]` (`"0"` otherwise) for CSS. `SH.power.onBattery` says whether the PC is on battery at all; `SH.power.set(true | false | null)` forces it in tests.
- `SH.on('power', ({ lite, onBattery }) => {})`: fires only when `lite` changes. Rebuild or stop whatever depends on it (the shell, the starfield and the 3D view already do).
- `SH.effInt()`: the intensity the animations must use. It is the user's choice (`SH.state.settings.intensity`, which stays untouched in the settings) one step lower while `lite` (`max` becomes `normal`). Use it for every question about animation strength (`SH.effInt() === 'min'`, `SH.motion()`, `--f`); read `state.settings.intensity` only to show or save the setting itself.
- CSS: put the cheaper version under `html[data-lite="1"]`: no `backdrop-filter`, no big blurs or masks, no looping decoration (see the block in `base.css`). The telemetry rate drops to one sample every 2 s and the engine skips its slow extras.
- Per-frame loops check `SH.state.lite` (or `SH.effInt() === 'min'`) and stop; a hidden window (tray) already pauses every loop and uses no GPU.

## Controller navigation

`js/gamepad.js` + `css/gamepad.css` let the whole app be used with a gamepad (standard mapping: Xbox-style pads, handhelds such as the ROG Ally). It polls with `requestAnimationFrame` only while a controller is connected, the window is visible and focused, and Settings > General > "Controller navigation" (`gamepadNav`, default on) is on; otherwise nothing runs. Modules need no code for it: buttons, links, tabs, inputs, `[role=button]`... are found by themselves and the ring moves between them with spatial navigation. Use real `<button>`s, give clickable `div`s `tabindex="0"` and a role, and keep the focus order sensible.

| Button | Action |
|---|---|
| D-pad / left stick | Move the focus (the ring follows it) |
| A | Select (click) |
| B | Back: closes the dialog on top, else goes back / Home |
| LB / RB | Previous / next tab (settings section inside Settings) |
| LT / RT | Previous / next module |
| Y | Search (palette) |
| Menu | Settings |
| View | Home |
| Right stick | Scrolls the area under the focus |

- `html.pad-mode` is on while a controller is in use; a mouse move, a touch or a key press turns it off. The ring (`#padRing`) and the hint bar (`#padHints`) exist only then. While the hint bar is up, `html.pad-hints` raises `--dockspace` so it never covers content; the page gets a `resize` event when it comes and goes, so views that measure themselves must re-fit on `resize`.
- `SH.gamepad`: `enabled()`, `active` (controller mode is on), `connected` (list of pads), `focus(el)`, `move(dir)`, `onButton(fn)` (every press: `{ index, name, pad }`; returns the unsubscribe), `capture({ onExit, onProgress })` / `release()` / `captured` (a test that needs the raw buttons, such as Device Tester > Controller; the user gets the navigation back by holding View + Menu for a second), `addOverlay(selector)` (a custom dialog the focus must stay inside), `glyph(name)` and `BUTTONS`.
- `SH.modal`: whichever dialog is on top (palette, settings, component sheet, update dialog, confirmations and `.mdlg` / `.hg-dlg` / `.bk-dq-o` / `.dq-o` dialogs inside a module) gets a focus trap: the rest of the app becomes `inert`, Tab and the D-pad stay inside, and the focus goes back to what opened it when it closes. This works for keyboard users too. A new dialog class must be added to `MODALS` in gamepad.js (or registered with `SH.gamepad.addOverlay`), and should carry `role="dialog"` and `aria-modal="true"`. `SH.modal.open` is the current dialog, `SH.modal.sync()` re-checks after you open or close one without a class change.
- Animations of the ring use `transform` only and run only while it is visible; at intensity `min` nothing loops.

## Settings safety

`SH.loadSettings()` never trusts the saved file: every key with a default keeps the default's type (numbers inside their range, `intensity` one of the three values) and the lists and maps the modules store (`activity`, `autopilotRoutines`, `hangarKits`, `pending`, `updIgnored`...) must have their shape; anything else falls back to the default (or is dropped) key by key. A new setting that is a list, a map or a number with limits goes in `DEFAULTS` (or `SHAPE` / `RANGE` in core.js).

## Home views

```js
SH.homeVariant({
  id: 'xray', name: 'X-ray', short: 'X-ray', desc: 'One line',
  mount(el, ctx) { /* draws inside el (it fills the central stage). ctx.intro=true: play your entrance */ },
  unmount() { /* remove tickers and listeners */ },
  resize() {}, onReturn() { /* when coming back to Home from a module */ },
});
```

`ctx`: `PC` (model and `components` with id, name, title, rows, bar; it is refreshed in the background every 30 minutes, see below), `tele`, `openComponent(id)` (opens Live Monitor on its tab), `motion()`.

## Real engine (Python)

Each module has `stellarhub/engine/<id>.py` with `EXPORTS` (quick calls) and `JOBS` (long tasks that receive `job`).

```js
const list = await SH.engine('drivers', 'list');                  // undefined outside the app: use sample data
const r = await SH.job('drivers', 'search', [], { onProgress: m => {/* m.pct, m.text, m.data */}, onLog: lines => {} });
// the promise has .cancel()
SH.setPending('drivers', 4);   // feeds "To review" on Home (keys: drivers, apps, junk)
SH.logActivity('Drivers updated', { sub: '2 installed', ic: 'drivers', go: 'drivers', tab: 'history' });
```

- Infrastructure: `engine/jobs.py` (progress, live log, cancel), `engine/ps.py` (PowerShell and consoles in UTF-8, with live output), `engine/telemetry.py` (real telemetry → `SH.tele.push`), `engine/system.py` (PC data, health, displays and screenshots), `engine/removal/` (engine inherited from MiniRevo: programs, icons, leftovers, quarantine, cleanup, startup).
- `system.pc_info()` answers at once with the last measurement; when it is older than 30 minutes (`STALE_AFTER`) it starts one background refresh (one at a time) and the next call has the new data. Home asks `system.pc_info_fresh` (in the engine's own thread, never blocking the UI) at start if the saved copy is old, when it is shown again and every 10 minutes while open, and updates the header facts and the components only if something changed.
- Whatever Windows does not provide arrives as `null`: the UI shows "—" (`SH.tele.has`, `SH.tele.fmt`).
- Anything destructive always gets: a confirmation in the UI, `SH.requireAdmin` if needed, a restore point or a backup first, and undo whenever possible.
- Performance: no layout reads (`offsetLeft`, `getBoundingClientRect`) in per-frame loops; long lists use `content-visibility:auto` or virtualization.
- Commands that run other programs (winget, installers) go through `updater._stream`, which ends when the command ends even if a process it started keeps the output pipe open (Foxit's update service did), and reports silence through `on_tick`.
- Start and exit: `stellarhub/splash.py` is the start screen (a Win32 layered window on its own thread). The main window is created off screen (WebView2 does not load a hidden window) and `Api._reveal` moves, maximizes and shows it when the UI calls `ui_ready`; `SH.enter()` / `SH.leave()` (core.js) fade the page in and out, and `Api.quit` waits for the fade. `STELLARHUB_NO_SPLASH=1` turns the start screen off.

- Start, handoffs and updates never leave the screen empty or silent (`app.py` main, `_take_over_running_copy`, `engine/selfupdate.py`, `packaging/StellarHub.iss`):
  - The start screen is the first thing `main()` does (before waiting for a previous copy, elevating or claiming the lock). A copy started by the administrator relaunch or the task says "Opening as administrator…"; a second copy that finds the lock taken says "Opening StellarHub…".
  - A second copy asks the running one to show itself and needs its `ok` reply (1.5 s). No answer: it keeps trying for the lock for ~12 s, gives a copy that still has its start screen up its time (up to ~2 min: staged update), then ends the stuck copy and takes over; if it can't (an administrator copy), it says so in a message box. Never a silent exit.
  - `--wait-pid` waits at most 10 s for the previous copy and then ends it. The old copy keeps its own start screen up until the new copy's is visible (`splash.other_showing`).
  - Updates: the updater shows the start screen ("Installing the update…") from the moment the app closes, runs Setup with `/SILENT` (its small progress window, kept topmost; nothing to answer) and exits when that window is up; Setup opens StellarHub itself when it finishes (or the previous version if it failed). The portable `--finish-update` shows the start screen until the updated app has its own. The installer's last step runs `--warm` (loads every DLL once) so Windows' first-run scan of the new files happens inside the progress window, not at the first start.
  - `[phase]` lines in `stellarhub.log` time each step of a start from the process creation; the log rotates above 2 MB and repeated lines are counted.
  - Tests and isolated copies set `STELLARHUB_NO_DIALOGS=1` (implied by `STELLARHUB_ISOLATED=1` and `STELLARHUB_UPDATE_DIR`): messages go to the log, never a modal box. `STELLARHUB_LOCK_ID` lets isolated copies share one lock (single-instance tests).
- StellarHub's own updates: `engine/selfupdate.py` (how it works is in its docstring) and `ui/js/selfupdate.js` (the dialog). Tests serve a fake GitHub with `STELLARHUB_UPDATE_URL` and `STELLARHUB_UPDATE_DIR`; `STELLARHUB_ISOLATED=1` copies never elevate or touch the user's startup entries.

## Testing

`index.html#drivers/all` opens a tab; `index.html#drivers/*` walks through all of them; `index.html#home=xray` forces a Home view. Script: `check_ui.sh "index.html#drivers/*"` (headless Edge, lists JS errors).

## Writing

English only. Sentence case (capitalize only the first word and proper names), clear verbs ("Uninstall" → "Uninstalled"). No ALL-CAPS labels, no filler "A · B · C", no "→" on buttons, no emojis, no purple gradients. Numbers and dates use the `en-US` locale.

## Text and translations

Every sentence the user reads is written in English and wrapped: `SH.t('Scan the disk')`, or with placeholders
`SH.t('{n} files', { n })`. Static text in HTML files uses `data-t` (text) and `data-t-attr="title aria-label"`
(attributes). Engine code that produces visible text uses `tr()` from `stellarhub/i18n.py`. The dictionaries, the
rules and the glossary are in [`stellarhub/ui/i18n/`](../stellarhub/ui/i18n/README.md). Never compare displayed text
in code, and format numbers with `SH.fmt1` / `SH.fmtInt`, which follow the interface language.
