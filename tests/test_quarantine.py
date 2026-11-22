"""Quarantine: move, restore and delete, on temporary folders and HKCU\\Software\\MiniRevoTest."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import winreg
from unittest import mock

from stellarhub.engine.removal import paths, quarantine, registry
from stellarhub.engine.removal.registry import RegRef

TEST_KEY = r"Software\MiniRevoTest"
RUN = r"Software\Microsoft\Windows\CurrentVersion\Run"


def make_tree(base):
    os.makedirs(os.path.join(base, "sub"), exist_ok=True)
    with open(os.path.join(base, "a.txt"), "w") as f:
        f.write("hola")
    with open(os.path.join(base, "sub", "b.bin"), "wb") as f:
        f.write(b"\x00\x01" * 1000)


class Quarantine(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="mrq_")
        self.app = os.path.join(self.tmp, "MiniRevoTestApp")
        make_tree(self.app)
        self.file = os.path.join(self.tmp, "MiniRevoTestApp.lnk")
        with open(self.file, "w") as f:
            f.write("x")
        k = winreg.CreateKey(winreg.HKEY_CURRENT_USER, TEST_KEY + r"\App\Deep")
        winreg.SetValueEx(k, "n", 0, winreg.REG_DWORD, 7)
        winreg.CloseKey(k)
        k = winreg.CreateKey(winreg.HKEY_CURRENT_USER, TEST_KEY + r"\Vals")
        winreg.SetValueEx(k, "bin", 0, winreg.REG_BINARY, b"\x01\x02\x03")
        winreg.SetValueEx(k, "multi", 0, winreg.REG_MULTI_SZ, ["a", "b"])
        winreg.CloseKey(k)
        with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, RUN, 0, winreg.KEY_SET_VALUE) as k:  # a fresh profile (CI) may not have it
            winreg.SetValueEx(k, "MiniRevoTestRun", 0, winreg.REG_SZ, r'"C:\nope\x.exe"')
        self.prog = {"id": "test", "name": "MiniRevo Test App", "location": self.app}

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)
        try:
            registry.delete_tree(RegRef("HKCU", TEST_KEY))
        except OSError:
            pass
        try:
            registry.delete_value(RegRef("HKCU", RUN, 0, "MiniRevoTestRun"))
        except OSError:
            pass

    def items(self):
        return [
            {"kind": "folder", "target": self.app, "display": self.app},
            {"kind": "file", "target": self.file, "display": self.file},
            {"kind": "regkey", "target": RegRef("HKCU", TEST_KEY + r"\App").to_str(), "display": "k"},
            {"kind": "regvalue", "target": RegRef("HKCU", TEST_KEY + r"\Vals", 0, "bin").to_str(), "display": "v"},
            {"kind": "regvalue", "target": RegRef("HKCU", TEST_KEY + r"\Vals", 0, "multi").to_str(), "display": "m"},
            {"kind": "regvalue", "target": RegRef("HKCU", RUN, 0, "MiniRevoTestRun").to_str(), "display": "run"},
        ]

    def test_quarantine_and_restore_roundtrip(self):
        r = quarantine.remove(self.prog, self.items(), [self.prog])
        self.assertEqual(r["failed"], 0, r["errors"])
        self.assertEqual(r["ok"], 6)
        self.assertFalse(os.path.exists(self.app))
        self.assertFalse(os.path.exists(self.file))
        self.assertFalse(registry.key_exists(RegRef("HKCU", TEST_KEY + r"\App")))
        self.assertIsNone(registry.get_value(winreg.HKEY_CURRENT_USER, RUN, "MiniRevoTestRun"))
        s = next(x for x in quarantine.sessions() if x["id"] == r["session"])
        self.assertTrue(s["restorable"])
        self.assertEqual(s["count"], 6)

        rr = quarantine.restore(r["session"])
        self.assertEqual(rr["failed"], 0, rr["errors"])
        with open(os.path.join(self.app, "a.txt")) as f:
            self.assertEqual(f.read(), "hola")
        self.assertEqual(os.path.getsize(os.path.join(self.app, "sub", "b.bin")), 2000)
        self.assertTrue(os.path.exists(self.file))
        self.assertEqual(registry.get_value(winreg.HKEY_CURRENT_USER, TEST_KEY + r"\App\Deep", "n"), 7)
        self.assertEqual(registry.get_value(winreg.HKEY_CURRENT_USER, TEST_KEY + r"\Vals", "bin"), b"\x01\x02\x03")
        self.assertEqual(registry.get_value(winreg.HKEY_CURRENT_USER, TEST_KEY + r"\Vals", "multi"), ["a", "b"])
        self.assertEqual(registry.get_value(winreg.HKEY_CURRENT_USER, RUN, "MiniRevoTestRun"), r'"C:\nope\x.exe"')
        quarantine.delete_session(r["session"])

    def test_delete_mode_not_restorable(self):
        r = quarantine.remove(self.prog, self.items()[:2], [self.prog], mode="delete")
        self.assertEqual(r["ok"], 2)
        self.assertFalse(os.path.exists(self.app))
        s = next(x for x in quarantine.sessions() if x["id"] == r["session"])
        self.assertFalse(s["restorable"])
        quarantine.delete_session(r["session"])

    def test_protected_items_are_skipped_even_if_requested(self):
        bad = [{"kind": "folder", "target": paths.kf("Documents"), "display": "docs"},
               {"kind": "folder", "target": paths.kf("Windows"), "display": "win"},
               {"kind": "regkey", "target": RegRef("HKCU", r"Software\Microsoft").to_str(), "display": "ms"},
               {"kind": "regkey", "target": RegRef("HKCU", "Software").to_str(), "display": "sw"}]
        r = quarantine.remove(self.prog, bad, [self.prog])
        self.assertEqual(r["skipped"], 4)
        self.assertEqual(r["ok"], 0)
        self.assertTrue(os.path.isdir(paths.kf("Documents")))
        self.assertTrue(registry.key_exists(RegRef("HKCU", r"Software\Microsoft")))
        quarantine.delete_session(r["session"])

    def test_folder_of_other_installed_program_is_skipped(self):
        other = {"id": "o", "name": "Other", "location": os.path.join(self.app, "sub")}
        r = quarantine.remove(self.prog, self.items()[:1], [self.prog, other])
        self.assertEqual(r["skipped"], 1)
        self.assertTrue(os.path.isdir(self.app))
        quarantine.delete_session(r["session"])

    def test_locked_file_does_not_abort(self):
        locked = open(os.path.join(self.app, "sub", "b.bin"), "rb")  # without FILE_SHARE_DELETE
        try:
            r = quarantine.remove(self.prog, self.items()[:2], [self.prog])
        finally:
            locked.close()
        # the rest was moved; the locked one stays (or is scheduled for reboot if permissions allow)
        self.assertFalse(os.path.exists(os.path.join(self.app, "a.txt")))
        self.assertFalse(os.path.exists(self.file))
        quarantine.delete_session(r["session"])

    def test_missing_items_are_not_errors(self):
        shutil.rmtree(self.app)
        r = quarantine.remove(self.prog, self.items()[:1], [self.prog])
        self.assertEqual(r["failed"], 0)
        quarantine.delete_session(r["session"])

    def test_two_sessions_in_the_same_second_do_not_collide(self):
        a = quarantine.remove(self.prog, self.items()[1:2], [self.prog])   # the .lnk
        b = quarantine.remove(self.prog, self.items()[3:4], [self.prog])   # a registry value
        try:
            self.assertNotEqual(a["session"], b["session"])
            ids = {s["id"]: s for s in quarantine.sessions()}
            self.assertEqual(ids[a["session"]]["count"], 1)
            self.assertEqual(ids[b["session"]]["count"], 1)
            quarantine.restore(a["session"])
            self.assertTrue(os.path.exists(self.file))  # the first session's items can still be restored
        finally:
            for s in (a["session"], b["session"]):
                quarantine.delete_session(s)


class NoUndoNoDelete(unittest.TestCase):
    """Tasks and services are deleted only with the backup that brings them back, and a restore with nothing to
    restore from is a failure, not a success. Everything system-facing is mocked."""
    prog = {"id": "t", "name": "MiniRevo Test App", "location": ""}

    def _run_forbidden(self, *a, **k):
        raise AssertionError("must not run anything on the system")

    def test_task_without_its_xml_is_not_deleted(self):
        with mock.patch.object(quarantine.system, "export_task", return_value=None), \
                mock.patch.object(quarantine.system, "delete_task", side_effect=self._run_forbidden) as dele:
            r = quarantine.remove(self.prog, [{"kind": "task", "target": r"\MiniRevoTestTask"}], [])
        quarantine.delete_session(r["session"])
        self.assertEqual((r["ok"], r["failed"]), (0, 1))
        dele.assert_not_called()

    def test_restoring_a_task_with_no_backup_is_a_failure(self):
        with mock.patch.object(quarantine.system, "export_task", return_value="<Task/>"), \
                mock.patch.object(quarantine.system, "delete_task", return_value=(0, "")):
            r = quarantine.remove(self.prog, [{"kind": "task", "target": r"\MiniRevoTestTask"}], [])
        self.addCleanup(quarantine.delete_session, r["session"])
        self.assertEqual(r["ok"], 1)
        mf = os.path.join(quarantine._session_dir(r["session"]), "manifest.json")
        with open(mf, encoding="utf-8") as f:
            m = json.load(f)
        m["items"][0].pop("task_file")            # a session where the task's XML could not be saved
        quarantine._save(m)
        with mock.patch.object(quarantine.system, "run", side_effect=self._run_forbidden):
            rr = quarantine.restore(r["session"])
        self.assertEqual((rr["ok"], rr["failed"]), (0, 1))

    def test_service_is_not_deleted_when_its_backup_fails(self):
        with mock.patch.object(quarantine.safety, "service_rule", return_value=None), \
                mock.patch.object(quarantine.registry, "export_key", return_value=False), \
                mock.patch.object(quarantine.registry, "key_exists", return_value=True), \
                mock.patch.object(quarantine.system, "delete_service", side_effect=self._run_forbidden) as dele:
            r = quarantine.remove(self.prog, [{"kind": "service", "target": "MiniRevoTestSvc"}], [])
        quarantine.delete_session(r["session"])
        self.assertEqual((r["ok"], r["failed"]), (0, 1))
        dele.assert_not_called()

    def test_a_removed_link_is_not_offered_for_restore(self):
        tmp = tempfile.mkdtemp(prefix="mrq_link_")
        self.addCleanup(shutil.rmtree, tmp, True)
        target, link = os.path.join(tmp, "target"), os.path.join(tmp, "MiniRevoTestLink")
        os.makedirs(target)
        subprocess.run(["cmd", "/c", "mklink", "/J", link, target], capture_output=True)
        if not paths.is_reparse_point(link):
            self.skipTest("could not make a junction")
        r = quarantine.remove(self.prog, [{"kind": "folder", "target": link}], [])
        self.addCleanup(quarantine.delete_session, r["session"])
        self.assertEqual(r["ok"], 1)
        self.assertTrue(os.path.isdir(target))
        s = next(x for x in quarantine.sessions() if x["id"] == r["session"])
        self.assertFalse(s["items"][0]["restorable"])
        self.assertFalse(s["restorable"])


class RegImportOutput(unittest.TestCase):
    def test_a_localized_message_in_the_console_code_page_does_not_turn_success_into_an_error(self):
        # reg.exe is replaced by a child that answers like a German/French Windows does (OEM bytes, exit code 0)
        import sys
        real = subprocess.run

        def fake(args, **kw):
            code = "import sys; sys.stdout.buffer.write(b'Vorgang erfolgreich \\x81berpr\\x81ft.\\r\\n')"
            return real([sys.executable, "-c", code], **kw)
        with mock.patch.object(registry.subprocess, "run", fake):
            ok, out = registry.import_reg(r"C:\nope\x.reg")
        self.assertTrue(ok)
        self.assertIn("Vorgang", out)

    def test_a_hung_reg_exe_is_given_up(self):
        tmp = tempfile.mkdtemp(prefix="mrq_reg_")
        self.addCleanup(shutil.rmtree, tmp, True)
        out = os.path.join(tmp, "k.reg")

        def hung(args, **kw):
            self.assertIn("timeout", kw)
            with open(out, "w") as fh:          # half-written before it hung
                fh.write("Windows Registry Editor")
            raise subprocess.TimeoutExpired(args, kw["timeout"])
        with mock.patch.object(registry.subprocess, "run", hung):
            self.assertFalse(registry.export_key(RegRef("HKCU", TEST_KEY), out))
            self.assertFalse(os.path.exists(out))
            ok, msg = registry.import_reg(out)
        self.assertFalse(ok)
        self.assertTrue(msg)


class TaskExport(unittest.TestCase):
    def test_the_xml_is_read_in_utf8_and_the_name_never_reaches_cmd(self):
        xml = '<?xml version="1.0" encoding="UTF-16"?>\r\n<Task><Exec><Command>C:\\Users\\张伟\\app.exe</Command></Exec></Task>'
        seen = {}

        def fake(cmd, **kw):
            seen["cmd"], seen["env"] = cmd, kw.get("env") or {}
            return subprocess.CompletedProcess(cmd, 0, xml.encode("utf-8"), b"")
        name = r"\Vendor\Update & Sync"
        with mock.patch.object(quarantine.system.subprocess, "run", fake):
            got = quarantine.system.export_task(name)
        self.assertEqual(got, xml)
        self.assertIn("chcp 65001", seen["cmd"])       # the console speaks UTF-8, not the OEM code page
        self.assertNotIn(name, seen["cmd"])            # "&" in the name is never parsed by cmd
        self.assertEqual(seen["env"].get("SH_TASK_NAME"), name)
        with mock.patch.object(quarantine.system.subprocess, "run",
                               return_value=subprocess.CompletedProcess("", 1, b"", b"ERROR")):
            self.assertIsNone(quarantine.system.export_task(name))


class EnvPath(unittest.TestCase):
    def test_every_copy_comes_back_in_its_place(self):
        parts = [r"C:\Windows", r"C:\Tool\bin", r"C:\Other", r"c:\tool\BIN\\", r"C:\Last"]
        kept, removed = quarantine._path_without(parts, r"C:\Tool\bin")
        self.assertEqual(kept, [r"C:\Windows", r"C:\Other", r"C:\Last"])
        self.assertEqual(len(removed), 2)
        self.assertEqual(quarantine._path_with(kept, removed), parts)   # both copies, as written, where they were

    def test_older_sessions_with_one_index_still_restore(self):
        self.assertEqual(quarantine._path_with(["a", "c"], [[1, "b"]]), ["a", "b", "c"])
        self.assertEqual(quarantine._path_with(["a"], [[9, "b"]]), ["a", "b"])


class WaitingForRestart(unittest.TestCase):
    """A session whose files only move into it at the next restart is not deleted by the purge or Empty."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="mrq_wait_")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.src = os.path.join(self.tmp, "locked.dll")      # still at its old place
        with open(self.src, "w") as f:
            f.write("x")
        self.sids = []
        for waiting in (True, False):
            sid = f"20000101-000000-MiniRevoTestWait-{int(waiting)}"
            os.makedirs(quarantine._session_dir(sid), exist_ok=True)
            item = {"kind": "file", "target": self.src, "display": "x", "status": "done", "stored": "s"}
            if waiting:
                item["pending_moves"] = [[self.src, os.path.join(quarantine._session_dir(sid), "files", "0_x")]]
            quarantine._save({"id": sid, "program": "t", "created": 1.0, "mode": "quarantine", "items": [item]})
            self.sids.append(sid)
            self.addCleanup(quarantine.delete_session, sid)

    def test_purge_keeps_it_and_says_so(self):
        kept = []
        quarantine.purge(14, kept=kept)
        ids = {s["id"] for s in quarantine.sessions()}
        self.assertIn(self.sids[0], ids)
        self.assertNotIn(self.sids[1], ids)
        self.assertIn(self.sids[0], kept)

    def test_empty_keeps_it_and_says_so(self):
        from stellarhub.engine import remover
        real = quarantine.sessions
        with mock.patch.object(remover.settings, "log"), \
                mock.patch.object(remover.quarantine, "sessions",
                                  lambda: [s for s in real() if s["id"] in self.sids]):   # only this test's sessions
            with self.assertRaises(OSError):
                remover.quarantine_empty()
        ids = {s["id"] for s in quarantine.sessions()}
        self.assertIn(self.sids[0], ids)
        self.assertNotIn(self.sids[1], ids)


