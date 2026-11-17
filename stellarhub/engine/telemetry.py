"""Telemetría en vivo del equipo, de verdad. Un hilo mide cada `rate` segundos y entrega un dict a `push`.

Fuentes: psutil (CPU por hilo, RAM, disco, red, batería), contadores de rendimiento de Windows (frecuencia real
de la CPU), nvidia-smi (GPU NVIDIA: uso, temperatura, consumo, reloj, VRAM), WMI (batería en vatios, temperatura
ACPI si Windows la da), netsh (señal Wi-Fi) y una conexión TCP corta para la latencia.
Lo que Windows no da sin drivers especiales (temperatura real de la CPU en muchos portátiles, ventiladores) se
envía como None: la interfaz muestra "—" en vez de inventarlo.
"""
import ctypes
import re
import socket
import subprocess
import threading
import time
from ctypes import wintypes

import psutil

NO_WINDOW = 0x08000000
GB = 1024 ** 3


# ---------- contador de rendimiento: % de rendimiento del procesador (frecuencia real) ----------
class _Pdh:
    def __init__(self, path):
        self.ok = False
        try:
            pdh = ctypes.windll.pdh
            self.pdh = pdh
            self.q = wintypes.HANDLE()
            self.c = wintypes.HANDLE()
            if pdh.PdhOpenQueryW(None, 0, ctypes.byref(self.q)) != 0:
                return
            if pdh.PdhAddEnglishCounterW(self.q, path, 0, ctypes.byref(self.c)) != 0:
                return
            pdh.PdhCollectQueryData(self.q)
            self.ok = True
        except Exception:
            pass

    def read(self):
        if not self.ok:
            return None

        class V(ctypes.Structure):
            _fields_ = [("CStatus", wintypes.DWORD), ("dbl", ctypes.c_double)]
        v = V()
        if self.pdh.PdhCollectQueryData(self.q) != 0:
            return None
        if self.pdh.PdhGetFormattedCounterValue(self.c, 0x00000200, None, ctypes.byref(v)) != 0:  # PDH_FMT_DOUBLE
            return None
        return v.dbl


class _PerfInfo(ctypes.Structure):
    _fields_ = [("cb", wintypes.DWORD), ("CommitTotal", ctypes.c_size_t), ("CommitLimit", ctypes.c_size_t),
                ("CommitPeak", ctypes.c_size_t), ("PhysicalTotal", ctypes.c_size_t), ("PhysicalAvailable", ctypes.c_size_t),
                ("SystemCache", ctypes.c_size_t), ("KernelTotal", ctypes.c_size_t), ("KernelPaged", ctypes.c_size_t),
                ("KernelNonpaged", ctypes.c_size_t), ("PageSize", ctypes.c_size_t), ("HandleCount", wintypes.DWORD),
                ("ProcessCount", wintypes.DWORD), ("ThreadCount", wintypes.DWORD)]


def _perf_info():
    pi = _PerfInfo()
    pi.cb = ctypes.sizeof(pi)
    if not ctypes.windll.psapi.GetPerformanceInfo(ctypes.byref(pi), pi.cb):
        return None
    return pi


