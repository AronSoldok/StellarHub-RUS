"""Following long work from anywhere (2.0.0): the SH.activity registry in core.js (run in Node with a small stand-in for
the page), the taskbar progress helper (stellarhub/taskbar.py) and the tray notification click."""
import json
import os
import shutil
import subprocess
import threading
import time
import unittest
from unittest import mock

os.environ["STELLARHUB_NO_DIALOGS"] = "1"
os.environ["STELLARHUB_NO_SPLASH"] = "1"

from stellarhub import taskbar  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI = os.path.join(ROOT, "stellarhub", "ui")

# A stand-in for the page: just enough of window/document for core.js to load, an API whose calls are recorded, and a
# SH.toast that records what it shows. Each scenario is an async function body that ends by printing JSON.
PRELUDE = r"""
const calls = [], toasts = [];
globalThis.window = globalThis;
const noop = () => {};
const el = () => ({ dataset: {}, style: { setProperty: noop }, animate: () => ({ finished: Promise.resolve(), cancel: noop }), classList: { add: noop, remove: noop, toggle: noop } });
globalThis.document = { documentElement: el(), hidden: false, addEventListener: noop, querySelector: () => null, querySelectorAll: () => [] };
globalThis.matchMedia = () => ({ matches: false });
globalThis.addEventListener = noop;
globalThis.requestAnimationFrame = noop;
globalThis.setInterval = () => 0;
globalThis.MutationObserver = class { observe() {} };
globalThis.chrome = { webview: {} };
const api = new Proxy({}, { get: (_, name) => name === 'then' ? undefined : (...a) => { calls.push([name, ...a]); return name === 'engine_job' ? { ok: true, id: 'j' + calls.length } : true; } });
globalThis.pywebview = { api };
globalThis.SH = { t: (s, v) => v ? s.replace(/\{(\w+)\}/g, (m, k) => k in v ? v[k] : m) : s };
"""
LOAD = r"""
eval(require('fs').readFileSync(process.env.CORE_JS, 'utf8'));
SH.toast = (text, o = {}) => { SH.toast.lastAt = performance.now(); toasts.push({ text, kind: o.kind, silent: !!o.silent, action: o.action && o.action.label }); };
SH.go = (m, o) => { calls.push(['go', m, o || {}]); SH.state.view = m === 'settings' ? SH.state.view : m; SH.emit('view', { to: m }); };
const tick = ms => new Promise(r => setTimeout(r, ms));
const out = x => { process.stdout.write(JSON.stringify(x)); process.exit(0); };
"""


