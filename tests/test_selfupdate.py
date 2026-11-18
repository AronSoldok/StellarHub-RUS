"""StellarHub's own updates (engine/selfupdate.py). Nothing is installed: a local web server plays GitHub."""
import functools
import hashlib
import http.server
import json
import os
import shutil
import tempfile
import threading
import unittest
from unittest import mock

from stellarhub.engine import selfupdate as su


def release(ver, base, sha_ok=True, draft=False, name=None):
    name = name or f"StellarHub-Setup-{ver}.exe"
    return {"tag_name": "v" + ver, "draft": draft, "prerelease": False, "body": "### New\n- thing",
            "html_url": f"{base}/tag/v{ver}", "published_at": "2026-11-18T00:00:00Z",
            "assets": [{"name": name, "size": 11, "browser_download_url": f"{base}/{name}"},
                       {"name": name + ".sha256", "size": 90, "browser_download_url": f"{base}/{name}.sha256"}]}


class Versions(unittest.TestCase):
    def test_compare(self):
        self.assertTrue(su.newer("0.5.0", "0.4.0"))
        self.assertTrue(su.newer("v0.10.0", "0.9.9"))
        self.assertTrue(su.newer("1.0", "0.99.99"))
        self.assertFalse(su.newer("0.4.0", "0.4.0"))
        self.assertFalse(su.newer("0.3.9", "0.4.0"))
        self.assertFalse(su.newer("garbage", "0.4.0"))

    def test_pick_needs_the_installer_and_its_hash(self):
        base = "https://github.com/x/y/releases/download/v0.5.0"
        info = su.pick(release("0.5.0", base))
        self.assertEqual(info["ver"], "0.5.0")
        self.assertTrue(info["setup"]["url"].endswith("StellarHub-Setup-0.5.0.exe"))
        rel = release("0.5.0", base)
        rel["assets"] = rel["assets"][:1]  # no .sha256
        self.assertIsNone(su.pick(rel))
        self.assertIsNone(su.pick(release("0.5.0", base, draft=True)))
        # an installer for another version than the tag is not taken
        self.assertIsNone(su.pick(release("0.5.0", base, name="StellarHub-Setup-0.4.0.exe")))

    def test_pick_refuses_plain_http(self):
        with mock.patch.dict(os.environ, {"STELLARHUB_UPDATE_URL": ""}):
            self.assertIsNone(su.pick(release("0.5.0", "http://example.com")))


class Serve:
    def __init__(self, files):
        self.dir = tempfile.mkdtemp()
        for n, data in files.items():
            with open(os.path.join(self.dir, n), "wb") as fh:
                fh.write(data)

        class Q(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *a):
                pass
        self.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Q, directory=self.dir))
        self.base = f"http://127.0.0.1:{self.srv.server_address[1]}"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def close(self):
        self.srv.shutdown()
        shutil.rmtree(self.dir, ignore_errors=True)


class CheckAndDownload(unittest.TestCase):
    def setUp(self):
        self.payload = b"fake-setup!"
        self.tmp = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def serve(self, sha):
        s = Serve({"StellarHub-Setup-9.9.9.exe": self.payload,
                   "StellarHub-Setup-9.9.9.exe.sha256": f"{sha}  StellarHub-Setup-9.9.9.exe\n".encode()})
        with open(os.path.join(s.dir, "latest.json"), "w", encoding="utf-8") as fh:
            json.dump(release("9.9.9", s.base), fh)
        self.addCleanup(s.close)
        return s

    def env(self, s):
        return mock.patch.dict(os.environ, {"STELLARHUB_UPDATE_URL": s.base + "/latest.json",
                                            "STELLARHUB_UPDATE_DIR": self.tmp, "LOCALAPPDATA": self.tmp})

    def test_check_reports_a_newer_version(self):
        s = self.serve(hashlib.sha256(self.payload).hexdigest())
        with self.env(s):
            r = su.check()
        self.assertTrue(r["ok"])
        self.assertTrue(r["newer"])
        self.assertEqual(r["latest"], "9.9.9")
        self.assertIn("thing", r["notes"])

    def test_check_offline_is_not_an_exception(self):
        with mock.patch.dict(os.environ, {"STELLARHUB_UPDATE_URL": "http://127.0.0.1:9/none.json"}):
            r = su.check()
        self.assertFalse(r["ok"])

    def updater(self, sha):
        s = self.serve(sha)
        with self.env(s), mock.patch.object(su, "FROZEN", True), mock.patch.object(su, "per_machine", lambda: False), \
                mock.patch.object(su, "_app_running", lambda: False), mock.patch.object(su.subprocess, "Popen") as popen:
            code = su.run_updater()
            st = su.state()
        return code, st, popen

    def test_updater_verifies_and_hands_over_to_the_installer(self):
        code, st, popen = self.updater(hashlib.sha256(self.payload).hexdigest())
        self.assertEqual(code, 0)
        self.assertEqual(st["st"], "installing")
        args = popen.call_args[0][0]
        self.assertTrue(args[0].endswith("StellarHub-Setup-9.9.9.exe"))
        self.assertIn("/VERYSILENT", args)
        self.assertIn("/CURRENTUSER", args)  # installed for one user: the update too
        self.assertTrue(any(a.startswith("/SELFUPDATE=") for a in args))

    def test_updater_refuses_a_file_that_does_not_match_its_hash(self):
        code, st, popen = self.updater("0" * 64)
        self.assertEqual(st["st"], "failed")
        self.assertEqual(st["why"], "hash")
        popen.assert_not_called()
        self.assertFalse(any(f.endswith(".exe") for f in os.listdir(self.tmp)))

    def test_updater_does_nothing_when_up_to_date(self):
        s = Serve({})
        self.addCleanup(s.close)
        with open(os.path.join(s.dir, "latest.json"), "w", encoding="utf-8") as fh:
            json.dump(release(su.VERSION, s.base), fh)
        with self.env(s), mock.patch.object(su, "FROZEN", True), mock.patch.object(su, "per_machine", lambda: False), \
                mock.patch.object(su.subprocess, "Popen") as popen:
            self.assertEqual(su.run_updater(), 0)
            self.assertEqual(su.state()["st"], "uptodate")
        popen.assert_not_called()


class AfterUpdate(unittest.TestCase):
    def test_note_is_read_once(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        with mock.patch.dict(os.environ, {"APPDATA": tmp}), mock.patch.object(su, "spawn_reopener"):
            su.finish(su.VERSION, "privacy")
            n = su.after_update()
            self.assertTrue(n["ok"])
            self.assertEqual(n["route"], "privacy")
            self.assertIsNone(su.after_update())


if __name__ == "__main__":
    unittest.main()
