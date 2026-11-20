"""Runs a window's evaluate_js calls off the window thread, in order."""
import collections
import threading


class Sender:
    """One thread per window that runs its evaluate_js calls IN ORDER from a bounded queue. evaluate_js waits for
    WebView2's reply, which arrives on the window thread, so nobody on that thread may call it directly: they put the
    code here instead. Under pressure the oldest "lossy" item (job progress) goes first, never an "end"."""
    LIMIT = 600

    def __init__(self, window):
        self.window = window
        self._q = collections.deque()
        self._cv = threading.Condition()
        self._stop = False
        threading.Thread(target=self._run, daemon=True, name="js-sender").start()

    def put(self, code, lossy=False):
        with self._cv:
            if self._stop:
                return
            if len(self._q) >= self.LIMIT:
                for i, (_, l) in enumerate(self._q):
                    if l:
                        del self._q[i]
                        break
                else:
                    self._q.popleft()
            self._q.append((code, lossy))
            self._cv.notify()

    def stop(self):
        with self._cv:
            self._stop = True
            self._q.clear()
            self._cv.notify()

    def _run(self):
        while True:
            with self._cv:
                while not self._q and not self._stop:
                    self._cv.wait()
                if self._stop:
                    return
                code, _ = self._q.popleft()
            try:
                self.window.evaluate_js(code)
            except Exception:
                pass
