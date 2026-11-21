"""Interface sounds: the files and their credits, the settings the sanitizer accepts, the WebView2 switch that lets the
start sound play, the exit sound's wait, and the translations of the Sound settings."""
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

os.environ["STELLARHUB_NO_DIALOGS"] = "1"
os.environ["STELLARHUB_NO_SPLASH"] = "1"

from stellarhub import config, settings, startup  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI = os.path.join(ROOT, "stellarhub", "ui")
SOUNDS = os.path.join(UI, "sounds")


def read(*p):
    with open(os.path.join(UI, *p), encoding="utf-8") as fh:
        return fh.read()


def sound_table():
    """SOUND_EV (core.js): {event: {c, g, gap, tier, user?, f?, cut?}}."""
    block = re.search(r"const SOUND_EV = \{(.*?)\n\};", read("js", "core.js"), re.S).group(1)
    out = {}
    for ev, body in re.findall(r"(\w+): \{ (c: '[^}]*)\}", block):
        d = {}
        for k, v in re.findall(r"(\w+): ('[^']*'|[\d.]+)", body):
            d[k] = v.strip("'") if v.startswith("'") else float(v)
        out[ev] = d
    return out


def sound_events():
    """The event names in SOUND_EV (core.js)."""
    return list(sound_table())


def swooshes():
    """SWOOSH (core.js): [(file, trim)], the swooshes that follow navigate's click."""
    block = re.search(r"const SWOOSH = \{.*?files: \[(.*?)\] \};", read("js", "core.js"), re.S).group(1)
    return [(f, float(g)) for f, g in re.findall(r"\['(\w+)', ([\d.]+)\]", block)]


def event_file(ev):
    return sound_table()[ev].get("f", ev)


