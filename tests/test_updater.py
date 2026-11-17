"""Program Updater: winget table parsing, return codes and silent uninstall switches. They never run winget."""
import unittest

from stellarhub.engine import updater as u
from stellarhub.engine.removal import programs as pm

TABLE_ES = (
    "Nombre        Id          Versión   Disponible  Origen\n"
    "------------------------------------------------------\n"
    "日本語アプリ  Foo.Bar     1.0       2.0         winget\n"
    "Plain App     Plain.App   Unknown   3.1         winget\n"
    "2 actualizaciones disponibles.\n"
)


class WingetTable(unittest.TestCase):
    def test_wide_characters_keep_columns_aligned(self):
        rows = u.parse_table(TABLE_ES)
        self.assertEqual([r["id"] for r in rows], ["Foo.Bar", "Plain.App"])
        self.assertEqual(rows[0]["name"], "日本語アプリ")
        self.assertEqual(rows[0]["available"], "2.0")
        self.assertEqual(rows[1]["version"], "Unknown")

    def test_summary_line_is_not_a_row(self):
        self.assertEqual(len(u.parse_table(TABLE_ES)), 2)


class WingetCodes(unittest.TestCase):
    def test_codes_match_the_official_meanings(self):
        # these four were mapped to the wrong meaning before (returnCodes.md in microsoft/winget-cli)
        self.assertIn("hash", u.WINGET_CODES["0x8A150011"])
        self.assertIn("administrator", u.WINGET_CODES["0x8A150056"])
        self.assertIn("cancelled", u.WINGET_CODES["0x8A15010C"])
        self.assertIn("sign-in", u.WINGET_CODES["0x8A150077"])

    def test_restart_codes_count_as_installed(self):
        self.assertEqual(u.WINGET_REBOOT_OK, {"0x8A150109", "0x8A15010B"})


class SilentSwitches(unittest.TestCase):
    def test_squirrel_uninstalls_silently(self):
        cmd, quiet = pm.uninstall_command({"kind": "squirrel", "uninstall": r'"C:\x\Update.exe" --uninstall'}, quiet=True)
        self.assertTrue(quiet)
        self.assertTrue(cmd.endswith("--uninstall -s"))
        self.assertTrue(pm.can_quiet({"kind": "squirrel"}))


if __name__ == "__main__":
    unittest.main()
