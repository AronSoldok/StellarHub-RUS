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
- Respect `SH.state.settings.intensity` (`max`, `normal`, `min`): at `min`, nothing loops.

## Home views

```js
SH.homeVariant({
  id: 'xray', name: 'X-ray', short: 'X-ray', desc: 'One line',
  mount(el, ctx) { /* draws inside el (it fills the central stage). ctx.intro=true: play your entrance */ },
  unmount() { /* remove tickers and listeners */ },
  resize() {}, onReturn() { /* when coming back to Home from a module */ },
});
```

`ctx`: `PC` (model and `components` with id, name, title, rows, bar), `tele`, `openComponent(id)` (opens Live Monitor on its tab), `motion()`.

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
- Whatever Windows does not provide arrives as `null`: the UI shows "—" (`SH.tele.has`, `SH.tele.fmt`).
- Anything destructive always gets: a confirmation in the UI, `SH.requireAdmin` if needed, a restore point or a backup first, and undo whenever possible.
- Performance: no layout reads (`offsetLeft`, `getBoundingClientRect`) in per-frame loops; long lists use `content-visibility:auto` or virtualization.

## Testing

`index.html#drivers/all` opens a tab; `index.html#drivers/*` walks through all of them; `index.html#home=xray` forces a Home view. Script: `check_ui.sh "index.html#drivers/*"` (headless Edge, lists JS errors).

## Writing

English only. Sentence case (capitalize only the first word and proper names), clear verbs ("Uninstall" → "Uninstalled"). No ALL-CAPS labels, no filler "A · B · C", no "→" on buttons, no emojis, no purple gradients. Numbers and dates use the `en-US` locale.
