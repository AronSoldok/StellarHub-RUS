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

- A tab can be hidden by a condition: a third item in its `SH.MODS` entry, `['registry', 'Registry', () => !!SH.state.settings.registryCleaner]`, or `when` on a tab object a module declares itself. While it returns false there is no tab button (`hidden`), no palette entry and `#mod/tab`, `setTab` and `go(id, { tab })` ignore it; its panel is still built but never shown, and `*` walks only the visible tabs. The shell re-checks every condition when any setting changes (`SH.on('setting')`) and after import or reset, and moves off a tab that just went away. Palette actions (`SH.actions.add`) take the same `when`. Modules must not show or run anything for a hidden tab (no badges, no scans, no palette actions).
- `.tab` is `position:absolute; inset:0; overflow:auto`. For a full-screen layout with its own internal scrolling, add the `fill` class to the tab's `el`.
- Anything marked `data-asm` inside a tab staggers in the first time (the shell does it).
- Per-frame loops: `SH.tickers.add((dt, t) => { if (SH.state.view !== 'drivers') return; ... })`.
- Live data: `SH.tele.v` (values), `SH.tele.hist[key]` (120 values), `SH.tele.on(fn)`.
- Before anything that needs administrator rights: `if (!SH.requireAdmin('to install drivers.')) return;` (suggests without nagging).
- Confirmations: `SH.toast('Done', { action: { label: 'Undo', run } })`. No `alert`/`confirm`.
- Palette actions: `SH.actions.add([{ t: 'Text', go: 'drivers', tab: 'backup', ic: 'download' }])`.
- Icons: `SH.ic('name')`; add new ones with `SH.icons.add({ name: '<path d="..."/>' })` (24×24 stroke, no fill, no `stroke-width` of their own: the 1.4 px line comes from `svg.i`). Size them with the `--ic-*` tokens.

## Shared pieces (base.css)

`.pan` (frame), `.btn` (`pri`, `sec`, `ghost`, `danger`, `sm`, `lg`), `.seg` + `.ind` (move it with `SH.placeSeg(seg)`), `.toggle`, `.check`, `.chip` (`ok`, `warn`, `bad`, `acc`), `.field`, `.bar>span` (with `transform: scaleX()`), `.rows/.row/.ri/.rt`, `.tbl-head`, `.empty`, `.sk` (skeleton), `.big`, `.muted`, `.faint`.

- Empty states: always `SH.emptyState({ art, title, text, action, small, cls })` (returns HTML, `.empty.es`). `art` is `ok` (all done), `none` (nothing found), `first` (nothing yet / first use) or `error`. `action` renders one button: `{ label, id?, data?, go: 'module/tab', click: '#selector', icon?, pri? }`. `SH.emptyArt(art)` is the bare illustration for covers that keep their own layout. Never write a bare sentence in a blank panel.
- Canvas charts share `SH.chartKit` (grid, y/x labels, tooltip, cursor): `grid(x,L,R,T,B,n)`, `ticks(x,L,T,B,n,hi,lo,fmt)`, `xlabels(x,L,R,h,a,b)`, `tip(x,px,W,T,[[color,text],...])`, `cursor(x,px,T,B)`; reserve `chartKit.xpad` px under the plot for the x labels.
- Panels beside others hug their content (`align-self:start; max-height:100%`), grids use `repeat(auto-fit, minmax(...))`: no empty frames, no cell hanging in a corner.

Tokens: `--void --deep --raise --raise2 --raise3 --line --line2 --ink --mute --faint --accent --accent2 --on-accent --ok --warn --bad --display --text --r-l --r-m --r-s --r-xs --r-pill --sp-xs..--sp-xl --fs-cap..--fs-h1 --fs-n1..--fs-n4 --ic-xs..--ic-3xl --ic-w --f` (multiply CSS durations by `var(--f)`). Module CSS uses the tokens for radii, type sizes and icon sizes, never literals (the corner presets reach every module that way).

## Animation

- `SH.anim(el, keyframes, { d, delay, e })` (WAAPI with the intensity applied; interrupts the previous one). `SH.EASE.out | io | spring | soft | snappy`.
- `SH.Spring(v, k, c)` with `.t` (target), `.step(dt)`, `.set(v)`. Interruptible by nature.
- Only `transform`, `opacity`, `filter`, `clip-path`, `stroke-dashoffset`. Quick ones: 83/167/250 ms; large ones ≤ 500 ms. Never `ease-in` on entry.
- Respect the intensity (`max`, `normal`, `min`): at `min`, nothing loops. Read it with `SH.effInt()`, never `SH.state.settings.intensity` (see "Lighter effects on battery"); `SH.motion()` already applies it.

## Sounds

