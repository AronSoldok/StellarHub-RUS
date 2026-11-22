"""Live Monitor's DNS switch: what counts as "automatic" DNS. PowerShell and netsh are mocked: nothing changes."""
import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

from stellarhub.engine import monitor as M


def fake_ps(dhcp_ip, name_server, servers):
    """PowerShell as Windows answers for an adapter: its IP from DHCP or not, the NameServer value typed by hand
    (empty: the DNS comes from DHCP) and the DNS servers in use."""
    def ps_json(script, timeout=None, as_list=False):
        if "Get-DnsClientServerAddress" in script:
            return list(servers)
        if "NameServer" in script:
            return name_server
        if "Get-NetIPInterface" in script:
            return 1 if dhcp_ip else 0
        raise AssertionError(script)
    return ps_json


class AutomaticDns(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.cmds = []

        def run(c, **k):
            self.cmds.append(" ".join(c))
            return mock.Mock(returncode=0, stdout=b"")
        for p in (mock.patch.object(M, "DNS_BACKUPS", self.tmp), mock.patch.object(M, "_admin", return_value=True),
                  mock.patch.object(M.subprocess, "run", side_effect=run)):
            p.start()
            self.addCleanup(p.stop)

    def test_dns_typed_by_hand_on_an_automatic_address_is_not_automatic(self):
        with mock.patch.object(M, "ps_json", side_effect=fake_ps(True, "9.9.9.9,149.112.112.112", ["9.9.9.9", "149.112.112.112"])):
            self.assertEqual(M._current_dns("Wi-Fi"), (False, ["9.9.9.9", "149.112.112.112"]))
            r = M.set_dns("Wi-Fi", "auto")
        self.assertTrue(r["ok"])
        self.assertIsNotNone(r["backup"])  # it really changed: the user's servers were saved first
        self.assertTrue(any("source=dhcp" in c for c in self.cmds))
        with open(os.path.join(self.tmp, r["backup"] + ".json"), encoding="utf-8") as fh:
            saved = json.load(fh)
        self.assertFalse(saved["dhcp"])
        self.cmds.clear()
        self.assertTrue(M.dns_undo(r["backup"])["ok"])  # undo puts the user's own servers back, not "automatic"
        self.assertIn("address=9.9.9.9", self.cmds[0])
        self.assertIn("address=149.112.112.112", self.cmds[1])

    def test_dns_from_dhcp_is_automatic(self):
        with mock.patch.object(M, "ps_json", side_effect=fake_ps(True, "", ["192.168.1.1"])):
            self.assertEqual(M._current_dns("Wi-Fi"), (True, ["192.168.1.1"]))
            self.assertEqual(M.set_dns("Wi-Fi", "auto"), {"ok": True, "backup": None})
        self.assertEqual(self.cmds, [])

    def test_unreadable_adapter_changes_nothing(self):
        with mock.patch.object(M, "ps_json", side_effect=fake_ps(True, None, [])):
            self.assertIsNone(M._current_dns("Gone"))
            self.assertFalse(M.set_dns("Gone", "cloudflare")["ok"])
        self.assertEqual(self.cmds, [])


if __name__ == "__main__":
    unittest.main()
