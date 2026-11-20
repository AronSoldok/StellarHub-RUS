"""Long tasks with progress, a log and cancellation. Updates reach the UI as SH.emit('job', {...}).

    def scan(job, folder):
        for i, f in enumerate(files):
            if job.cancelled: return job.stop()        # the user pressed Cancel
            job.progress(i / total, f"Reading {f}", files=i)   # pct 0..1, text, extra data
            job.log("output line")                     # for live consoles (SFC, DISM, winget...)
        return result                                  # arrives as {state:'done', result}
"""
import itertools
import threading
import time
import traceback

_emit = lambda event, data: None  # the app replaces it with the sender to the UI
_jobs = {}
_ids = itertools.count(1)


def set_emitter(fn):
    global _emit
    _emit = fn


class Cancelled(Exception):
    pass


class Job:
    def __init__(self, name):
        self.id = f"j{next(_ids)}"
        self.name = name
        self.cancelled = False
        self.state = "running"
        self.pct = 0.0
        self.text = ""
        self.data = {}
        self.result = None
        self._last = 0.0
        self._logbuf = []
        self._lock = threading.Lock()

    # ---- for the task code ----
    def progress(self, pct=None, text=None, force=False, **data):
        if pct is not None:
            self.pct = max(0.0, min(1.0, float(pct)))
        if text is not None:
            self.text = str(text)
        self.data.update(data)
        now = time.monotonic()
        if force or now - self._last > 0.1 or self.pct >= 1:
            self._last = now
            self._send("progress")

    def log(self, line):
        with self._lock:
            self._logbuf.append(str(line).rstrip("\r\n"))
        if time.monotonic() - self._last > 0.1:
            self._last = time.monotonic()
            self._send("progress")

    def check(self):
        """Raises Cancelled if the user cancelled (useful inside deep loops)."""
        if self.cancelled:
            raise Cancelled()

    def stop(self):
        raise Cancelled()

    # ---- internal ----
    def _send(self, kind):
        with self._lock:
            logs, self._logbuf = self._logbuf, []
        msg = {"id": self.id, "name": self.name, "kind": kind, "state": self.state, "pct": self.pct,
               "text": self.text, "data": self.data}
        if logs:
            msg["log"] = logs
        if kind == "end":
            msg["result"] = self.result
        try:
            _emit("job", msg)
        except Exception:
            pass

    def info(self):
        return {"id": self.id, "name": self.name, "state": self.state, "pct": self.pct, "text": self.text}


def start(name, fn, *args, **kwargs):
    job = Job(name)
    _jobs[job.id] = job

    def run():
        try:
            job.result = fn(job, *args, **kwargs)
            job.state = "done"
        except Cancelled:
            job.state = "cancelled"
        except Exception as e:
            job.state = "error"
            job.result = {"error": str(e), "trace": traceback.format_exc(limit=6)}
            print(f"[job {name}]", traceback.format_exc())
        job.pct = 1.0 if job.state == "done" else job.pct
        job._send("end")
        t = threading.Timer(600, lambda: _jobs.pop(job.id, None))
        t.daemon = True  # a pending Timer must never keep the process alive after the window is gone
        t.start()

    threading.Thread(target=run, daemon=True, name=f"job-{name}").start()
    return job.id


def cancel(job_id):
    j = _jobs.get(job_id)
    if j:
        j.cancelled = True
        return True
    return False


def running():
    return [j.info() for j in _jobs.values() if j.state == "running"]