`SH.sound(event, opts)` (core.js) plays `ui/sounds/<event>.ogg`; the 35 events are the keys of `SOUND_EV`, each with
its group, gain trim, minimum gap and priority. `js/sounds.js` already gives every module, with no code: a click on
buttons, links, dock items and rows (pointer or controller A), `toggle_on/off` on `.toggle`, `tab_switch` on `.seg`
and `.subnav`, `panel_open/close` for the dialogs in gamepad.js's `MODALS`, `dropdown`, `hover`, `unavailable` on a
disabled button, `navigate`, `palette_open`, `toast` and the start/exit sounds. A module adds only what means
something specific:

- `SH.toast(text, { kind: 'success' | 'warning' | 'error' | 'unavailable' })` (no kind: a plain toast, which keeps
  quiet right after another sound); an Undo action carries `sound: 'undo'`.
- `SH.job(mod, fn, args, { sound: 'scan' })` for a scan the user started (scan_start, scan_complete, soft ticks at
  25/50/75 % when it runs long); `sound: 'task'` for another long user task (ticks only). Background refreshes pass
  nothing.
- `SH.sound('delete' | 'undo' | 'refresh' | 'copy' | 'achievement')` at that moment.

Rules: one sound per user action. Interface sounds need a click, key or controller press in the last 1.5 s, and the
first one within 100 ms wins, so a sound that belongs to a click must be played synchronously in the click handler
(before any `await`); if it can only come later, call `SH.sound.claim()` in the handler and play it when ready. A
notification (success, error, a finished scan) replaces a click that began in the last 100 ms. Nothing plays while
the window is hidden. Settings: `sounds`, `soundVolume`, `soundUi`, `soundAlerts`, `soundTasks`, `soundSystem`
(Settings > Sound); lighter effects and intensity `min` mute nothing.

## Long work (activities)

Anything long a module does (a scan, an analysis, a cleanup, a queue of installs, a test, a routine, a backup, and
also what starts by itself when a module or a tab opens) is an activity, so it can be followed from anywhere
(`SH.activity`, core.js):

```js
const h = SH.activity.start('storage', { key: 'scan', label: SH.t('Scanning {name}', { name }), go: { tab: 'map' } });
h.progress(.38);                 // 0..1, or null while it cannot be measured; a second argument replaces the status text
if (!h.end({ ok: true, summary: SH.t('{size} in {n} files', { size, n }) })) SH.toast(/* the module's own result */);
// h.end({ ok: false, error }) / h.end({ cancelled: true })
```

- While it runs and the user is elsewhere, the module's dock icon wears a thin ring (filled to the progress, a short
  arc in a slow orbit when there is none) and its tooltip says the status; Home's To review panel shows it as a live
  row; the palette's module row shows the percentage; the taskbar button shows the progress of every running activity
  together (indeterminate if any has none, red for a moment when one fails; `stellarhub/taskbar.py`).