@unittest.skipUnless(shutil.which("node"), "needs Node.js")
class Registry(unittest.TestCase):
    def run_js(self, body):
        code = PRELUDE + LOAD + "(async () => {\n" + body + "\n})().catch(e => { console.log(String(e && e.stack || e)); process.exit(3); });"
        env = dict(os.environ, CORE_JS=os.path.join(UI, "js", "core.js"))
        r = subprocess.run(["node", "-e", code], capture_output=True, text=True, timeout=60, env=env)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        return json.loads(r.stdout)

    def test_progress_and_the_most_relevant_one(self):
        out = self.run_js(r"""
          const a = SH.activity.start('storage', { key: 'scan', label: 'Scanning' });
          a.progress(.384, 'C:\\Users');
          const b = SH.activity.start('storage', { key: 'dups', label: 'Looking for duplicates' });
          const same = SH.activity.start('storage', { key: 'scan' });
          out({ of: SH.activity.of('storage'), pct: SH.activity.pct(SH.activity.of('storage')), apct: SH.activity.pct(SH.activity.list()[1]),
                same: same === a, n: SH.activity.list().length, busy: SH.activity.busy('storage'), idle: SH.activity.busy('drivers') });
        """)
        self.assertEqual(out["of"]["key"], "dups")          # the newest one is shown
        self.assertEqual(out["of"]["count"], 2)
        self.assertEqual(out["pct"], "")                    # not measurable yet
        self.assertEqual(out["apct"], "38 %")
        self.assertTrue(out["same"])                        # the same key is the same activity
        self.assertEqual(out["n"], 2)
        self.assertTrue(out["busy"])
        self.assertFalse(out["idle"])

    def test_ending_elsewhere_tells_once_and_leaves_a_badge_until_visited(self):
        out = self.run_js(r"""
          SH.state.view = 'home';
          const h = SH.activity.start('optimizer', { label: 'Analyzing', go: { tab: 'overview' } });
          h.progress(.5, 'Reading services');
          const told = h.end({ ok: true, summary: '4.6 GB can be freed' });
          const again = h.end({ ok: true });
          const badge = SH.activity.done('optimizer');
          SH.state.view = 'optimizer'; SH.emit('view', { to: 'optimizer' });
          out({ told, again, badge, after: SH.activity.done('optimizer'), toasts, open: h.open });
        """)
        self.assertTrue(out["told"])
        self.assertFalse(out["again"])
        self.assertEqual(out["badge"]["summary"], "4.6 GB can be freed")
        self.assertTrue(out["badge"]["ok"])
        self.assertIsNone(out["after"])                     # visiting the module clears it
        self.assertEqual(len(out["toasts"]), 1)
        self.assertEqual(out["toasts"][0]["text"], "Super Optimizer finished: 4.6 GB can be freed")
        self.assertEqual(out["toasts"][0]["kind"], "success")
        self.assertEqual(out["toasts"][0]["action"], "View")
        self.assertFalse(out["open"])

    def test_no_notice_when_looking_at_it_cancelled_or_in_the_background(self):
        out = self.run_js(r"""
          SH.state.view = 'updater';
          const here = SH.activity.start('updater').end({ ok: true, summary: 'x' });
          SH.state.view = 'home';
          const cancelled = SH.activity.start('updater').end({ cancelled: true });
          const quiet = SH.activity.start('updater', { user: false }).end({ ok: true });
          out({ here, cancelled, quiet, toasts, done: SH.activity.doneAll() });
        """)
        self.assertFalse(out["here"])
        self.assertFalse(out["cancelled"])
        self.assertFalse(out["quiet"])
        self.assertEqual(out["toasts"], [])
        self.assertEqual(out["done"], [])

    def test_errors_and_the_view_action(self):
        out = self.run_js(r"""
          SH.state.view = 'home';
          SH.activity.start('drivers', { go: { tab: 'updates' } }).end({ ok: false, error: new Error('no network') });
          const d = SH.activity.done('drivers');
          SH.activity.open('drivers', d.go);
          out({ toasts, d, go: calls.filter(c => c[0] === 'go'), after: SH.activity.done('drivers') });
        """)
        self.assertEqual(out["toasts"][0]["text"], "Driver Updater could not finish: no network")
        self.assertEqual(out["toasts"][0]["kind"], "error")
        self.assertFalse(out["d"]["ok"])
        self.assertEqual(out["go"], [["go", "drivers", {"tab": "updates"}]])
        self.assertIsNone(out["after"])

    def test_hidden_window_uses_the_tray_notification(self):
        out = self.run_js(r"""
          SH.state.view = 'storage'; document.hidden = true;   // even on its own module: nobody is looking
          SH.activity.start('storage', { go: { tab: 'map' } }).end({ ok: true, summary: '312 GB used' });
          await tick(30);
          out({ toasts, notes: calls.filter(c => c[0] === 'notify_activity'), badge: SH.activity.done('storage') });
        """)
        self.assertEqual(out["toasts"], [])
        self.assertEqual(out["notes"], [["notify_activity", "Storage Checker finished: 312 GB used", "storage", "map"]])
        self.assertIsNone(out["badge"])                     # it is the current module: no badge on its icon

    def test_python_says_the_window_is_hidden(self):
        """WebView2 can keep document.visibilityState "visible" in the tray: Python's 'window' event counts too."""
        out = self.run_js(r"""
          SH.state.view = 'home';
          SH.emit('window', { shown: false });
          SH.activity.start('drivers', { go: { tab: 'updates' } }).end({ ok: false, error: 'offline' });
          await tick(30);
          const hidden = { toasts: toasts.length, notes: calls.filter(c => c[0] === 'notify_activity') };
          SH.emit('window', { shown: true });
          SH.activity.start('drivers').end({ ok: true });
          out({ hidden, toasts: toasts.map(t => t.text), badge: !!SH.activity.done('drivers') });
        """)
        self.assertEqual(out["hidden"]["toasts"], 0)
        self.assertEqual(out["hidden"]["notes"], [["notify_activity", "Driver Updater could not finish: offline", "drivers", "updates"]])
        self.assertEqual(out["toasts"], ["Driver Updater finished."])
        self.assertTrue(out["badge"])

    def test_taskbar_aggregate(self):
        out = self.run_js(r"""
          await tick(20);
          const seen = () => calls.filter(c => c[0] === 'taskbar_progress').map(c => [c[1], c[2]]);
          const a = SH.activity.start('storage'); a.progress(.2);
          const b = SH.activity.start('drivers'); b.progress(.6);
          await tick(150);
          const both = seen().pop();
          const c = SH.activity.start('updater');          // not measurable: the whole button is indeterminate
          await tick(150);
          const ind = seen().pop();
          c.end({ cancelled: true }); a.end({ ok: true }); b.end({ ok: false, error: 'x' });
          await tick(30);
          const err = seen().pop();
          out({ both, ind, err });
        """)
        self.assertEqual(self.round(out["both"]), ["normal", 0.4])
        self.assertEqual(out["ind"][0], "indeterminate")
        self.assertEqual(out["err"], ["error", 1])

    @staticmethod
    def round(x):
        return [x[0], round(x[1], 2)]

    def test_user_started_jobs_feed_it_by_themselves(self):
        out = self.run_js(r"""
          SH.state.view = 'home';
          const p = SH.job('drivers', 'search', [], { sound: 'task' });
          await tick(20);
          const jid = calls.filter(c => c[0] === 'engine_job').length && 'j' + (calls.findIndex(c => c[0] === 'engine_job') + 1);
          SH.emit('job', { id: jid, kind: 'progress', pct: .25, text: 'Asking Windows Update' });
          await tick(120);
          const mid = SH.activity.of('drivers');
          SH.emit('job', { id: jid, kind: 'end', state: 'done', result: { n: 3 } });
          await p;
          await tick(400);
          // a background job (no sound) and a job inside the module's own activity add nothing
          const own = SH.activity.start('storage', { label: 'Scanning' });
          SH.job('storage', 'scan', [], { sound: 'scan' }); SH.job('privacy', 'protection');
          await tick(20);
          out({ mid, after: SH.activity.of('drivers'), toasts, list: SH.activity.list().map(a => a.mod) });
        """)
        self.assertEqual(out["mid"]["text"], "Asking Windows Update")
        self.assertAlmostEqual(out["mid"]["pct"], 0.25)
        self.assertIsNone(out["after"])
        self.assertEqual([t["text"] for t in out["toasts"]], ["Driver Updater finished."])
        self.assertEqual(out["list"], ["storage"])

    def test_the_modules_own_toast_is_enough_for_a_followed_job(self):
        out = self.run_js(r"""
          SH.state.view = 'home';
          const p = SH.job('drivers', 'install', [], { sound: 'task' });
          await tick(20);
          const jid = 'j' + (calls.findIndex(c => c[0] === 'engine_job') + 1);
          SH.emit('job', { id: jid, kind: 'end', state: 'done', result: {} });
          await p; SH.toast('2 drivers installed.', { kind: 'success' });
          await tick(400);
          out({ toasts: toasts.map(t => t.text), badge: !!SH.activity.done('drivers') });
        """)
        self.assertEqual(out["toasts"], ["2 drivers installed."])
        self.assertTrue(out["badge"])