class SoundFiles(unittest.TestCase):
    def test_every_event_has_its_file_and_credit(self):
        table = sound_table()
        self.assertEqual(len(table), 37)
        files = {f[:-4] for f in os.listdir(SOUNDS) if f.endswith(".ogg")}
        sw = [f for f, _ in swooshes()]
        self.assertEqual(sw, [f"navigate_swoosh_{i}" for i in range(1, 8)])
        self.assertEqual(table["navigate"]["f"], "navigate_click")
        self.assertEqual({d.get("f", ev) for ev, d in table.items()} | set(sw), files)   # no file is left over
        self.assertNotIn("navigate", files)                                              # the old one is gone
        with open(os.path.join(SOUNDS, "CREDITS.json"), encoding="utf-8") as fh:
            credits = json.load(fh)
        self.assertEqual(len(credits), 44)
        self.assertEqual({c["event"] for c in credits}, files)
        for c in credits:
            self.assertIn(c["license"], ("CC0-1.0", "CC-BY-4.0"), c["event"])
            if c["license"] != "CC0-1.0":  # attribution licences carry their credit, shown in About and the README
                self.assertTrue(c["attribution"] and c["sourceUrl"], c["event"])
        hover = next(c for c in credits if c["event"] == "hover")
        self.assertIn("freesound.org/people/unfa/sounds/565131", hover["sourceUrl"])

    def test_attribution_credits_are_shown(self):
        with open(os.path.join(SOUNDS, "CREDITS.json"), encoding="utf-8") as fh:
            credits = [c for c in json.load(fh) if c["license"] == "CC-BY-4.0"]
        self.assertTrue(credits)
        shell = read("js", "shell.js")
        with open(os.path.join(ROOT, "README.md"), encoding="utf-8") as fh:
            readme = fh.read()
        for c in credits:
            self.assertIn(c["author"], shell, c["event"])
            self.assertIn(c["sourceUrl"], shell, c["event"])
            self.assertIn(c["author"], readme, c["event"])
            self.assertIn(c["sourceUrl"], readme, c["event"])
            self.assertIn("CC BY 4.0", readme)

    def test_typing_and_map_ticks(self):
        t = sound_table()
        for ev in ("key_type", "map_hover"):
            self.assertEqual(t[ev]["c"], "ui", ev)             # Interface group (soundUi)
            self.assertEqual(t[ev]["tier"], 0, ev)             # never cuts or blocks another sound
        self.assertEqual(t["key_type"]["gap"], 30)
        self.assertEqual(t["key_type"]["user"], 1)
        self.assertEqual(t["map_hover"]["gap"], 35)
        self.assertNotIn("user", t["map_hover"])               # a hover, like hover itself

    def test_gain_trims_follow_the_loudest_100_ms(self):
        """Played level = the file's loudest 100 ms + its trim: the typing tick sits between the quiet sounds and the
        interface, the map tick under hover, and the replaced files where their family is."""
        try:
            import numpy as np
            import soundfile as sf
        except ImportError:
            self.skipTest("needs numpy and soundfile")
        import math
        t = sound_table()

        def level(ev):
            return raw(event_file(ev)) + 20 * math.log10(t[ev]["g"])

        def raw(name):
            x, sr = sf.read(os.path.join(SOUNDS, name + ".ogg"), always_2d=True)
            m = x.mean(axis=1)
            w = int(sr * 0.1)
            if len(m) < w:
                e = float(np.sum(m ** 2)) / w
            else:
                c = np.cumsum(np.concatenate([[0.0], m ** 2]))
                e = float(np.max(c[w:] - c[:-w])) / w
            return 10 * math.log10(max(e, 1e-18))

        self.assertLess(level("map_hover"), level("hover"))
        self.assertGreater(level("key_type"), level("hover"))
        self.assertLess(level("key_type"), level("click") - 6)
        for ev in ("navigate", "tab_switch"):
            self.assertAlmostEqual(level(ev), -29, delta=2.5, msg=ev)           # the interface
        for ev in ("scan_complete", "success", "error"):
            self.assertAlmostEqual(level(ev), -24.5, delta=1.5, msg=ev)         # the notifications
        self.assertAlmostEqual(level("toast"), -26.5, delta=1.5)                # a plain toast: a little under those
        self.assertAlmostEqual(level("scan_start"), -25.5, delta=1.5)
        # navigate's swooshes: all about as loud as each other, well under the click they follow
        for f, g in swooshes():
            lv = raw(f) + 20 * math.log10(g)
            self.assertAlmostEqual(lv, -36, delta=1, msg=f)
            self.assertLess(lv, level("navigate") - 5, f)

    def test_files_are_ogg_vorbis(self):
        for f in os.listdir(SOUNDS):
            if f.endswith(".ogg"):
                with open(os.path.join(SOUNDS, f), "rb") as fh:
                    head = fh.read(64)
                self.assertTrue(head.startswith(b"OggS") and b"vorbis" in head, f)

    def test_sounds_js_loads_right_after_core(self):
        html = read("index.html")
        scripts = re.findall(r'<script src="js/([\w/.-]+)"></script>', html)
        self.assertEqual(scripts[scripts.index("core.js") + 1], "sounds.js")

    def test_the_sound_section_follows_animation(self):
        m = re.search(r"const SECTIONS = \[(.*?)\];", read("js", "shell.js"))
        ids = re.findall(r"\['(\w+)', SH\.t", m.group(1))
        self.assertEqual(ids[ids.index("motion") + 1], "sound")
        self.assertNotIn("A soft sound when long tasks finish.", read("js", "shell.js"))

    def test_the_build_ships_the_sounds_and_the_cache_notices_them(self):
        with open(os.path.join(ROOT, "packaging", "StellarHub.spec"), encoding="utf-8") as fh:
            spec = fh.read()
        self.assertIn('(os.path.join(ROOT, "stellarhub", "ui"), os.path.join("stellarhub", "ui"))', spec)
        ui = tempfile.mkdtemp()
        web = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, ui, True)
        self.addCleanup(shutil.rmtree, web, True)
        os.makedirs(os.path.join(ui, "sounds"))
        ogg = os.path.join(ui, "sounds", "click.ogg")
        with open(ogg, "wb") as fh:
            fh.write(b"OggS one")
        stamp = os.path.join(web, "ui.version")
        with mock.patch.object(config, "UI_DIR", ui), mock.patch.object(config, "WEB_DIR", web), \
                mock.patch.object(config, "FROZEN", False), mock.patch("stellarhub.i18n.build_bundles"):
            startup.refresh_ui_cache()
            with open(stamp, encoding="utf-8") as fh:
                first = fh.read()
            with open(ogg, "wb") as fh:
                fh.write(b"OggS two")
            startup.refresh_ui_cache()
            with open(stamp, encoding="utf-8") as fh:
                self.assertNotEqual(fh.read(), first)


