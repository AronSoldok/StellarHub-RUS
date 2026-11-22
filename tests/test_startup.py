"""Start, single instance and log: the pieces that must never leave the user with nothing."""
import io
import os
import socket
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock

os.environ["STELLARHUB_NO_DIALOGS"] = "1"
os.environ["STELLARHUB_NO_SPLASH"] = "1"

from stellarhub import instance, log, paths  # noqa: E402


class LogOnce(unittest.TestCase):
    def test_repeated_lines_are_written_once_and_counted(self):
        fh = io.StringIO()
        out_log = log.LogOnce(fh)
        for _ in range(50):
            out_log.write("[telemetry] boom\n")
        out_log.write("something else\n")
        out = fh.getvalue()
        self.assertEqual(out.count("[telemetry] boom"), 1)
        self.assertIn("49 more times", out)
        self.assertIn("something else", out)

    def test_many_threads_printing_lose_and_repeat_nothing(self):
        buf = io.StringIO()
        lo = log.LogOnce(buf)
        old = sys.getswitchinterval()
        sys.setswitchinterval(1e-6)  # switch threads as often as possible: the unlocked version duplicated lines
        self.addCleanup(sys.setswitchinterval, old)

        def w(i):
            for k in range(1500):
                lo.write(f"thread {i} line {k}\n")
        ts = [threading.Thread(target=w, args=(i,)) for i in range(6)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        lines = buf.getvalue().splitlines()
        self.assertEqual(len(lines), 9000)
        self.assertEqual(len(set(lines)), 9000)

    def test_rotate_keeps_one_old_copy(self):
        d = tempfile.mkdtemp()
        p = os.path.join(d, "stellarhub.log")
        with open(p, "wb") as fh:
            fh.write(b"x" * 3000)
        log.rotate_log(p, limit=2000)
        self.assertFalse(os.path.exists(p))
        self.assertTrue(os.path.exists(p + ".1"))
        with open(p, "wb") as fh:
            fh.write(b"y")
        log.rotate_log(p, limit=2000)  # small: left alone
        self.assertTrue(os.path.exists(p))


class Dialogs(unittest.TestCase):
    def test_tests_never_get_a_modal_box(self):
        self.assertFalse(paths.dialogs_allowed())
        with mock.patch.object(log.ctypes.windll.user32, "MessageBoxW") as box:
            log.fatal("test message")
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
        with mock.patch.object(instance, "SINGLE_PORT", self.serve(b"ok")):
            self.assertTrue(instance.ask_running_to_show(1.0))

    def test_a_deaf_copy_is_not_taken_for_an_answer(self):
        with mock.patch.object(instance, "SINGLE_PORT", self.serve(b"", hold=1.5)):
            t = time.time()
            self.assertFalse(instance.ask_running_to_show(0.4))
            self.assertLess(time.time() - t, 1.2)

    def test_nobody_listening_is_quick_and_false(self):
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        with mock.patch.object(instance, "SINGLE_PORT", port):
            self.assertFalse(instance.ask_running_to_show(0.4))

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
        with mock.patch.object(instance, "SINGLE_PORT", port):
            instance.listen_single(FakeApi())
            silent = socket.create_connection(("127.0.0.1", port), timeout=1)  # connects and says nothing
            self.addCleanup(silent.close)
            t = time.time()
            self.assertTrue(instance.ask_running_to_show(5))  # a second client still gets served
            self.assertLess(time.time() - t, 4)
        self.assertEqual(FakeApi.shown, 1)

    def test_a_quitting_copy_does_not_answer_show(self):
        """Quit, then open StellarHub again within a second: the copy that is closing must not answer "ok" (the new
        one would exit thinking it was shown, and nothing would open); it says nothing and the new one waits."""
        class Quitting:
            _quitting = True
            shown = 0

            def show_main(self):
                Quitting.shown += 1
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        with mock.patch.object(instance, "SINGLE_PORT", port):
            instance.listen_single(Quitting())
            self.assertFalse(instance.ask_running_to_show(0.6))
        self.assertEqual(Quitting.shown, 0)

    def test_a_copy_that_just_started_is_given_a_minute(self):
        young = mock.Mock(create_time=lambda: time.time() - 5)
        old = mock.Mock(create_time=lambda: time.time() - 600)
        self.assertLess(instance._age(young), 10)
        self.assertGreater(instance._age(old), 500)
        self.assertEqual(instance._age(mock.Mock(create_time=mock.Mock(side_effect=OSError))), 60.0)


class Jobs(unittest.TestCase):
    def test_finished_jobs_need_no_timer_thread(self):
        from stellarhub.engine import jobs
        with mock.patch.object(jobs.threading, "Timer", side_effect=AssertionError("a Timer per job")):
            jid = jobs.start("t", lambda job: None)
            for _ in range(50):
                if jobs._jobs[jid].ended:
                    break
                time.sleep(0.05)
        self.assertTrue(jobs._jobs[jid].ended)


if __name__ == "__main__":
    unittest.main()
