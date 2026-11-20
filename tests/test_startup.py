"""Start, single instance and log: the pieces that must never leave the user with nothing."""
import io
import os
import socket
import tempfile
import threading
import time
import unittest
from unittest import mock

os.environ["STELLARHUB_NO_DIALOGS"] = "1"
os.environ["STELLARHUB_NO_SPLASH"] = "1"

from stellarhub import app, paths  # noqa: E402


class LogOnce(unittest.TestCase):
    def test_repeated_lines_are_written_once_and_counted(self):
        fh = io.StringIO()
        log = app._LogOnce(fh)
        for _ in range(50):
            log.write("[telemetry] boom\n")
        log.write("something else\n")
        out = fh.getvalue()
        self.assertEqual(out.count("[telemetry] boom"), 1)
        self.assertIn("49 more times", out)
        self.assertIn("something else", out)

    def test_rotate_keeps_one_old_copy(self):
        d = tempfile.mkdtemp()
        p = os.path.join(d, "stellarhub.log")
        with open(p, "wb") as fh:
            fh.write(b"x" * 3000)
        app._rotate_log(p, limit=2000)
        self.assertFalse(os.path.exists(p))
        self.assertTrue(os.path.exists(p + ".1"))
        with open(p, "wb") as fh:
            fh.write(b"y")
        app._rotate_log(p, limit=2000)  # small: left alone
        self.assertTrue(os.path.exists(p))


class Dialogs(unittest.TestCase):
    def test_tests_never_get_a_modal_box(self):
        self.assertFalse(paths.dialogs_allowed())
        with mock.patch.object(app.ctypes.windll.user32, "MessageBoxW") as box:
            app._fatal("test message")
        box.assert_not_called()


class SingleInstance(unittest.TestCase):
    def serve(self, reply, hold=0.0):
        srv = socket.socket()
        srv.bind(("127.0.0.1", 0))
        srv.listen(2)
        self.addCleanup(srv.close)

        def loop():
            try:
                conn, _ = srv.accept()
                with conn:
                    conn.recv(8)
                    time.sleep(hold)
                    if reply:
                        conn.sendall(reply)
            except OSError:
                pass
        threading.Thread(target=loop, daemon=True).start()
        return srv.getsockname()[1]

    def test_show_needs_an_answer(self):
        with mock.patch.object(app, "SINGLE_PORT", self.serve(b"ok")):
            self.assertTrue(app._ask_running_to_show(1.0))

    def test_a_deaf_copy_is_not_taken_for_an_answer(self):
        with mock.patch.object(app, "SINGLE_PORT", self.serve(b"", hold=1.5)):
            t = time.time()
            self.assertFalse(app._ask_running_to_show(0.4))
            self.assertLess(time.time() - t, 1.2)

    def test_nobody_listening_is_quick_and_false(self):
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        with mock.patch.object(app, "SINGLE_PORT", port):
            self.assertFalse(app._ask_running_to_show(0.4))

    def test_the_listener_survives_a_silent_client(self):
        class FakeApi:
            shown = 0

            def show_main(self):
                FakeApi.shown += 1

            def quit(self, force=False):
                pass
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        with mock.patch.object(app, "SINGLE_PORT", port):
            app._listen_single(FakeApi())
            silent = socket.create_connection(("127.0.0.1", port), timeout=1)  # connects and says nothing
            self.addCleanup(silent.close)
            t = time.time()
            self.assertTrue(app._ask_running_to_show(5))  # a second client still gets served
            self.assertLess(time.time() - t, 4)
        self.assertEqual(FakeApi.shown, 1)


class Jobs(unittest.TestCase):
    def test_the_cleanup_timer_never_keeps_the_process_alive(self):
        from stellarhub.engine import jobs
        made = []
        real = jobs.threading.Timer

        class T(real):
            def __init__(self, *a, **k):
                super().__init__(*a, **k)
                made.append(self)

            def start(self):
                pass
        with mock.patch.object(jobs.threading, "Timer", T):
            jobs.start("t", lambda job: None)
            for _ in range(50):
                if made:
                    break
                time.sleep(0.05)
        self.assertTrue(made and all(t.daemon for t in made))


if __name__ == "__main__":
    unittest.main()