class BrowserArgs(unittest.TestCase):
    AUTOPLAY = "--autoplay-policy=no-user-gesture-required"

    def test_added_to_nothing(self):
        out = startup.merge_browser_args("")
        self.assertIn(self.AUTOPLAY, out.split())
        self.assertIn("--disable-features=ElasticOverscroll", out.split())

    def test_a_test_copys_debugging_port_is_kept(self):
        out = startup.merge_browser_args("--remote-debugging-port=9333").split()
        self.assertEqual(out[0], "--remote-debugging-port=9333")
        self.assertIn(self.AUTOPLAY, out)

    def test_merging_twice_changes_nothing(self):
        once = startup.merge_browser_args("--remote-debugging-port=9333")
        self.assertEqual(startup.merge_browser_args(once), once)

    def test_an_existing_value_wins_and_feature_lists_are_joined(self):
        out = startup.merge_browser_args("--autoplay-policy=user-gesture-required --disable-features=Foo").split()
        self.assertIn("--autoplay-policy=user-gesture-required", out)
        self.assertNotIn(self.AUTOPLAY, out)
        self.assertIn("--disable-features=Foo,ElasticOverscroll", out)

    def test_set_before_the_window_starts(self):
        with mock.patch.dict(os.environ, {startup.BROWSER_ARGS_ENV: "--remote-debugging-port=9444"}):
            startup.set_browser_args()
            val = os.environ[startup.BROWSER_ARGS_ENV].split()
            self.assertIn("--remote-debugging-port=9444", val)
            self.assertIn(self.AUTOPLAY, val)
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop(startup.BROWSER_ARGS_ENV, None)
            startup.set_browser_args()
            self.assertIn(self.AUTOPLAY, os.environ[startup.BROWSER_ARGS_ENV])

    def test_app_sets_them_before_webview_start(self):
        with open(os.path.join(ROOT, "stellarhub", "app.py"), encoding="utf-8") as fh:
            src = fh.read()
        self.assertLess(src.index("startup.set_browser_args()"), src.index("webview.start("))


class ExitSound(unittest.TestCase):
    def test_on_by_default(self):
        self.assertTrue(settings.plays_exit_sound({}))
        self.assertTrue(settings.plays_exit_sound(None))

    def test_off_with_any_switch_or_no_volume(self):
        self.assertFalse(settings.plays_exit_sound({"sounds": False}))
        self.assertFalse(settings.plays_exit_sound({"soundSystem": False}))
        self.assertFalse(settings.plays_exit_sound({"soundVolume": 0}))
        self.assertTrue(settings.plays_exit_sound({"soundUi": False, "soundVolume": "bad"}))

    def test_the_wait_stays_short(self):
        self.assertLessEqual(settings.EXIT_SOUND_WAIT, 0.75)


