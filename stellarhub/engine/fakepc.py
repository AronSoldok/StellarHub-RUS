"""Developer-only: a TEST copy that pretends to be a desktop tower PC (to review how Home looks on one).

STELLARHUB_FAKE_PC=desktop is honoured ONLY together with STELLARHUB_ISOLATED=1; in a normal or installed run
`active()` is always False and nothing here is ever used. Wired at the narrowest points: system.pc_info /
pc_info_fresh / counts / health and the telemetry sample."""
import os
import time

GB = 1024 ** 3


def active():
    return os.environ.get("STELLARHUB_ISOLATED") == "1" and os.environ.get("STELLARHUB_FAKE_PC", "").strip().lower() == "desktop"


def _T(text, **kw):
    d = {"tr": text}
    if kw:
        d["kw"] = kw
    return d


def pc_info():
    """Same shape as system._build(): a custom-built ATX tower with a Ryzen 7 7800X3D and an RTX 4070 SUPER."""
    mons = [{"vendor": "Gigabyte", "name": "M27Q X", "code": "GBT2710", "inches": 27, "internal": False},
            {"vendor": "AOC", "name": "24G2", "code": "AOC2402", "inches": 24, "internal": False}]
    comps = [
        {"id": "cpu", "name": "Processor", "title": "AMD Ryzen 7 7800X3D 8-Core Processor",
         "rows": [["Cores", "8"], ["Threads", "16"], ["Base clock", _T("{v} GHz", v={"num": 4.2, "d": 1})], ["L3 cache", "96 MB"]]},
        {"id": "gpu", "name": "Graphics", "title": "NVIDIA GeForce RTX 4070 SUPER",
         "rows": [["Memory", "12 GB"], ["Integrated", "AMD Radeon(TM) Graphics"], ["Driver", "32.0.15.6094"]], "vram": 12},
        {"id": "ram", "name": "Memory", "title": "32 GB DDR5",
         "rows": [["Speed", "6000 MT/s"], ["Manufacturer", "G.Skill"], ["Modules", _T("{n} of {slots} slots, free slots available", n=2, slots=4)]],
         "slots": 4, "modules": 2},
        {"id": "ssd", "name": "Storage", "title": "Samsung SSD 980 PRO 2TB 2 TB",
         "rows": [["Type", "SSD NVMe"], ["Used on C:", "812 GB"], ["Free on C:", "1049 GB"], ["Disks", "2"]], "bar": 0.436},
        {"id": "display", "name": "Displays", "title": _T("{n} displays", n=2),
         "rows": [["External", "Gigabyte M27Q X 27\""], ["External", "AOC 24G2 24\""]], "monitors": mons},
        {"id": "wifi", "name": "Network", "title": "Realtek Gaming 2.5GbE Family Controller",
         "rows": [["Link", "2.5 Gbps"], ["Type", "Ethernet"]]},
        {"id": "audio", "name": "Audio", "title": "Realtek High Definition Audio", "rows": [["Others", "NVIDIA High Definition Audio, USB Audio"]]},
        {"id": "sys", "name": "System", "title": "Windows 11 Pro 24H2",
         "rows": [["Build", "26100.2605"], ["BIOS", "American Megatrends International, LLC. 3.20"], ["Motherboard", "MAG B650 TOMAHAWK WIFI"]]},
    ]
    return {"model": "MSI MAG B650 TOMAHAWK WIFI", "code": "", "type": "desktop", "typeName": "Tower", "maker": "Micro-Star International Co., Ltd.",
            "os": "Windows 11 Pro 24H2", "build": "26100", "bios": "American Megatrends International, LLC. 3.20", "components": comps,
            "facts": {"drivers": 118, "programs": 74, "freeC": 1049}, "ts": time.time(), "v": 0, "fake": True}


def counts():
    return {"programs": 74, "drivers": 118, "freeC": 1049}


def health():
    return {"defender": True, "sigAge": 0, "antivirus": ["Windows Defender"], "deviceErrors": 0, "errorNames": [],
            "restore": None, "restoreAccess": True}


def telemetry(d):
    """Overrides the laptop-only / hardware-size fields of a telemetry sample: no battery, 32 GB RAM, 2 TB system disk."""
    d.update({"battery": None, "charging": None, "batterySecs": None, "batteryPower": None, "batteryHealth": None,
              "batteryCycles": None, "batteryDesignWh": None, "batteryFullWh": None, "ramTotal": 32.0, "diskTotal": 1863,
              "igpu": None})
    if d.get("vramTotal"):
        d["vramTotal"] = 12
    return d