class Sampler:
    def __init__(self, push):
        self.push = push
        self.rate = 1.0
        self.active = True          # ventana visible o widget abierto
        self.gpu_wanted = True      # nvidia-smi despierta la GPU dedicada: solo cuando hace falta
        self._stop = threading.Event()
        self._gpu = {}
        self._nv = None
        self._slow = {"battery": {}, "cpuTemp": None, "wifiSignal": None, "ping": None}
        self._perf = _Pdh(r"\Processor Information(_Total)\% Processor Performance")
        self._base_mhz = self._base_clock()
        self._last_io = None

    # ---------- arranque y control ----------
    def start(self):
        if getattr(self, "_started", False):
            return  # 'loaded' se dispara en cada recarga de la página: un solo muestreador
        self._started = True
        psutil.cpu_percent(None)
        psutil.cpu_percent(None, percpu=True)
        threading.Thread(target=self._loop, daemon=True, name="tele").start()
        threading.Thread(target=self._slow_loop, daemon=True, name="tele-slow").start()

    def stop(self):
        self._stop.set()
        self._kill_nv()

    def set_rate(self, seconds):
        self.rate = max(0.25, min(5.0, float(seconds)))
        self._kill_nv()  # se reabre con el nuevo intervalo

    def set_active(self, active, gpu=True):
        self.active, self.gpu_wanted = bool(active), bool(gpu)
        if not (active and gpu):
            self._kill_nv()

    # ---------- bucle principal ----------
    def _loop(self):
        while not self._stop.is_set():
            t0 = time.monotonic()
            if self.active:
                try:
                    self.push(self.sample())
                except Exception as e:
                    print("telemetría:", e)
            wait = self.rate if self.active else 2.0
            self._stop.wait(max(0.05, wait - (time.monotonic() - t0)))

    def sample(self):
        now = time.monotonic()
        per = psutil.cpu_percent(None, percpu=True)
        cpu = sum(per) / len(per) if per else psutil.cpu_percent(None)
        perf = self._perf.read()
        freq = (self._base_mhz * perf / 100 / 1000) if (perf and self._base_mhz) else None
        vm = psutil.virtual_memory()
        pi = _perf_info()
        page = pi.PageSize if pi else 4096
        io = psutil.disk_io_counters()
        net = psutil.net_io_counters()
        d = {"read": 0.0, "write": 0.0, "down": 0.0, "up": 0.0}
        if self._last_io:
            lt, lio, lnet = self._last_io
            dt = max(0.05, now - lt)
            d["read"] = max(0, io.read_bytes - lio.read_bytes) / dt / 1e6
            d["write"] = max(0, io.write_bytes - lio.write_bytes) / dt / 1e6
            d["down"] = max(0, net.bytes_recv - lnet.bytes_recv) / dt * 8 / 1e6
            d["up"] = max(0, net.bytes_sent - lnet.bytes_sent) / dt * 8 / 1e6
        self._last_io = (now, io, net)
        try:
            du = psutil.disk_usage("C:\\")
        except OSError:
            du = None
        bat = psutil.sensors_battery()
        sb = self._slow["battery"]
        if self.gpu_wanted:
            self._ensure_nv()
        g = self._gpu
        return {
            "cpu": round(cpu, 1), "threads": [round(x / 100, 3) for x in per], "cpuFreq": round(freq, 2) if freq else None,
            "cpuTemp": self._slow["cpuTemp"],
            "ram": round((vm.total - vm.available) / GB, 2), "ramTotal": round(vm.total / GB, 1),
            "ramCache": round(pi.SystemCache * page / GB, 2) if pi else None,
            "ramCommit": round(pi.CommitTotal * page / GB, 2) if pi else None,
            "ramCommitLimit": round(pi.CommitLimit * page / GB, 2) if pi else None,
            "procs": pi.ProcessCount if pi else None, "threadsTotal": pi.ThreadCount if pi else None,
            "diskRead": round(d["read"], 2), "diskWrite": round(d["write"], 2),
            "diskUsed": round(du.used / GB) if du else None, "diskTotal": round(du.total / GB) if du else None,
            "down": round(d["down"], 2), "up": round(d["up"], 2), "ping": self._slow["ping"], "wifiSignal": self._slow["wifiSignal"],
            "battery": round(bat.percent) if bat else None, "charging": bool(bat.power_plugged) if bat else None,
            "batterySecs": bat.secsleft if bat and bat.secsleft not in (psutil.POWER_TIME_UNLIMITED, psutil.POWER_TIME_UNKNOWN) else None,
            "batteryPower": sb.get("power"), "batteryHealth": sb.get("health"),
            "gpu": g.get("gpu"), "gpuTemp": g.get("temp"), "gpuPower": g.get("power"), "gpuClock": g.get("clock"),
            "vram": g.get("vram"), "vramTotal": g.get("vramTotal"), "fanGpu": g.get("fan"), "fanCpu": None,
            "uptime": int(time.time() - psutil.boot_time()), "ts": time.time(),
        }

    # ---------- GPU NVIDIA (nvidia-smi en bucle) ----------
    def _ensure_nv(self):
        if self._nv and self._nv.poll() is None:
            return
        ms = int(max(1000, self.rate * 1000))
        try:
            self._nv = subprocess.Popen(
                ["nvidia-smi", "--query-gpu=utilization.gpu,temperature.gpu,power.draw,clocks.gr,memory.used,memory.total,fan.speed",
                 "--format=csv,noheader,nounits", f"-lms={ms}"],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=NO_WINDOW, text=True)
        except OSError:
            self._nv = None
            self.gpu_wanted = False
            return
        threading.Thread(target=self._read_nv, args=(self._nv,), daemon=True).start()

    def _read_nv(self, proc):
        num = lambda s: None if not s or "N/A" in s or "Not" in s else float(s)
        for line in proc.stdout:
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 7:
                continue
            u, t, pw, clk, mu, mt, fan = (num(p) for p in parts[:7])
            self._gpu = {"gpu": u, "temp": t, "power": round(pw) if pw is not None else None,
                         "clock": round(clk / 1000, 2) if clk else None,
                         "vram": round(mu / 1024, 2) if mu is not None else None,
                         "vramTotal": round(mt / 1024) if mt else None, "fan": fan}

    def _kill_nv(self):
        if self._nv and self._nv.poll() is None:
            try:
                self._nv.kill()
            except OSError:
                pass
        self._nv = None

    # ---------- datos lentos: cada pocos segundos ----------
    def _slow_loop(self):
        n = 0
        while not self._stop.is_set():
            if self.active:
                self._ping()
                if n % 3 == 0:
                    self._battery_wmi()
                    self._cpu_temp()
                if n % 5 == 0:
                    self._wifi()
                n += 1
            self._stop.wait(2.0)

    def _ping(self):
        t0 = time.perf_counter()
        try:
            with socket.create_connection(("1.1.1.1", 443), timeout=1.5):
                pass
            self._slow["ping"] = round((time.perf_counter() - t0) * 1000)
        except OSError:
            self._slow["ping"] = None

    def _wmi(self, ns, query):
        """Consulta WMI dentro del proceso (pythonnet + System.Management): sin abrir PowerShell."""
        # OJO: nunca list()/len() sobre la colección: si WMI deniega el acceso, la excepción .NET salta dentro
        # de una ranura de pythonnet y tumba el proceso entero. Recorriendo el enumerador a mano es capturable.
        out = []
        try:
            import clr  # noqa: F401
            clr.AddReference("System.Management")
            from System.Management import ManagementObjectSearcher
            en = ManagementObjectSearcher(ns, query).Get().GetEnumerator()
            while en.MoveNext():
                out.append(en.Current)
        except Exception:
            pass
        return out

    def _battery_wmi(self):
        st = self._wmi(r"root\WMI", "SELECT ChargeRate, DischargeRate, Charging, Discharging FROM BatteryStatus")
        out = {}
        for o in st:
            try:
                rate = int(o["ChargeRate"] or 0) if o["Charging"] else -int(o["DischargeRate"] or 0)
                out["power"] = round(rate / 1000, 1)
            except Exception:
                pass
        if "health" not in self._slow["battery"]:
            des = self._wmi(r"root\WMI", "SELECT DesignedCapacity FROM BatteryStaticData")
            full = self._wmi(r"root\WMI", "SELECT FullChargedCapacity FROM BatteryFullChargedCapacity")
            try:
                d, f = int(des[0]["DesignedCapacity"]), int(full[0]["FullChargedCapacity"])
                if d > 0:
                    out["health"] = round(min(100, f / d * 100))
                    out["designWh"], out["fullWh"] = round(d / 1000, 1), round(f / 1000, 1)
            except Exception:
                pass
        else:
            out["health"] = self._slow["battery"]["health"]
        self._slow["battery"].update(out)

    def _cpu_temp(self):
        if not ctypes.windll.shell32.IsUserAnAdmin():
            self._slow["cpuTemp"] = None  # Windows solo la da a administradores
            return
        zs = self._wmi(r"root\WMI", "SELECT CurrentTemperature FROM MSAcpi_ThermalZoneTemperature")
        temps = []
        for z in zs:
            try:
                c = int(z["CurrentTemperature"]) / 10 - 273.15
                if 25 < c < 110:
                    temps.append(c)
            except Exception:
                pass
        self._slow["cpuTemp"] = round(max(temps)) if temps else None

    def _wifi(self):
        try:
            raw = subprocess.run(["netsh", "wlan", "show", "interfaces"], capture_output=True, timeout=4,
                                 creationflags=NO_WINDOW).stdout
            try:
                out = raw.decode("utf-8")  # netsh escribe UTF-8 en Windows 11
            except UnicodeDecodeError:
                out = raw.decode("cp850", "replace")
            m = re.search(r"(?:Se.al|Signal)\s*:\s*(\d+)\s*%", out)
            self._slow["wifiSignal"] = int(m.group(1)) if m else None
        except Exception:
            self._slow["wifiSignal"] = None

    def battery_info(self):
        return dict(self._slow["battery"])

    @staticmethod
    def _base_clock():
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0") as k:
                return int(winreg.QueryValueEx(k, "~MHz")[0])
        except OSError:
            f = psutil.cpu_freq()
            return f.max if f else None
