import os
import unittest
from unittest import mock

from stellarhub.engine import fakepc, system


class FakePcGate(unittest.TestCase):
    def test_ignored_without_isolated(self):
        for env in ({"STELLARHUB_FAKE_PC": "desktop"}, {"STELLARHUB_FAKE_PC": "desktop", "STELLARHUB_ISOLATED": "0"}):
            with mock.patch.dict(os.environ, env, clear=False):
                if "STELLARHUB_ISOLATED" not in env:
                    os.environ.pop("STELLARHUB_ISOLATED", None)
                self.assertFalse(fakepc.active())

    def test_ignored_without_fake_value(self):
        with mock.patch.dict(os.environ, {"STELLARHUB_ISOLATED": "1", "STELLARHUB_FAKE_PC": ""}):
            self.assertFalse(fakepc.active())

    def test_active_only_together(self):
        with mock.patch.dict(os.environ, {"STELLARHUB_ISOLATED": "1", "STELLARHUB_FAKE_PC": "desktop"}):
            self.assertTrue(fakepc.active())
            info = system.pc_info()
            self.assertEqual(info["type"], "desktop")
            self.assertFalse(any(c["id"] == "battery" for c in info["components"]))
            self.assertEqual(system.counts()["programs"], 74)
            self.assertIsNone(fakepc.telemetry({"battery": 80})["battery"])

    def test_pc_info_not_faked_when_ignored(self):
        with mock.patch.dict(os.environ, {"STELLARHUB_FAKE_PC": "desktop"}):
            os.environ.pop("STELLARHUB_ISOLATED", None)
            with mock.patch.object(system, "_mem", {"model": "Real", "typeName": "Laptop", "components": [], "ts": 9e12}):
                self.assertEqual(system.pc_info()["model"], "Real")


if __name__ == "__main__":
    unittest.main()
