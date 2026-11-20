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


def sound_events():
    """The event names in SOUND_EV (core.js)."""
    block = re.search(r"const SOUND_EV = \{(.*?)\n\};", read("js", "core.js"), re.S).group(1)
    return re.findall(r"(\w+): \{ c: '", block)


class SoundFiles(unittest.TestCase):
    def test_every_event_has_its_file_and_credit(self):
        evs = sound_events()
        self.assertEqual(len(evs), 35)
        files = {f[:-4] for f in os.listdir(SOUNDS) if f.endswith(".ogg")}
        self.assertEqual(set(evs), files)
        with open(os.path.join(SOUNDS, "CREDITS.json"), encoding="utf-8") as fh:
            credits = json.load(fh)
        self.assertEqual({c["event"] for c in credits}, files)
        for c in credits:
            self.assertEqual(c["license"], "CC0-1.0", c["event"])
        hover = next(c for c in credits if c["event"] == "hover")
        self.assertIn("freesound.org/people/unfa/sounds/565131", hover["sourceUrl"])

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
        keys |= {k for k in (a or b for a, b in self.KEYS.findall(about)) if "Orbital" in k}
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


if __name__ == "__main__":
    unittest.main()