class ReparseUnknown(unittest.TestCase):
    """GetFileAttributesW failing (INVALID_FILE_ATTRIBUTES, -1 without a restype) must not make a real file a "link":
    the quarantine deletes links outright instead of keeping them."""

    def test_a_real_file_stays_a_file_and_is_quarantined(self):
        import ctypes
        tmp = tempfile.mkdtemp(prefix="mrq_rp_")
        self.addCleanup(shutil.rmtree, tmp, True)
        f = os.path.join(tmp, "MiniRevoTestReal.dat")
        with open(f, "w") as fh:
            fh.write("keep me")
        target, link = os.path.join(tmp, "t"), os.path.join(tmp, "MiniRevoTestJ")
        os.makedirs(target)
        subprocess.run(["cmd", "/c", "mklink", "/J", link, target], capture_output=True)
        fail = mock.Mock(return_value=-1)
        with mock.patch.object(ctypes.windll.kernel32, "GetFileAttributesW", fail), \
                mock.patch.object(paths, "_GetFileAttributesW", fail, create=True):
            self.assertFalse(paths.is_reparse_point(f))
            self.assertFalse(paths.is_reparse_point(os.path.join(tmp, "missing")))
            if os.path.lexists(link):
                self.assertTrue(paths.is_reparse_point(link))       # the answer then comes from lstat
            r = quarantine.remove({"id": "t", "name": "MiniRevo Test App", "location": ""},
                                  [{"kind": "file", "target": f}], [])
        self.addCleanup(quarantine.delete_session, r["session"])
        s = next(x for x in quarantine.sessions() if x["id"] == r["session"])
        self.assertTrue(s["items"][0]["restorable"])
        quarantine.restore(r["session"])
        with open(f) as fh:
            self.assertEqual(fh.read(), "keep me")


class BatchUninstall(unittest.TestCase):
    def test_one_unknown_program_does_not_stop_the_batch(self):
        from stellarhub.engine import remover

        class Job:
            cancelled = False

            def progress(self, *a, **k):
                pass
        good = {"id": "good", "name": "Good App"}
        get = lambda pid: good if pid == "good" else (_ for _ in ()).throw(KeyError("gone"))   # noqa: E731
        with mock.patch.object(remover, "_get", get), \
                mock.patch.object(remover.uninstaller, "close_processes"), \
                mock.patch.object(remover.uninstaller, "uninstall", return_value={"ok": True}) as un, \
                mock.patch.object(remover.uninstaller, "still_registered", return_value=False), \
                mock.patch.object(remover.scanner, "scan", return_value={"items": []}), \
                mock.patch.object(remover.settings, "log"), mock.patch.object(remover, "_all", return_value=[]):
            r = remover.batch_uninstall(Job(), ["missing", "good"], {"restore_point": False})
        self.assertEqual([("error" in e) for e in r["results"]], [True, False])
        un.assert_called_once()


if __name__ == "__main__":
    unittest.main()