@unittest.skipUnless(shutil.which("node"), "needs Node.js")
class Sanitizer(unittest.TestCase):
    """sanitizeSettings from core.js, run in Node: the new keys keep their types and the volume its range."""

    @classmethod
    def setUpClass(cls):
        src = read("js", "core.js")
        defaults = re.search(r"const DEFAULTS = \{.*?\n\};", src, re.S).group(0)
        rest = re.search(r"const RANGE = .*?\nfunction sanitizeSettings\(saved\) \{.*?\n\}", src, re.S).group(0)
        cls.prelude = "const reduceMQ = { matches: false };\n" + defaults + "\n" + rest + "\n"

    def run_js(self, expr):
        code = self.prelude + f"process.stdout.write(JSON.stringify({expr}));"
        out = subprocess.run(["node", "-e", code], capture_output=True, text=True, timeout=30)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout)

    def test_defaults(self):
        d = self.run_js("DEFAULTS")
        self.assertIs(d["sounds"], True)
        self.assertEqual(d["soundVolume"], 0.6)
        for k in ("soundUi", "soundAlerts", "soundTasks", "soundSystem"):
            self.assertIs(d[k], True, k)

    def test_volume_is_clamped_and_typed(self):
        self.assertEqual(self.run_js("sanitizeSettings({ soundVolume: 4 })"), {"soundVolume": 1})
        self.assertEqual(self.run_js("sanitizeSettings({ soundVolume: -2 })"), {"soundVolume": 0})
        self.assertEqual(self.run_js("sanitizeSettings({ soundVolume: 0.35 })"), {"soundVolume": 0.35})
        self.assertEqual(self.run_js("sanitizeSettings({ soundVolume: '0.5' })"), {})

    def test_switches_must_be_booleans(self):
        out = self.run_js("sanitizeSettings({ sounds: false, soundUi: 'no', soundAlerts: 0, soundTasks: false, soundSystem: true })")
        self.assertEqual(out, {"sounds": False, "soundTasks": False, "soundSystem": True})

    def test_admin_asked_is_a_number_or_nothing(self):
        self.assertEqual(self.run_js("sanitizeSettings({ adminAsked: 1700000000000 })"), {"adminAsked": 1700000000000})
        self.assertEqual(self.run_js("sanitizeSettings({ adminAsked: 'soon' })"), {})


class Translations(unittest.TestCase):
    """Every sentence of Settings > Sound and the credits line is translated in every language."""
    KEYS = re.compile(r"SH\.t\('((?:[^'\\]|\\.)*)'\)|\bt\('((?:[^'\\]|\\.)*)'\)")

    def test_sound_section_strings(self):
        shell = read("js", "shell.js")
        sec = re.search(r"case 'sound': return `(.*?)`;", shell, re.S).group(1)
        keys = {a or b for a, b in self.KEYS.findall(sec)}
        about = re.search(r"case 'about': return `(.*?)`;", shell, re.S).group(1)
        keys |= {k for k in (a or b for a, b in self.KEYS.findall(about)) if "Orbital" in k or "JC Sounds" in k}
        keys |= {"Notification sound"}
        keys |= {"Sound", "Change the sound volume"}
        self.assertGreaterEqual(len(keys), 14)
        for lang in ("es", "pt", "it", "fr", "zh", "ja"):
            d = {}
            folder = os.path.join(UI, "i18n", lang)
            for f in os.listdir(folder):
                with open(os.path.join(folder, f), "rb") as fh:
                    raw = fh.read()
                self.assertFalse(raw.startswith(b"\xef\xbb\xbf"), f"{lang}/{f} has a BOM")
                d.update(json.loads(raw.decode("utf-8")))
            missing = sorted(k for k in keys if not d.get(k))
            self.assertEqual(missing, [], lang)