- When it ends while the user is elsewhere, `end()` shows a toast with **View** (the window hidden in the tray or
  minimized gets a Windows notification instead, whose click opens the module), leaves a badge on the dock icon until
  the module is visited, and returns `true`: the module then skips its own result toast. Looking at the module, it
  returns `false` and says nothing (the module's own result UI answers). Cancelled: nothing at all.
- Several per module (`key`); the newest is shown. The same `key` while one is open returns that one.
- Exactly one sound: a toast after a sound played in the last 0.7 s (the job's `scan_complete`) stays silent. `kind`
  sets the toast's kind (`'achievement'`, `'warning'`); `toast: false` keeps the badge and the notification but leaves
  the toast to the module (Autopilot's own has View the log).
- Work that starts by itself (Storage's scan on opening the Map, Program Updater's searches, Super Optimizer's first
  analysis, Privacy's first check, a list read on opening a tab) passes `bg: true`: it is followed exactly the same
  way, but only once it has run for 1.5 s (`grace`), so a quick refresh never flashes a ring and ends without a word.
  It plays no start or end sound of its own (the toast when it ends elsewhere does). The user starting the same `key`
  while it runs makes it theirs at once. A refresh the user never needs to hear about (the light check at start-up,
  the list read again after an install) opens nothing; `user: false` is never shown.
- `SH.activity.follow(mod, promise, { key, label, go, summary: v => text })` follows a promise as a `bg` activity and
  returns it (rejected: it failed; an error with `cancelled: true`: nothing).
- `SH.job(..., { sound: 'scan' | 'task' })` opens one by itself (its progress and text, a generic summary) unless the
  module already has one open; `{ bg: true, label }` does the same for a job without a sound (work the module started
  by itself, or a secondary step); `{ activity: h }` sends a job's progress to the module's own, `{ activity: false }`
  opts out.

## Lighter effects

The interface does less work when "Lighter effects" (setting `lightMode`) says so: `'auto'` (default: on battery, or when the page renders on an integrated GPU), `'always'` or `'never'`. The old boolean `batterySaver: false` maps to `'never'` (core.js does it when `lightMode` was never saved; `batterySaver` itself is kept in step for older readers). `js/telemetry.js` decides it (desktops, which report no charge state, are never on battery) and sets:

- `SH.state.lite` (boolean) and `html[data-lite="1"]` (`"0"` otherwise) for CSS. `SH.power.onBattery` says whether the PC is on battery at all; `SH.power.igpuOnly` whether the only graphics adapter is integrated; `SH.power.set(true | false | null)` forces the battery state in tests.
- `SH.on('power', ({ lite, onBattery, igpuOnly }) => {})`: fires only when `lite` changes. Rebuild or stop whatever depends on it (the shell, the starfield and the 3D view already do).
- `SH.effInt()`: the intensity the animations must use. It is the user's choice (`SH.state.settings.intensity`, which stays untouched in the settings) one step lower while `lite` (`max` becomes `normal`). Use it for every question about animation strength (`SH.effInt() === 'min'`, `SH.motion()`, `--f`); read `state.settings.intensity` only to show or save the setting itself.
- CSS: put the cheaper version under `html[data-lite="1"]`: no `backdrop-filter`, no big blurs or masks, no looping decoration (see the block in `base.css`). The telemetry rate drops to one sample every 2 s and the engine skips its slow extras.
- Per-frame loops check `SH.state.lite` (or `SH.effInt() === 'min'`) and stop; a hidden window (tray) already pauses every loop and uses no GPU.
- Idle tracking (shell.js): `SH.poke()` marks activity (mouse, keys, touch and the gamepad call it), `SH.idleFor()` is the ms since the last one and `SH.isIdle()` is true after 8 s without any. `html[data-idle="1"]` (`"0"` otherwise, checked once a second) lets CSS drop its own decorative transitions while nobody is using the app; the starfield already redraws less when idle. Do not start work in an idle callback that the user would notice when they come back.

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

### Registry cleaner (opt-in)

Microsoft advises against registry cleaners, so the one in Super Optimizer is off by default: setting `registryCleaner` (boolean, default `false`), Settings > General > "Registry cleaner". Off: the Registry tab is hidden (see the hidden-tab condition above), the overview has no registry area or ring segment, the analysis does not scan it, and there is no badge or palette action. On: the tab and its area work as always, but the registry is never a step of "Optimize everything" (nor of its undo), and Autopilot has no registry action. Undo never depends on the setting: registry backups stay listed and restorable in Settings > Backups and restore (`engine/backups.py`) with the cleaner off.

Migration: when `registryCleaner` is not in the saved file (an upgrade from before it existed), `loadSettings` asks the engine `optimizer.registry_backups_exist` (read-only: any folder under `registry/` in the ProgramData or user optimizer data); it becomes `true` only if the user already has registry-fix backups, `false` otherwise, and it is saved so this runs once. Reset settings saves `false` explicitly, so the migration never turns it back on.

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
- Nothing starts `powershell.exe` by itself (start, telemetry, Home's pc_info/health, the drivers count, Autopilot's metered-connection check): those read WMI in-process through `engine/wmi.py` (System.Management via pythonnet: `system._query_wmi`, `system._health_wmi`, `drivers._inventory_wmi`) or COM (`autopilot._metered_com`), keeping the PowerShell script as the fallback if WMI fails. PowerShell is for what the user triggers (Program Updater, Debloat, firewall, Defender scans...); a new background feature must not add a spawn.
- Install and update modes (`engine/selfupdate.py`): installs are per-user by default (`PrivilegesRequired=lowest` in `StellarHub.iss`, `%LOCALAPPDATA%\Programs`) and update **directly** (no admin, no task). An all-users install updates through the on-demand `StellarHub\Update` task if it exists ("task"); without it the mode is "uac": the first update asks Windows once (only from the Update button or the start-time staged install; `prefetch()` and `start(allow_uac=False)` never prompt, so a new-features version shows the update window instead of staging) and the elevated updater creates the task (`_make_task_if_missing`), so later updates are silent. The installer no longer creates the task; the uninstaller deletes only the tasks that start that copy.
- `system.pc_info()` answers at once with the last measurement; when it is older than 30 minutes (`STALE_AFTER`) it starts one background refresh (one at a time) and the next call has the new data. Home asks `system.pc_info_fresh` (in the engine's own thread, never blocking the UI) at start if the saved copy is old, when it is shown again and every 10 minutes while open, and updates the header facts and the components only if something changed.
- Whatever Windows does not provide arrives as `null`: the UI shows "—" (`SH.tele.has`, `SH.tele.fmt`).
- Anything destructive always gets: a confirmation in the UI, `SH.requireAdmin` if needed, a restore point or a backup first, and undo whenever possible.
- Performance: no layout reads (`offsetLeft`, `getBoundingClientRect`) in per-frame loops; long lists use `content-visibility:auto` or virtualization.
- Commands that run other programs (winget, installers) go through `updater._stream`, which ends when the command ends even if a process it started keeps the output pipe open (Foxit's update service did), and reports silence through `on_tick`.
- Start and exit: `stellarhub/splash.py` is the start screen (a Win32 layered window on its own thread). The main window is created off screen (WebView2 does not load a hidden window) and `Api._reveal` moves, maximizes and shows it when the UI calls `ui_ready`; `SH.enter()` / `SH.leave()` (core.js) fade the page in and out, and `Api.quit` waits for the fade. `STELLARHUB_NO_SPLASH=1` turns the start screen off.

- Start, handoffs and updates never leave the screen empty or silent (`app.py` main, `startup.py`, `instance.take_over_running_copy`, `engine/selfupdate.py`, `packaging/StellarHub.iss`):
  - The start screen is the first thing `main()` does (before waiting for a previous copy, elevating or claiming the lock). A copy started by the administrator relaunch or the task says "Opening as administrator…"; a second copy that finds the lock taken says "Opening StellarHub…".
  - A second copy asks the running one to show itself and needs its `ok` reply (1.5 s). No answer: it keeps trying for the lock for ~12 s, gives a copy that still has its start screen up its time (up to ~2 min: staged update), then ends the stuck copy and takes over; if it can't (an administrator copy), it says so in a message box. Never a silent exit.
  - `--wait-pid` waits at most 10 s for the previous copy and then ends it. The old copy keeps its own start screen up until the new copy's is visible (`splash.other_showing`).
  - Updates: the updater shows the start screen ("Installing the update…") from the moment the app closes, runs Setup with `/SILENT` (its small progress window, kept topmost; nothing to answer) and exits when that window is up; Setup opens StellarHub itself when it finishes (or the previous version if it failed). The portable `--finish-update` shows the start screen until the updated app has its own. The installer's last step runs `--warm` (loads every DLL once) so Windows' first-run scan of the new files happens inside the progress window, not at the first start.
  - `[phase]` lines in `stellarhub.log` time each step of a start from the process creation; the log rotates above 2 MB and repeated lines are counted.
  - Tests and isolated copies set `STELLARHUB_NO_DIALOGS=1` (implied by `STELLARHUB_ISOLATED=1` and `STELLARHUB_UPDATE_DIR`): messages go to the log, never a modal box. `STELLARHUB_LOCK_ID` lets isolated copies share one lock (single-instance tests).
- StellarHub's own updates: `engine/selfupdate.py` (how it works is in its docstring) and `ui/js/selfupdate.js` (the dialog). Tests serve a fake GitHub with `STELLARHUB_UPDATE_URL` and `STELLARHUB_UPDATE_DIR`; `STELLARHUB_ISOLATED=1` copies never elevate or touch the user's startup entries.
  - Signed releases (2.0.0+): the trust anchor is an Ed25519 signature (`stellarhub/ed25519.py`, pure Python, RFC 8032 vectors in `tests/`) over the manifest `StellarHub release
file: <name>
version: <X>
sha256: <hex>
`, checked against `TRUSTED_KEYS` in `selfupdate.py`; the `.sha256` files are only for humans. No `.sig` or a bad one: `pick()` returns nothing (check offers the release page, `unsigned: true`) or the updater fails with `why="signature"` and deletes the file. Rotating the key: add the new public key to `TRUSTED_KEYS`, release signed with the old key, drop the old one in a later release. Tests use throwaway keys and patch `TRUSTED_KEYS`; never put a real secret in the repo (`.gitignore` has `.stellarhub-release/` and `*.key`).
  - Release steps (owner's PC, once: `python tools/release_sign.py keygen --export`, keep the backup offline, paste the printed public key into `TRUSTED_KEYS`): 1. bump the version and push the tag so CI builds; 2. download the CI artifacts (`StellarHub-Setup-X.exe`, `StellarHub-Portable-X.zip`, and their `.sha256`); 3. sign locally: `python tools/release_sign.py sign StellarHub-Setup-X.exe StellarHub-Portable-X.zip --version X`; 4. optionally `verify` each; 5. publish the GitHub release with the four files plus the two `.sig` (six assets). A release without its `.sig` files is not installed by any copy.

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
