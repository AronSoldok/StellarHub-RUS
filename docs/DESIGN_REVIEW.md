# StellarHub design review (Impeccable pass, branch `design/impeccable`)

Degraded: single-context (delegated run; no sub-agents allowed, so the design review and the detector evidence were
gathered in one context, design review first). Method: Impeccable 4.10 playbooks `critique`, `polish`, `typeset`,
`layout`, `colorize`, `quieter`, `animate` and the craft floor, read from a local copy. The launcher binary was not
run (no downloads, no hooks, no live mode); the deterministic detector was run with `npx impeccable detect` and
telemetry off. Evidence: headless Edge screenshots of every route in sample mode at 1920x1080 and 1100x700.

Mode: **Operate** (an app the user works in), with one **Experience** moment (Home and the start). The brief is pinned:
keep space / galaxy / stellar, the starfield, the deep-space palette, coral `#FF7A66` + ice `#9ED6FF`, the
planet-with-orbit mark, depth and the cinematic feel. So this is a **refinement**, not a new world: the Orbital system
stays, its details get tightened.

## What already works

- A real point of view. The starfield, the nebula wash, the planet mark and the warp camera between Home and the
  modules make it unmistakably one product; nothing reads as a template.
- A disciplined token base (`--void … --faint`, `--accent/--accent2`, `--f` for motion intensity, density and corner
  presets) and a strict module contract, so a system-wide change can be made in a few places.
- Performance is treated as design: lite mode, intensity steps, idle mode, no per-frame layout reads.
- Copy is plain and specific; destructive actions always have confirmation and undo.

## Priority issues

1. **The stars sit on top of the content.** Panels are a 4–36 % tint, so stars, the nebula and shooting stars show
   through every table row, chart and number. The space is lovely in the gutters and noisy inside the work. Panels have
   no light direction either: one flat fill, one hairline, a shadow below. The surface does not feel like glass or
   like an instrument, just like a darker rectangle.
2. **The display face is spent too low.** Unbounded is a wide, loud display face. It is used for the 34 px headline
   (good) but also for 12.5 px component names, 13–17 px data values and tile numbers, where its width and geometric
   counters cost legibility and make every tile shout at the same volume. Panel titles (`.pan>h4`, 12.5 px muted
   regular) are quieter than the values under them, so the eye has no anchor per panel.
3. **Spring overshoot everywhere.** 65 CSS curves overshoot (`cubic-bezier(.2,.9,.3,1.3/1.4)`, `(.3,1.5,.4,1)`), on
   checkmarks, toggles, chips, tooltips, cards, menus, calendar events. Together with the JS springs
   (`springEase(180,19)`, damping 0.71, about 4 % overshoot) everything wobbles a little. The "alive" feel belongs to
   the dock, the camera and the orbit; on routine controls it reads as jelly, not precision.
4. **Glow and stripe decoration.** Zero-offset coloured glows (admin dot, radar core, next-run dot, pressed keys,
   widget dot), two 3 px side stripes (Autopilot calendar events, changed services in the optimizer), a diagonal
   stripe texture on the "estimate" bar, three blinking live dots. Each is small, together they are the generic
   "AI dashboard" signature the brief wants to avoid.
5. **Contrast of the faint tier.** `--faint #5B6781` is 3.0–3.5:1 on the panels, and it carries real information
   (column heads, hints, sizes, units, dates). It fails WCAG AA for text that size.

## Minor observations

- Home's "Right now" list is spread with `space-around`: on 1080 p there are ~60 px voids between rows; rhythm is
  loose while the rest of the screen is dense.
- Hover lifts that move the hovered element itself (`.vcard`, `.tool`, `.vit`, `.pend`) slide out from under the
  pointer near the edge.
- Many near-identical small sizes (10.5, 11, 11.5, 12, 12.5, 13) with no role behind them.
- Toasts are inverted (light on the dark app); they are the only light surface in the product and look pasted on.
- The start screen uses Segoe UI Semibold for the name while the app's brand voice is Unbounded.

## Detector (before)

`impeccable detect stellarhub/ui`: 87 findings. 65 bounce/elastic easing, 12 indeterminate progress sweeps
(deliberate, kept), 3 pulsing dots, 3 zero-offset coral glows, 3 side-tab stripes, 1 repeating-stripes gradient.
The detector agrees with issues 3 and 4; it cannot see issues 1, 2 and 5.

## Plan

Thesis: **observatory glass**. The sky stays alive around the work; the work sits on dark, lit glass.

1. Surfaces: one panel recipe for every frame (panels, sheet, palette, dock, dialogs): a denser deep tint so the sky
   recedes behind content but still reads as depth, a faint top-lit gradient, a 1 px rim highlight on the top edge
   (light from the nebula), and a soft offset shadow. No new backdrop-filter. Lite mode keeps the flat version.
2. Type: Unbounded only from 15 px up (titles, hero numbers, brand). Below that, Onest 600 with tabular figures.
   Panel titles become the panel's anchor (ink, 600). A named role scale replaces the stray sizes in shared pieces.
3. Colour: keep coral and ice exactly. Raise `--faint` to pass AA, cool the hairlines, add derived accent tokens
   (soft fill, line) so states use one vocabulary. Nebula gets a soft vignette for cinematic depth (static, free).
4. Motion: one curve family. `--e-out` (expo out) for arrivals, `--e-snap` (quint out) for controls,
   `--e-io` for travel. JS springs keep their identity on the dock, the camera and the 3D view but are damped to
   ~0.85 so they settle instead of wobbling. Hover moves a child, not the hovered box.
5. Replace decoration: glows become offset shadows or a ring; side stripes become a full tinted border plus a leading
   colour dot; the stripe texture becomes an outlined "estimate" bar; live dots stop blinking (a steady dot with a
   ring). Indeterminate progress sweeps stay.
6. Cover every screen: shared pieces in `base.css` first (they reach all 12 modules), then each module's own CSS
   for the flagged items, Home, Settings, palette, component sheet, toasts, widget, tray and the start screen.
