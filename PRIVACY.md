# Privacy

StellarHub runs on your PC and works with your PC's own data. It has **no account, no telemetry, no analytics and no
ads**, and it never sends anything about you, your PC or what you do in it to its author or to anyone else.

Everything it knows (settings, logs, scan results, benchmark history, scheduled tasks) stays in
`%APPDATA%\StellarHub` and `%LOCALAPPDATA%\StellarHub` on your PC. Backups of changes that affect the whole PC
(services, system registry keys, the uninstaller's quarantine) are kept in `%ProgramData%\StellarHub`; backups of
your own settings stay in your user folder, where other accounts on the PC can't read them. Uninstalling asks
whether to remove all of it too.

## When StellarHub goes online

These are all of the connections StellarHub itself makes. None of them sends personal data; like any request on the
internet, the server sees your IP address.

| When | Where | What for | How to turn it off |
|---|---|---|---|
| When it opens, and every few hours while it runs | `api.github.com` (this repository's releases) | To see if there is a newer StellarHub. It asks GitHub for the latest release; nothing about you is sent. | *Settings > Updates > Check for updates automatically*, or the "Keep StellarHub up to date" option in the installer |
| When a version with new features is out (and *Install new features automatically* is on), or when you click "Update now" | `github.com` (this repository's releases) | Downloads the new installer (or the portable .zip) and its signature (`.sig`), and installs it only if it was signed by StellarHub's author | *Settings > Updates* (turn off both options) |
| Every 2 seconds while StellarHub's window or widget is showing (not while it is only in the tray) | `1.1.1.1` (Cloudflare), port 443 | Measures your connection's latency for the live stats: it opens a connection and closes it right away. Nothing is sent. | *Settings > General > Measure the connection latency* |
| When you open App Hangar | `api.winstall.app`, `raw.githubusercontent.com` (UniGetUI's icon list), `github.com` and `www.google.com/s2/favicons` | Icons of the apps in the catalog. Only app names and IDs are in these requests. | Don't open App Hangar |
| When you install apps with App Hangar or update them with Program Updater | `winget` (Microsoft's Windows Package Manager) and the app's own download servers | Downloading and installing what you chose | Don't start an install |
| When you search for or install drivers, or check Windows Update | Windows Update (Microsoft) | Done by Windows itself, as when you use Settings | Don't start a search |
| Only when you click "show" next to the public IP in Live Monitor | `api.ipify.org` | Shows your public IP address | Don't click it |
| Only when you run the network test in Benchmark Testing | `speed.cloudflare.com` | Measures download and upload speed | It never runs by itself |
| Only when you click "search the web" in Program Remover | Your browser opens `www.google.com` | Searching how to uninstall that program | Don't click it |

The installer makes no scheduled task, and by default StellarHub installs for you only (no administrator rights). If
you chose *all users*, the first update asks Windows once and then creates one on-demand task, *StellarHub\Update*,
which only runs StellarHub's own updater when an update is started (it has no schedule); uninstalling removes it.

When it is installed, if Windows lacks the Microsoft Edge WebView2 Runtime, the installer downloads it from Microsoft
(`go.microsoft.com`) and only runs it if Windows confirms it is signed by Microsoft.

## Your system

StellarHub reads a lot about your PC to show it to you (hardware, drivers, programs, processes, network connections,
privacy settings, startup items). That information is only shown on your screen. Everything that **changes** the
system asks for confirmation first and, whenever possible, is backed up so it can be undone (see *Safety* in the
[README](README.md)).

## Questions

Open an issue: https://github.com/estebanarosemena/StellarHub/issues
