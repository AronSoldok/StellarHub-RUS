"""Russian localization: dictionary coverage, runtime loading, installer mapping and fork update isolation."""
import json
from pathlib import Path
import shutil
import subprocess
import unittest
from unittest import mock

from stellarhub import i18n
from stellarhub.engine import selfupdate

ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / 'stellarhub/ui'


def read_dictionary(lang):
    merged = {}
    for file in (UI / 'i18n' / lang).glob('*.json'):
        def unique(pairs):
            result = dict(pairs)
            if len(result) != len(pairs):
                raise AssertionError(f'Duplicate JSON keys in {file.name}')
            return result
        data = json.loads(file.read_text(encoding='utf-8'), object_pairs_hook=unique)
        for key, value in data.items():
            if lang == 'ru' and key in merged:
                if merged[key] != value:
                    raise AssertionError(f'Conflicting translations: {key!r}')
            merged[key] = value
    return merged


class Russian(unittest.TestCase):
    def test_dynamic_keys_and_catalog_descriptions_are_also_covered(self):
        russian = read_dictionary('ru')
        reference = read_dictionary('es')
        extra = {'settings|Backups and restore'} | {f'count_{form}|{key}' for form in ('one', 'few', 'many')
                for key in ('Driver', 'program', 'driver update available', 'program to update')}
        cooling = json.loads((UI / 'i18n/ru/cooling.json').read_text(encoding='utf-8'))
        self.assertEqual(set(russian), set(reference) | extra | set(cooling))
        self.assertTrue(all(isinstance(v, str) and v.strip() for v in russian.values()))

    def test_engine_context_and_named_placeholders(self):
        with mock.patch.object(i18n, '_lang', None), mock.patch.object(i18n, '_dict', {}):
            self.assertEqual(i18n.set_language('ru'), 'ru')
            self.assertEqual(i18n.tr('Settings'), 'Настройки')
            self.assertEqual(i18n.tr('Restored: {name}', name='App'), 'Восстановлено: App')
            self.assertEqual(i18n.tc('remover', 'Protected'), 'Защищённый компонент')
            self.assertEqual(i18n.tr('Protected'), 'Защита включена')
            self.assertEqual(i18n.tr('Unknown key {n}', n=21), 'Unknown key 21')
            i18n.set_language('en')
            self.assertEqual(i18n.tr('Settings'), 'Settings')

    def test_russian_windows_is_detected(self):
        def locale_name(lcid, buf, length, flags):
            buf.value = 'ru-RU'
            return len(buf.value) + 1
        with mock.patch.object(i18n.ctypes.windll.kernel32, 'GetUserDefaultUILanguage', return_value=1049), \
                mock.patch.object(i18n.ctypes.windll.kernel32, 'LCIDToLocaleName', side_effect=locale_name):
            self.assertEqual(i18n.resolve('auto'), 'ru')

    @unittest.skipUnless(shutil.which('node'), 'Node.js required')
    def test_javascript_loads_the_same_language_and_context(self):
        script = r"""
const fs = require('fs'), vm = require('vm'), path = require('path');
const ui = process.argv[1];
const context = {window: {}, navigator: {languages: ['ru-RU']},
  document: {documentElement: {}, readyState: 'loading', addEventListener() {}},
  localStorage: {getItem() {return 'auto';}},
  XMLHttpRequest: class {
    open(method, url) {this.url = url;}
    overrideMimeType() {}
    send() {
      // Exercise the area-file fallback as well as the generated bundle path.
      if (process.argv[2] === 'areas' && this.url.includes('_bundle')) throw Error('no bundle');
      this.responseText = fs.readFileSync(path.join(ui, this.url), 'utf8'); this.status = 200;
    }
  }};
vm.runInNewContext(fs.readFileSync(path.join(ui, 'js/i18n.js'), 'utf8'), context);
const SH = context.window.SH;
console.log(JSON.stringify([context.document.documentElement.lang, SH.i18n.locale,
  SH.t('Settings'), SH.t('{n} files', {n:21}), SH.tc('remover','Protected'), SH.t('Unknown key'),
  [0,1,2,5,11,21,22,25,111].map(n => SH.counted(n, 'program', 'programs'))]));
"""
        for mode in ('bundle', 'areas'):
            result = subprocess.run(['node', '-e', script, str(UI), mode], capture_output=True, text=True, encoding='utf-8', check=True)
            self.assertEqual(json.loads(result.stdout), ['ru', 'ru-RU', 'Настройки', 'Файлов: 21', 'Защищённый компонент', 'Unknown key',
                ['программ', 'программа', 'программы', 'программ', 'программ', 'программа', 'программы', 'программ', 'программ']])

    def test_installer_russian_language_maps_to_ru(self):
        text = (ROOT / 'packaging/StellarHub.iss').read_text(encoding='utf-8-sig')
        self.assertIn('Name: "russian"; MessagesFile: "compiler:Languages\\Russian.isl"', text)
        self.assertIn("7: Result := 'ru';", text)
        self.assertIn("WizardLanguage = 'russian' then Result := 'ru'", text)
        self.assertIn("LangCombo.Items.Add('Русский');", text)
        self.assertIn('for I := 0 to 7 do', text)

    @unittest.skipUnless(shutil.which('node'), 'Node.js required')
    def test_language_choice_persists_in_browser_preview(self):
        script = r"""
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(process.argv[1], 'utf8');
const fn = src.slice(src.indexOf('async function setLanguage('), src.indexOf('function applySetting('));
const stored = {}, state = {settings:{language:'auto'}};
const context = {state, sheet:{}, S:() => state.settings, $$:() => [],
  localStorage:{setItem:(k,v) => stored[k]=v},
  SH:{i18n:{lang:'ru', remember:p => stored.pref=p, resolve:() => 'ru'}, call:async()=>undefined}};
vm.runInNewContext(fn, context);
context.setLanguage('ru').then(() => console.log(JSON.stringify([stored.pref, JSON.parse(stored['sh.settings']).language])));
"""
        result = subprocess.run(['node', '-e', script, str(UI / 'js/shell.js')], capture_output=True, text=True, encoding='utf-8', check=True)
        self.assertEqual(json.loads(result.stdout), ['ru', 'ru'])


class ForkUpdates(unittest.TestCase):
    def test_no_network_processes_or_staged_upstream_update(self):
        with mock.patch.object(selfupdate, 'UPDATES_ENABLED', False), \
                mock.patch.object(selfupdate, '_get') as get, \
                mock.patch.object(selfupdate.subprocess, 'Popen') as popen, \
                mock.patch.object(selfupdate, 'state', return_value={'st': 'staged', 'ver': '99.0.0'}):
            result = selfupdate.check()
            self.assertTrue(result['disabled'])
            self.assertFalse(result['newer'])
            self.assertFalse(selfupdate.start()['ok'])
            self.assertFalse(selfupdate.prefetch()['ok'])
            self.assertIsNone(selfupdate.staged())
            self.assertEqual(selfupdate.run_updater(), 3)
            with self.assertRaises(RuntimeError):
                selfupdate._latest()
        get.assert_not_called()
        popen.assert_not_called()


if __name__ == '__main__':
    unittest.main()
