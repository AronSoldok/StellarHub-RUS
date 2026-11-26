[Русский](README.md) · [English](README.en.md)

# 🪐 StellarHub — Russian-localized fork

A Windows PC control center for hardware monitoring, driver and app updates, disk analysis, cleanup, and diagnostics.

This fork is based on [StellarHub by Esteban Arosemena](https://github.com/estebanarosemena/StellarHub).
The original authors are **Esteban Arosemena and Claude**. Their attribution and the GNU GPLv3 license are preserved.

## Changes in this fork

- Russian translations for the interface, settings, modules, widget, tray menu, and engine messages.
- Russian installer language and automatic language selection on Russian Windows installations.
- Bundled Cyrillic subsets of Onest and Unbounded, Russian number and date formatting, and grammatical counter forms.
- Fork attribution in Settings → About.
- Self-updates are disabled until the fork has its own release channel. Upstream binaries do not replace this localized copy.

Updates for other applications, drivers, and Windows remain available.
Screenshots in `docs/img/` come from the upstream project and show its English interface with sample data.

## Features

| Module | Purpose |
|---|---|
| Home | Hardware tiles or a rotatable 3D model, live readings, system health, and running tasks. |
| Live Monitor | CPU threads, clocks, graphics, temperatures, memory, disks and SMART, network, Wi-Fi, battery, and processes. |
| Driver Updater | Microsoft-signed drivers from Windows Update, backups, previous versions, and device problems. |
| Program Remover | Standard, silent, and forced uninstall; leftover review, quarantine, batch uninstall, watched installs, and window identification. |
| Program Updater | Updates through winget, Windows Update, Microsoft Store, shared components, and development tools. |
| App Hangar | An app catalog, winget search, batch installation, and reusable kits shared by file or code. |
| Storage Checker | Disk map, folders, file types, large files, duplicates, and scan comparisons. Direct NTFS table reads with administrator rights. |
| Super Optimizer | Temporary files, caches, startup, services, Windows repair, power settings, preinstalled apps, and promotions. |
| Privacy & Security | Antivirus, firewall, Secure Boot, TPM, encryption, app permissions, ports, tracking settings, and hidden auto-starts. |
| Benchmark Testing | CPU, graphics, memory, disk, internet, and stress tests with saved results. |
| Device Tester | Keyboard, screen, speakers, microphone, camera, mouse, and controller tests. |
| Scheduled Tasks | Maintenance at chosen times or events, subject to your conditions. Routines run while StellarHub is open, including in the tray. |

Also includes an always-on-top widget, tray panel, command search, backups and restore, controller navigation,
appearance and sound settings, and lighter effects on battery.
Registry cleaning is disabled by default and is never part of “Optimize everything”.

## Run from source

Requires 64-bit Windows 10 version 1809 or later, or Windows 11, Python 3.12+, and
[Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/).

Open a terminal in the source directory of **this fork**:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\pythonw.exe run.py
```

For development:

```powershell
.\.venv\Scripts\python.exe run.py --debug
```

Choose **Settings → Language → Русский**. Automatic follows the Windows display language.
The selection applies to the app, widget, tray menu, and operation messages. The existing languages are retained.

## Build

```powershell
powershell -ExecutionPolicy Bypass -File packaging\build.ps1
```

The script prepares a pinned build environment, runs tests, builds the application with PyInstaller,
and creates an installer with Inno Setup 6.7+. Outputs go to `dist/`.
Dependencies and build tools require network access. The application uses a folder distribution without UPX.

The installer defaults to the current user under `%LOCALAPPDATA%\Programs\StellarHub`.
An all-users installation uses Program Files and requires Windows permission.
Use `/LANG=russian` for the installer language and `/APPLANG=ru` for the application language.
`/CURRENTUSER` and `/ALLUSERS` select the installation scope.

The portable version keeps settings in a `Data` folder next to the application.
Backups of system changes remain on the PC where the changes were made.

## Administrator mode

StellarHub works with limited capabilities without elevation. Driver installation, system cleanup,
Windows repair, some hardware readings, and direct NTFS reads need administrator rights.
The app offers to reopen with elevation and resume the selected action.

Launching without a repeated Windows prompt requires an all-users installation in a protected program folder.
Per-user and portable copies request permission each time.

Some PCs do not expose CPU temperature through Windows. If LibreHardwareMonitor, HWiNFO with shared memory,
or Core Temp is running, StellarHub can read the temperature from it.

## Shortcuts

| Action | Shortcut |
|---|---|
| Search tools and actions | `Ctrl K` |
| Settings | `Ctrl ,` |
| Switch modules | `Ctrl 1` … `Ctrl 9` |
| Back / forward | `Alt ←` / `Alt →` or mouse side buttons |
| Close a dialog or return Home | `Esc` |
| Move focus | `Tab` / `Shift Tab` |
| Maximize or restore | Double-click the top bar |

Xbox-style, DualShock, DualSense, and handheld PC controllers are supported.
The D-pad or left stick moves focus, `A` selects, `B` goes back, `LB/RB` switches tabs,
`LT/RT` switches modules, `Y` opens search, `Menu` opens settings, and `View` opens Home.
The right stick scrolls. Controller navigation can be disabled in General settings.

## Safety, privacy, and updates

System changes ask for confirmation and, where possible, use restore points, backups, or quarantine.
Protected Windows areas, critical services, and personal data are excluded from automatic cleanup.
Irreversible actions have separate warnings. Unavailable readings appear as “—”.

There are no user accounts, analytics, or application telemetry. Translations and fonts are loaded locally.
Network requests for individual features are documented in [PRIVACY.md](PRIVACY.md).
This fork does not check for or download updates to StellarHub itself.

The upstream Ed25519 verification code remains in the source, but the fork's update channel is disabled.
Enabling it requires a dedicated release repository, trusted signing key, and signed builds.
Upstream signing arrangements do not imply that this fork's binaries are signed.

## Development and translations

Python modules communicate with Windows through system APIs, WMI, Windows Update, winget, and system tools.
The interface uses plain HTML, CSS, and JavaScript inside pywebview/WebView2.

- [UI contract](docs/UI_CONTRACT.md)
- [Translation guidelines](stellarhub/ui/i18n/README.md)
- Russian dictionaries: `stellarhub/ui/i18n/ru/`

```powershell
.\.venv\Scripts\python.exe -m unittest tests.test_i18n_keys tests.test_russian
```

Tests cover translation keys, placeholders, markup, language loading in Python and JavaScript,
Russian installer mappings, grammatical counters, and disabled upstream self-updates.

## License and credits

Original project by **Esteban Arosemena and Claude**. Distributed under **GNU General Public License v3.0**;
see [LICENSE](LICENSE). This is a modified version with Russian localization, Cyrillic fonts,
installer adaptations, and changed self-update behavior.

Built with [pywebview](https://github.com/r0x0r/pywebview) (BSD-3),
[psutil](https://github.com/giampaolo/psutil) (BSD-3), [pystray](https://github.com/moses-palmer/pystray) (LGPLv3),
[Pillow](https://python-pillow.org/) (MIT-CMU), [three.js](https://threejs.org/) (MIT),
and [Unbounded](https://github.com/googlefonts/unbounded) and [Onest](https://github.com/simpals/onest)
fonts (SIL Open Font License 1.1).

**Orbital** sounds were created for StellarHub (CC0). The soft hover sound is based on
[“UI hover” by unfa](https://freesound.org/people/unfa/sounds/565131/) (CC0), filtered and shortened.
The notification sound is “UI_Single_Set 2_01.wav” from
[“UI Utility Pack Vol 1” by JC Sounds](https://opengameart.org/content/jc-sounds-ui-utility-pack-vol-1),
licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), trimmed, faded, and loudness-normalized.
See [CREDITS.json](stellarhub/ui/sounds/CREDITS.json).
