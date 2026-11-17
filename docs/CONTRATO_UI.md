# Contrato de la interfaz de StellarHub

Cómo se escribe un módulo o una vista de Inicio sin romper el resto. Todo cuelga de `window.SH` (ver `ui/js/core.js`).

## Archivos

| Pieza | JS | CSS |
|---|---|---|
| Módulo `<id>` | `ui/js/modules/<id>.js` | `ui/css/modules/<id>.css` (todo prefijado con `#v-<id>`) |
| Vista de Inicio `<id>` | `ui/js/home/<id>.js` | `ui/css/home/<id>.css` (todo prefijado con `.hv-<id>`) |

Ya están enlazados en `index.html`. Sin recursos externos: todo local (three.js está en `ui/vendor/three.module.min.js`).

## Módulos

La lista maestra (nombre, icono, descripción, pestañas) está en `SH.MODS` (core.js). El armazón crea la vista, la cabecera, la barra de pestañas con su indicador y un contenedor `.tab` por pestaña. El módulo solo rellena:

```js
SH.module({
  id: 'drivers',
  actions(el, ctx) { /* botones de la cabecera, a la derecha del título */ },
  renderTab(tabId, el, ctx) { /* se llama UNA vez, la primera vez que se abre la pestaña */ },
  enterTab(tabId, el, ctx) { /* cada vez que se muestra */ },
  leaveTab(tabId, el) {},
  enter() {}, leave() {},
});
```

`ctx`: `go(id, {tab})`, `setTab(id)`, `tabEl(id)`, `setBadge(tabId, n)` (número en la pestaña), `el()` (la sección).

- `.tab` es `position:absolute; inset:0; overflow:auto`. Para un diseño a pantalla completa con scroll interno, añade la clase `fill` al `el` de la pestaña.
- Lo marcado con `data-asm` dentro de una pestaña entra escalonado la primera vez (lo hace el armazón).
- Bucles por frame: `SH.tickers.add((dt, t) => { if (SH.state.view !== 'drivers') return; ... })`.
- Datos en vivo: `SH.tele.v` (valores), `SH.tele.hist[clave]` (120 valores), `SH.tele.on(fn)`.
- Antes de algo que necesita administrador: `if (!SH.requireAdmin('para instalar drivers.')) return;` (sugiere sin insistir).
- Confirmaciones: `SH.toast('Hecho', { action: { label: 'Deshacer', run } })`. Nada de `alert`/`confirm`.
- Acciones para la paleta: `SH.actions.add([{ t: 'Texto', go: 'drivers', tab: 'backup', ic: 'download' }])`.
- Iconos: `SH.ic('nombre')`; nuevos con `SH.icons.add({ nombre: '<path d="..."/>' })` (trazo 24×24, sin relleno).

## Piezas compartidas (base.css)

`.pan` (marco), `.btn` (`pri`, `sec`, `ghost`, `danger`, `sm`, `lg`), `.seg` + `.ind` (mover con `SH.placeSeg(seg)`), `.toggle`, `.check`, `.chip` (`ok`, `warn`, `bad`, `acc`), `.field`, `.bar>span` (con `transform: scaleX()`), `.rows/.row/.ri/.rt`, `.tbl-head`, `.empty`, `.sk` (esqueleto), `.big`, `.muted`, `.faint`.

Tokens: `--void --deep --raise --raise2 --raise3 --line --line2 --ink --mute --faint --accent --accent2 --on-accent --ok --warn --bad --display --text --r-l --r-m --r-s --f` (multiplica duraciones CSS por `var(--f)`).

## Animación

- `SH.anim(el, keyframes, { d, delay, e })` (WAAPI con la intensidad aplicada; interrumpe la anterior). `SH.EASE.out | io | spring | soft | snappy`.
- `SH.Spring(v, k, c)` con `.t` (objetivo), `.step(dt)`, `.set(v)`. Interrumpible por naturaleza.
- Solo `transform`, `opacity`, `filter`, `clip-path`, `stroke-dashoffset`. Rápidas: 83/167/250 ms; grandes ≤ 500 ms. Nunca `ease-in` al entrar.
- Respeta `SH.state.settings.intensity` (`max`, `normal`, `min`): en `min`, nada en bucle.

## Vistas de Inicio

```js
SH.homeVariant({
  id: 'xray', name: 'Rayos X', short: 'Rayos X', desc: 'Una línea',
  mount(el, ctx) { /* pinta dentro de el (ocupa el escenario central). ctx.intro=true: haz tu entrada */ },
  unmount() { /* quita tickers y listeners */ },
  resize() {}, onReturn() { /* al volver a Inicio desde un módulo */ },
});
```

`ctx`: `PC` (modelo y `components` con id, name, title, rows, bar), `tele`, `openComponent(id)` (abre el Live Monitor en su pestaña), `motion()`.

## Motor real (Python)

Cada módulo tiene `stellarhub/engine/<id>.py` con `EXPORTS` (llamadas rápidas) y `JOBS` (tareas largas que reciben `job`).

```js
const lista = await SH.engine('drivers', 'list');                 // undefined fuera de la app: usar datos de ejemplo
const r = await SH.job('drivers', 'search', [], { onProgress: m => {/* m.pct, m.text, m.data */}, onLog: lineas => {} });
// la promesa tiene .cancel()
SH.setPending('drivers', 4);   // alimenta "Por revisar" de Inicio (claves: drivers, apps, junk)
SH.logActivity('Drivers actualizados', { sub: '2 instalados', ic: 'drivers', go: 'drivers', tab: 'history' });
```

- Infraestructura: `engine/jobs.py` (progreso, registro en vivo, cancelar), `engine/ps.py` (PowerShell y consolas en UTF-8, con salida en vivo), `engine/telemetry.py` (telemetría real → `SH.tele.push`), `engine/system.py` (datos del equipo, salud, pantallas y capturas), `engine/removal/` (motor heredado de MiniRevo: programas, iconos, restos, cuarentena, limpieza, inicio).
- Lo que Windows no da llega como `null`: la interfaz muestra «—» (`SH.tele.has`, `SH.tele.fmt`).
- Lo destructivo siempre: confirmación en la interfaz, `SH.requireAdmin` si hace falta, punto de restauración o copia previa, y deshacer cuando sea posible.
- Rendimiento: nada de leer el layout (`offsetLeft`, `getBoundingClientRect`) en bucles por frame; listas largas con `content-visibility:auto` o virtualizadas.

## Pruebas

`index.html#drivers/all` abre una pestaña; `index.html#drivers/*` recorre todas; `index.html#home=xray` fuerza una vista de Inicio. Script: `check_ui.sh "index.html#drivers/*"` (Edge sin ventana, lista errores de JS).

## Escritura

Español, inicial en minúscula salvo la primera palabra, verbos claros ("Desinstalar" → "Desinstalado"). Sin etiquetas en MAYÚSCULAS, sin "A · B · C" de relleno, sin "→" en botones, sin emojis, sin degradados morados.