class _FakeCom:
    def __init__(self, log, fail=0):
        self.log, self.fail = log, fail

    def apply(self, hwnd, state, value):
        if self.fail:
            self.fail -= 1
            raise OSError("E_FAIL")
        self.log.append((hwnd, state, value))

    def release(self):
        self.log.append("released")


def wait_for(cond, timeout=3.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.01)
    return False


class TaskbarHelper(unittest.TestCase):
    def test_normalize(self):
        self.assertEqual(taskbar.normalize("normal", 0.4567), ("normal", 0.457))
        self.assertEqual(taskbar.normalize("normal", 7), ("normal", 1.0))
        self.assertEqual(taskbar.normalize("normal", "x"), ("normal", 0.0))
        self.assertEqual(taskbar.normalize("normal", float("nan")), ("normal", 0.0))
        self.assertEqual(taskbar.normalize("indeterminate", 0.5), ("indeterminate", 0.0))
        self.assertEqual(taskbar.normalize("explode", 0.5), ("none", 0.0))

    def test_applies_the_latest_wish_on_its_own_thread(self):
        log = []
        tb = taskbar.TaskbarProgress(lambda: 42, factory=lambda: _FakeCom(log))
        self.assertTrue(tb.set("indeterminate"))
        self.assertTrue(wait_for(lambda: log))
        for v in (0.1, 0.2, 0.3):
            tb.set("normal", v)
        self.assertTrue(wait_for(lambda: log[-1] == (42, "normal", 0.3)))
        tb.stop()
        self.assertTrue(wait_for(lambda: log[-1] == "released"))

    def test_no_com_object_turns_it_off_quietly(self):
        def boom():
            raise OSError("class not registered")
        tb = taskbar.TaskbarProgress(lambda: 42, factory=boom)
        with mock.patch("builtins.print"):
            self.assertTrue(tb.set("normal", 0.5))
            self.assertTrue(wait_for(lambda: tb.dead))
        self.assertFalse(tb.set("normal", 0.6))

    def test_no_window_handle_waits_for_reapply(self):
        log, h = [], {"v": None}
        tb = taskbar.TaskbarProgress(lambda: h["v"], factory=lambda: _FakeCom(log))
        tb.set("normal", 0.5)
        time.sleep(0.15)
        self.assertEqual(log, [])
        h["v"] = 7
        tb.reapply()
        self.assertTrue(wait_for(lambda: log == [(7, "normal", 0.5)]))
        tb.reapply()  # the button was made again: the same state goes out once more
        self.assertTrue(wait_for(lambda: len(log) == 2))
        tb.stop()

    def test_a_handle_function_that_raises_is_harmless(self):
        def bad():
            raise RuntimeError("cross-thread")
        log = []
        tb = taskbar.TaskbarProgress(bad, factory=lambda: _FakeCom(log))
        tb.set("normal", 0.5)
        time.sleep(0.15)
        self.assertEqual(log, [])
        self.assertFalse(tb.dead)
        tb.stop()

    def test_repeated_failures_turn_it_off(self):
        log = []
        tb = taskbar.TaskbarProgress(lambda: 1, factory=lambda: _FakeCom(log, fail=99))
        with mock.patch("builtins.print"):
            for i in range(20):
                tb.set("normal", i / 20)
                time.sleep(0.01)
            self.assertTrue(wait_for(lambda: tb.dead))
        self.assertFalse(tb.set("none"))

    def test_one_failure_is_skipped(self):
        log = []
        tb = taskbar.TaskbarProgress(lambda: 1, factory=lambda: _FakeCom(log, fail=1))
        tb.set("normal", 0.2)
        time.sleep(0.1)
        tb.set("normal", 0.3)
        self.assertTrue(wait_for(lambda: (1, "normal", 0.3) in log))
        self.assertFalse(tb.dead)
        tb.stop()

    @unittest.skipUnless(os.name == "nt", "Windows only")
    def test_the_real_com_object_accepts_a_window_that_is_not_there(self):
        c = taskbar.ComTaskbar()
        try:
            c.apply(0, "none", 0)
        except OSError:
            pass  # refused is fine too: the worker skips it
        finally:
            c.release()


