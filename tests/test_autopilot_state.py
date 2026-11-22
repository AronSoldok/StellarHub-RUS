"""Autopilot's state file (last run, retry tomorrow) is shared by the scheduler's check and the runs: neither may erase
what the other saved. Everything lives in a temp folder; nothing runs for real."""
import json
import os
import shutil
import tempfile
import threading
import time
import unittest
from unittest import mock

from stellarhub.engine import autopilot


class TickKeepsWhatARunSaved(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="sh_test_")
        self.addCleanup(shutil.rmtree, self.dir, True)
        sp = os.path.join(self.dir, "settings.json")
        with open(sp, "w", encoding="utf-8") as fh:
            json.dump({"autopilotRoutines": [{"id": "r1", "name": "R", "acts": [{"k": "wait"}],
                                              "triggers": [{"k": "daily", "p": {"time": "03:00"}}]}],
                       "autopilotNotify": {"weekly": False, "noGame": False}}, fh)
        for p in (mock.patch.object(autopilot, "_settings_path", return_value=sp),
                  mock.patch.object(autopilot, "fullscreen_state", return_value=0)):
            p.start()
            self.addCleanup(p.stop)

    def test_a_run_ending_during_the_check_keeps_its_record(self):
        writer = {}

        def run_ends():  # what run() does when a routine finishes (on its job thread)
            with autopilot._lock:
                s = autopilot._state()
                s["last"]["r1"] = 12345.0
                s.setdefault("retry", {})["r1"] = time.time() + 86400
                autopilot._save_state(s)

        def triggers(r, st, now, ctx):  # the check is busy (reading triggers) when the run ends
            t = writer["t"] = threading.Thread(target=run_ends)
            t.start()
            t.join(0.5)
            return None
        with mock.patch.object(autopilot, "_check_triggers", side_effect=triggers):
            autopilot._tick()
        writer["t"].join(5)
        st = autopilot._state()
        self.assertEqual(st["last"].get("r1"), 12345.0)
        self.assertIn("r1", st.get("retry") or {})


if __name__ == "__main__":
    unittest.main()