# core.js + sounds.js in Node: a tiny event bus for window/document, a Web Audio stand-in that "plays" every buffer,
# and a recorder around SH.sound that lists what really played.
WIRING = r"""
const L = {};
const listen = (type, fn, o) => { (L[type] ||= []).push({ fn, capture: o === true || !!(o && o.capture) }); };
/* capture listeners first, then the target's own handler (h), then bubbling ones: enough for these tests */
const fire = (type, e, h) => { e = { type, isTrusted: true, detail: 1, button: 0, buttons: 0, pointerType: 'mouse', clientX: 5, clientY: 5, ...e };
  for (const l of (L[type] || []).filter(l => l.capture)) l.fn(e); if (h) h(e); for (const l of (L[type] || []).filter(l => !l.capture)) l.fn(e); return e; };
globalThis.window = globalThis;
const noop = () => {};
const el = () => ({ dataset: {}, style: { setProperty: noop }, animate: () => ({ finished: Promise.resolve(), cancel: noop }), classList: { add: noop, remove: noop, toggle: noop, contains: () => false } });
let DIALOGS = [];
globalThis.document = { documentElement: el(), hidden: false, addEventListener: listen, querySelector: () => null,
  querySelectorAll: s => s.includes('.cs-o') ? DIALOGS : [] };
globalThis.addEventListener = listen; globalThis.removeEventListener = noop;
globalThis.matchMedia = () => ({ matches: false });
globalThis.requestAnimationFrame = noop; globalThis.setInterval = () => 0;
globalThis.MutationObserver = class { observe() {} };
globalThis.chrome = { webview: {} };
globalThis.pywebview = { api: new Proxy({}, { get: (_, n) => n === 'then' ? undefined : () => true }) };
globalThis.SH = { t: s => s };
class AudioBuffer {}
globalThis.AudioBuffer = AudioBuffer;
const param = () => ({ value: 1, cancelScheduledValues: noop, setTargetAtTime: noop });
globalThis.AudioContext = class { constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
  createGain() { return { gain: param(), connect: noop, disconnect: noop }; }
  createBufferSource() { const s = { connect: noop, stop: noop, start(when) { started.push({ file: s.buffer && s.buffer.file, when: when || 0 }); setTimeout(() => s.onended && s.onended(), 20); } }; return s; }
  resume() { return Promise.resolve(); } decodeAudioData(a) { const b = new AudioBuffer(); b.file = a.file; return Promise.resolve(b); } };
const fetched = [], started = [];
globalThis.fetch = u => { fetched.push(u); return Promise.resolve({ ok: true, arrayBuffer: () => { const a = new ArrayBuffer(8); a.file = u.replace(/^sounds\/|\.ogg$/g, ''); return Promise.resolve(a); } }); };
eval(require('fs').readFileSync(process.env.CORE_JS, 'utf8'));
const played = [], real = SH.sound;
const rec = (ev, o) => { const r = real(ev, o); if (r) played.push(ev); return r; };
Object.assign(rec, real); Object.defineProperty(rec, 'last', { get: () => real.last }); SH.sound = rec;
eval(require('fs').readFileSync(process.env.SOUNDS_JS, 'utf8'));
const tick = ms => new Promise(r => setTimeout(r, ms));
const out = x => { process.stdout.write(JSON.stringify(x)); process.exit(0); };
/* a dialog element: visible; fading out once close() starts its animation to opacity 0 */
const dialog = () => { const d = { isConnected: true, children: [], anims: [], checkVisibility: () => true, getAnimations() { return this.anims; } };
  d.close = () => { d.anims = [{ playState: 'running', effect: { getKeyframes: () => [{ opacity: 1 }, { opacity: 0 }] } }]; }; return d; };
const nothing = { closest: () => null };
"""