class ApiMethods(unittest.TestCase):
    def make(self):
        from stellarhub.api import Api
        a = Api()
        a._window = mock.Mock()
        return a

    def test_taskbar_progress_never_raises(self):
        a = self.make()
        with mock.patch("stellarhub.taskbar.TaskbarProgress", side_effect=RuntimeError("no")), mock.patch("builtins.print"):
            self.assertFalse(a.taskbar_progress("normal", 0.5))

    def test_hidden_window_has_no_handle(self):
        a = self.make()
        a._visible = False
        self.assertIsNone(a._taskbar_hwnd())
        a._visible = True
        a._window.native.Handle.ToInt64.return_value = 1234
        self.assertEqual(a._taskbar_hwnd(), 1234)

    def test_notify_activity_opens_the_module(self):
        a = self.make()
        a._tray = mock.Mock()
        sent = []
        a._js = lambda code, *x, **k: sent.append(code)
        a.show_main = mock.Mock()
        self.assertTrue(a.notify_activity("Storage Checker finished.", "storage", "map"))
        text, title = a._tray.notify.call_args[0]
        self.assertEqual((text, title), ("Storage Checker finished.", "StellarHub"))
        a._tray.notify.call_args[1]["on_click"]()
        a.show_main.assert_called_once()
        self.assertEqual(sent, ['window.SH && SH.activity && SH.activity.open("storage", {tab: "map"})'])

    def test_the_page_hears_when_the_window_is_hidden_or_shown(self):
        a = self.make()
        sent = []
        a._js = lambda code, *x, **k: sent.append(code)
        a._sampler = None
        with mock.patch("stellarhub.winmgr.wv_visible"):
            a._visible, a._minimized = True, False
            a._tele_refresh()
            a._tele_refresh()                      # no change: nothing more
            a._minimized = True
            a._tele_refresh()
            a._minimized, a._visible = False, False
            a._tele_refresh()                      # still out of sight
            a._visible = True
            a._tele_refresh()
        shown = [c for c in sent if "SH.emit('window'" in c]
        self.assertEqual(len(shown), 3)
        self.assertIn("shown: true", shown[0])
        self.assertIn("shown: false", shown[1])
        self.assertIn("shown: true", shown[2])

    def test_notify_activity_rejects_odd_names(self):
        a = self.make()
        a._tray = mock.Mock()
        sent = []
        a._js = lambda code, *x, **k: sent.append(code)
        a.show_main = mock.Mock()
        a.notify_activity("x", "storage'); alert(1); ('", "map")
        a._tray.notify.call_args[1]["on_click"]()
        self.assertEqual(sent, [])
        a._tray = None
        self.assertFalse(a.notify_activity("x", "storage"))


class TrayClick(unittest.TestCase):
    def test_a_click_on_the_balloon_runs_the_last_notifications_action(self):
        from stellarhub import tray

        class Base:
            _icon_handle = 1

            def __init__(self):
                self.seen = []

            def _on_notify(self, wparam, lparam):
                self.seen.append(lparam)

        icon = tray._crisp_icon_class(Base)()
        done = threading.Event()
        icon._sh_click = done.set
        icon._on_notify(0, 0x405)          # NIN_BALLOONUSERCLICK
        self.assertTrue(done.wait(2))
        icon._on_notify(0, 0x0202)         # WM_LBUTTONUP: pystray's own handling
        self.assertEqual(icon.seen, [0x0202])

    def test_notify_keeps_the_click_action(self):
        from stellarhub import tray
        t = tray.Tray(mock.Mock())
        t.icon = mock.Mock()
        fn = lambda: None  # noqa: E731
        t.notify("done", on_click=fn)
        self.assertIs(t.icon._sh_click, fn)
        t.icon.notify.assert_called_once_with("done", "StellarHub")
        t.notify("plain")
        self.assertIsNone(t.icon._sh_click)


if __name__ == "__main__":
    unittest.main()
