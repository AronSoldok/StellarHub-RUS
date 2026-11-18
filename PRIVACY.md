# Privacy

StellarHub runs on your PC and works with your PC's own data. It has **no account, no telemetry, no analytics and no
ads**, and it never sends anything about you, your PC or what you do in it to its author or to anyone else.

Everything it knows (settings, logs, scan results, benchmark history, Autopilot routines) stays in
`%APPDATA%\StellarHub` and `%LOCALAPPDATA%\StellarHub` on your PC. Uninstalling asks whether to remove it too.

## When StellarHub goes online

These are all of the connections StellarHub itself makes. None of them sends personal data; like any request on the
internet, the server sees your IP address.

| When | Where | What for | How to turn it off |
|---|---|---|---|
| When it opens, and every few hours while it runs | `api.github.com` (this repository's releases) | To see if there is a newer StellarHub. It asks GitHub for the latest release; nothing about you is sent. | *Settings > Updates > Check for updates automatically*, or the "Keep StellarHub up to date" option in the installer |
| Only when you click "Update now" | `github.com` (this repository's releases) | Downloads the new installer and its SHA-256 | Don't click it |
| When you open App Hangar | `api.winstall.app`, `raw.githubusercontent.com` (UniGetUI's icon list), `github.com` and `www.google.com/s2/favicons` | Icons of the apps in the catalog. Only app names and IDs are in these requests. | Don't open App Hangar |
| When you install apps with App Hangar or update them with Program Updater | `winget` (Microsoft's Windows Package Manager) and the app's own download servers | Downloading and installing what you chose | Don't start an install |
| When you search for or install drivers, or check Windows Update | Windows Update (Microsoft) | Done by Windows itself, as when you use Settings | Don't start a search |
| Only when you click "show" next to the public IP in Live Monitor | `api.ipify.org` | Shows your public IP address | Don't click it |
| Only when you run the network test in Benchmark Testing | `speed.cloudflare.com` | Measures download and upload speed | It never runs by itself |
| Only when you click "search the web" in Program Remover | Your browser opens `www.google.com` | Searching how to uninstall that program | Don't click it |

When it is installed, if Windows lacks the Microsoft Edge WebView2 Runtime, the installer downloads it from Microsoft
(`go.microsoft.com`) and only runs it if Windows confirms it is signed by Microsoft.

## Your system

StellarHub reads a lot about your PC to show it to you (hardware, drivers, programs, processes, network connections,
privacy settings, startup items). That information is only shown on your screen. Everything that **changes** the
system asks for confirmation first and, whenever possible, is backed up so it can be undone (see *Safety* in the
[README](README.md)).

## Questions

Open an issue: https://github.com/estebanarosemena/StellarHub/issues