@unittest.skipUnless(shutil.which("node"), "needs Node.js")
class Wiring(unittest.TestCase):
    def run_js(self, body):
        code = WIRING + "(async () => {\n" + body + "\n})().catch(e => { console.log(String(e && e.stack || e)); process.exit(3); });"
        env = dict(os.environ, CORE_JS=os.path.join(UI, "js", "core.js"), SOUNDS_JS=os.path.join(UI, "js", "sounds.js"))
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        src = os.path.join(d, "wiring.js")
        with open(src, "w", encoding="utf-8") as fh:
            fh.write(code)
        r = subprocess.run(["node", src], capture_output=True, text=True, timeout=60, env=env)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return json.loads(r.stdout)

    def test_typing_in_the_palette_ticks_once_per_key(self):
        out = self.run_js(r"""
          const pal = { id: 'palIn', value: 'ab' }, other = { id: 'daQ', value: 'x' };
          const key = (k, x = {}) => fire('keydown', { key: k, target: pal, keyCode: 65, ...x });
          for (const k of 'stellarhub') { key(k); await tick(36); }
          const typed = played.filter(e => e === 'key_type').length;
          played.length = 0;
          key('Shift', { shiftKey: true }); await tick(36); key('Control', { ctrlKey: true }); await tick(36);
          key('k', { ctrlKey: true }); await tick(36); key('ArrowDown'); await tick(36); key('Enter'); await tick(36);
          key('a', { repeat: true }); await tick(36); key('a', { isComposing: true }); await tick(36); key('Process', { keyCode: 229 }); await tick(36);
          fire('keydown', { key: 'a', target: other }); await tick(36);
          fire('keydown', { key: 'a', target: pal, isTrusted: false }); await tick(36);
          const quiet = played.slice();
          key('Backspace'); await tick(36); pal.value = ''; key('Backspace'); await tick(36);
          const back = played.slice();
          played.length = 0;
          for (let i = 0; i < 10; i++) key('x');    // ten keys at once: the 30 ms gap keeps one
          out({ typed, quiet, back, burst: played.length, files: fetched.filter(f => /key/.test(f)) });
        """)
        self.assertEqual(out["typed"], 10)
        self.assertEqual(out["quiet"], [])
        self.assertEqual(out["back"], ["key_type"])          # Backspace on an empty field says nothing
        self.assertEqual(out["burst"], 1)
        self.assertEqual(out["files"], ["sounds/key_type.ogg"])

    def test_a_dialog_closes_with_one_panel_close_however_it_closes(self):
        out = self.run_js(r"""
          const res = {};
          const close = async (name, how) => {
            /* the dialog is open (its own panel_open has come and gone) */
            const d = dialog(); DIALOGS = [d]; fire('pointerdown', { target: nothing }); await tick(600); played.length = 0;
            fire('pointerdown', { target: nothing }); await tick(5);
            await how(d); await tick(500); res[name] = played.slice(); DIALOGS = []; await tick(200);
          };
          /* the backdrop: nothing clickable under the pointer, the dialog's own handler starts its fade */
          await close('backdrop', async d => { fire('click', { target: nothing }, () => d.close()); });
          /* its X: a button; the dialog closes in its handler, before the page-wide click sound */
          const x = { disabled: false, dataset: {}, matches: () => false, closest: () => x };
          await close('x', async d => { fire('click', { target: x }, () => d.close()); });
          /* Esc */
          await close('esc', async d => { fire('keydown', { key: 'Escape', target: nothing }, () => d.close()); });
          /* removed at once instead of fading */
          await close('removed', async d => { fire('click', { target: nothing }, () => { d.isConnected = false; DIALOGS = []; }); });
          /* a close that leads somewhere claims the click: the destination makes the sound */
          await close('claimed', async d => { fire('click', { target: x }, () => { SH.sound.claim(); d.close(); }); });
          out(res);
        """)
        for how in ("backdrop", "x", "esc", "removed"):
            self.assertEqual(out[how], ["panel_close"], how)
        self.assertEqual(out["claimed"], [])

    def test_a_module_change_plays_one_click_and_one_swoosh_that_rotates(self):
        out = self.run_js(r"""
          SH.sound.preload(['navigate']); await tick(30);
          const runs = [];
          for (let i = 0; i < 9; i++) {
            fire('pointerdown', { target: nothing }); started.length = 0; played.length = 0;
            SH.sound('navigate'); await tick(160);
            runs.push({ played: played.slice(), started: started.map(s => s.file), delayed: started.filter(s => s.when > 0).map(s => s.file) });
          }
          /* no gesture: no click and no swoosh either */
          await tick(1600); started.length = 0; SH.sound('navigate'); await tick(60); const quiet = started.length;
          /* intensity min: the transition is shorter, the swoosh stays */
          SH.state.settings.intensity = 'min'; fire('pointerdown', { target: nothing }); started.length = 0; SH.sound('navigate'); await tick(60);
          out({ runs, quiet, min: started.map(s => s.file), files: SH.sound.files('navigate') });
        """)
        sw = []
        for r in out["runs"]:
            self.assertEqual(r["played"], ["navigate"])
            self.assertEqual(len(r["started"]), 2, r)
            self.assertEqual(r["started"][0], "navigate_click")           # the click at once...
            self.assertTrue(r["started"][1].startswith("navigate_swoosh_"))
            self.assertEqual(r["delayed"], [r["started"][1]])            # ...the swoosh a moment later
            sw.append(r["started"][1])
        self.assertTrue(all(a != b for a, b in zip(sw, sw[1:])), sw)    # never the same twice in a row
        self.assertEqual(len(set(sw[:7])), 7, sw)                         # all seven take turns
        self.assertEqual(out["quiet"], 0)
        self.assertEqual(len(out["min"]), 2)
        self.assertEqual(out["files"], ["navigate_click"] + [f"navigate_swoosh_{i}" for i in range(1, 8)])


if __name__ == "__main__":
    unittest.main()
