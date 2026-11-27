"""Fan control supervisor. The UI never owns the regulation loop.

Only the installed NVML provider is enabled initially. Profiles are saved by GPU
UUID/fan index, never applied on startup. A child observes parent heartbeats and
restores touched channels when the UI process exits. The parent observes the child.
"""
import atexit
import ctypes
import json
import multiprocessing as mp
import os
from functools import wraps
from pathlib import Path
import queue
import threading
import time

from .. import config
from ..i18n import tr
from .cooling_model import Policy, validate
from .cooling_nvml import Nvidia

EXPORTS = {'status', 'verify', 'apply', 'restore', 'release_idle'}
_manager = None
_guard = threading.Lock()


class Controller:
    """Testable state machine; every exit from manual control attempts restoration."""
    def __init__(self, provider, on_ownership=None):
        self.provider = provider
        self.channels = {r['id']: r for r in provider.discover()}
        self.active = {}
        self.touched = set()
        self.error = ''
        self.on_ownership = on_ownership or (lambda key: None)

    def restore(self, key):
        if key not in self.touched:
            return  # never take ownership of a channel controlled by somebody else
        self.active.pop(key, None)
        self.provider.restore(key)
        if not self.provider.read(key)['automatic']:
            raise ValueError('Automatic fan control could not be confirmed.')
        self.touched.discard(key)
        self.channels[key].update(mode='auto', target=None)

    def verify(self, key):
        row = self.channels[key]
        current = self.provider.read(key)
        if not current['automatic']:
            raise ValueError('Another program may be controlling this fan. Return it to automatic mode first.')
        if current['temperature'] >= row['critical'] - 5:
            raise ValueError('The GPU is too hot to verify fan control. Wait for it to cool down.')
        row['verified'] = False
        self.on_ownership(key)  # publish recovery intent before the first driver write
        self.touched.add(key)
        try:
            self.provider.restore(key)  # verify the recovery API BEFORE attempting manual control
            self.provider.set(key, max(row['minimum'], min(100, current['speed'])))
        finally:
            self.restore(key)
        if not self.provider.read(key)['automatic']:
            raise ValueError('Automatic fan control could not be confirmed.')
        row['verified'] = True

    def apply(self, key, profile):
        row = self.channels[key]
        if not row['verified']:
            raise ValueError('Verify this fan before applying a profile.')
        policy = Policy(profile, row['minimum'], row['critical'])
        current = self.provider.read(key)
        if key not in self.active and not current['automatic']:
            raise ValueError('Another program may be controlling this fan. Return it to automatic mode first.')
        self.on_ownership(key)
        self.touched.add(key)
        self.active[key] = policy
        try:
            target = policy.step(current['temperature'], time.monotonic())
            self.provider.set(key, target)
            row.update(mode=profile['mode'], target=target)
        except Exception:
            self.restore(key)
            raise

    def tick(self, now):
        for key, row in self.channels.items():
            try:
                row.update(self.provider.read(key))
                row['at'] = now
                row.pop('error', None)
                if key in self.touched and key not in self.active:
                    self.restore(key)  # retry a previous unsuccessful restore; never resume a failed policy
                if key in self.active:
                    if row['automatic']:
                        raise ValueError('Fan ownership changed. Automatic control has been restored.')
                    policy = self.active[key]
                    row['zeroSamples'] = row.get('zeroSamples', 0) + 1 if row['speed'] == 0 else 0
                    if row['zeroSamples'] >= 3:
                        raise ValueError('The fan reports zero speed during manual control.')
                    target = policy.step(row['temperature'], now)
                    self.provider.set(key, target)
                    row['target'] = target
            except Exception as exc:
                row['error'] = str(exc)
                row['verified'] = False
                if key in self.touched:
                    try:
                        self.restore(key)
                    except Exception as restore_error:
                        row['error'] += '; ' + str(restore_error)

    def close(self):
        errors = []
        for key in list(self.touched):
            try:
                self.restore(key)
            except Exception as exc:
                errors.append(f'{key}: {exc}')
        return errors


def _lease():
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.CreateMutexW.restype = ctypes.c_void_p
    kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_wchar_p]
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel.CreateMutexW(None, False, r'Global\StellarHub.Cooling.NVML.v1')
    if not handle or ctypes.get_last_error() == 183:
        if handle:
            kernel.CloseHandle(handle)
        raise RuntimeError('Another StellarHub instance owns fan control, or access is denied.')
    return kernel, handle


def worker(pipe):
    provider, controller, lease = Nvidia(), None, None
    try:
        lease = _lease()
        controller = Controller(provider, lambda key: pipe.send({'arming': key}))
        heartbeat, last_tick = time.monotonic(), 0
        while time.monotonic() - heartbeat < 6:
            if pipe.poll(.2):
                message = pipe.recv()
                heartbeat = time.monotonic()
                op = message['op']
                if op == 'stop':
                    break
                if op != 'ping':
                    try:
                        key = message['key']
                        if key not in controller.channels:
                            raise ValueError('The selected fan is no longer available.')
                        if op == 'verify':
                            controller.verify(key)
                        elif op == 'apply':
                            controller.apply(key, message['profile'])
                        elif op == 'restore':
                            controller.restore(key)
                        else:
                            raise ValueError('Invalid cooling command.')
                        pipe.send({'reply': message['seq'], 'ok': True})
                    except Exception as exc:
                        pipe.send({'reply': message['seq'], 'error': str(exc)})
            now = time.monotonic()
            if now - last_tick >= 1:
                controller.tick(now)
                pipe.send({'channels': list(controller.channels.values()), 'touched': list(controller.touched), 'at': now})
                last_tick = now
    except (EOFError, BrokenPipeError):
        pass
    except Exception as exc:
        try:
            pipe.send({'error': str(exc), 'channels': []})
        except (EOFError, BrokenPipeError, OSError):
            pass
    finally:
        errors = controller.close() if controller else []
        try:
            pipe.send({'closed': True, 'unrestored': list(controller.touched) if controller else [],
                       'error': 'Automatic fan control could not be confirmed. ' + '; '.join(errors) if errors else ''})
        except OSError:
            pass
        provider.close()
        if lease:
            lease[0].CloseHandle(lease[1])
        pipe.close()


def rescue(keys):
    """Independent best-effort recovery if the controller process dies or stops answering."""
    p = Nvidia()
    errors = []
    try:
        channels = {r['id'] for r in p.discover()}
        for key in keys:
            if key not in channels:
                errors.append(key)
            else:
                p.restore(key)
    except Exception as exc:
        errors.append(str(exc))
    finally:
        p.close()
    return errors


def _rescue_process(keys, pipe):
    try:
        pipe.send(rescue(keys))
    finally:
        pipe.close()


def bounded_rescue(keys):
    ctx = mp.get_context('spawn')
    pipe, child = ctx.Pipe(duplex=False)
    process = ctx.Process(target=_rescue_process, args=(list(keys), child), name='StellarHub cooling recovery')
    process.start()
    child.close()
    try:
        if pipe.poll(5):
            return pipe.recv()
        return ['Recovery timed out. Check cooling in the manufacturer utility.']
    except (EOFError, OSError):
        return ['Recovery failed. Check cooling in the manufacturer utility.']
    finally:
        process.join(.2)
        if process.is_alive():
            process.terminate()
            process.join(.5)
        pipe.close()


class Manager:
    def __init__(self):
        self.lock = threading.RLock()
        self.commands = queue.Queue()
        self.pending = {}
        self.owned = set()
        self.release_requested = False
        self.snapshot = {'channels': [], 'starting': True}
        self.seq = 0
        self.stop_event = threading.Event()
        self.started = time.monotonic()
        ctx = mp.get_context('spawn')
        self.pipe, child = ctx.Pipe()
        self.process = ctx.Process(target=worker, args=(child,), name='StellarHub cooling')
        self.process.start()
        child.close()
        self.thread = threading.Thread(target=self._loop, daemon=True, name='cooling-supervisor')
        self.thread.start()

    def _loop(self):
        last = time.monotonic()
        touched = set()
        try:
            while not self.stop_event.is_set():
                while not self.commands.empty():
                    command = self.commands.get_nowait()
                    self.pipe.send(command)
                self.pipe.send({'op': 'ping'})
                end = time.monotonic() + .5
                while time.monotonic() < end and self.pipe.poll(.1):
                    data = self.pipe.recv()
                    last = time.monotonic()
                    with self.lock:
                        if 'arming' in data:
                            touched.add(data['arming'])
                            self.owned.add(data['arming'])
                        elif data.get('closed'):
                            touched = set(data['unrestored'])
                            self.owned = set(touched)
                            self.snapshot = {'channels': [], 'error': data.get('error') or self.snapshot.get('error') or 'The cooling controller has stopped.'}
                        elif 'reply' in data:
                            pending = self.pending.get(data['reply'])
                            if pending:
                                pending[1].update(data)
                                pending[0].set()
                        else:
                            self.snapshot = data
                            if 'touched' in data and not self.pending:
                                touched = set(data['touched'])
                                self.owned = set(touched)
                                if self.release_requested and not self.owned:
                                    self.stop_event.set()
                if not self.process.is_alive() or time.monotonic() - last > 10:
                    raise RuntimeError('The cooling controller stopped responding. Automatic recovery was requested.')
        except (EOFError, OSError, RuntimeError) as exc:
            with self.lock:
                self.snapshot = {'channels': [], 'error': self.snapshot.get('error') or str(exc) or 'The cooling controller has stopped.'}
        finally:
            try:
                self.pipe.send({'op': 'stop'})
            except OSError:
                pass
            self.process.join(3)
            if self.process.is_alive():
                self.process.terminate()  # only our own stalled child, then recover in a separate process
                self.process.join(2)
            try:
                while self.pipe.poll():
                    final = self.pipe.recv()
                    if 'arming' in final:
                        touched.add(final['arming'])
                    if final.get('closed'):
                        touched = set(final['unrestored'])
                        self.owned = set(touched)
                        if final.get('error'):
                            self.snapshot['error'] = final['error']
            except (EOFError, OSError):
                pass
            if touched:
                result = bounded_rescue(touched)
                if result:
                    with self.lock:
                        self.snapshot['error'] = 'Automatic fan control could not be confirmed. ' + '; '.join(result)
            self.pipe.close()
            with self.lock:
                for event, result in self.pending.values():
                    result['error'] = self.snapshot.get('error', 'The cooling controller has stopped.')
                    event.set()

    def command(self, op, key, profile=None):
        if not isinstance(key, str) or len(key) > 128:
            raise ValueError('Invalid fan identifier.')
        if not self.thread.is_alive():
            raise RuntimeError(self.snapshot.get('error', 'The cooling controller has stopped.'))
        with self.lock:
            self.seq += 1
            seq = self.seq
            event, result = threading.Event(), {}
            self.pending[seq] = (event, result)
            if op in ('apply', 'verify'):
                self.owned.add(key)
            self.commands.put({'op': op, 'key': key, 'profile': profile, 'seq': seq})
        try:
            if not event.wait(4):
                # Never return a timeout while a queued write could silently take effect later.
                self.stop_event.set()
                raise RuntimeError('The cooling controller stopped responding. Automatic recovery was requested.')
            if 'error' in result:
                raise RuntimeError(result['error'])
            return {'ok': True}
        finally:
            with self.lock:
                self.pending.pop(seq, None)

    def stop(self):
        self.stop_event.set()
        self.thread.join(12)


def manager():
    global _manager
    with _guard:
        if _manager is not None and _manager.release_requested and _manager.stop_event.is_set():
            _manager.stop()
            _manager = None
        if _manager is None:
            _manager = Manager()
        return _manager


def _profile_path():
    return Path(config.DATA_DIR) / 'cooling-profiles.json'


def profiles():
    try:
        data = json.loads(_profile_path().read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def status():
    m = manager()
    with m.lock:
        m.release_requested = False
        data = json.loads(json.dumps(m.snapshot))
    saved, safe_profiles = profiles(), {}
    for row in data.get('channels', []):
        if row['id'] in saved:
            try:
                safe_profiles[row['id']] = validate(saved[row['id']], row['minimum'])
            except (ValueError, TypeError):
                pass  # a user-writable file is never a source of trusted UI markup or device commands
    data.update(admin=config.is_admin(), profiles=safe_profiles)
    if data.get('at') and time.monotonic() - data['at'] > 4:
        data['stale'] = True
    if 'error' in data:
        data['error'] = tr(data['error'])
    for row in data.get('channels', []):
        if 'error' in row:
            row['error'] = tr(row['error'])
    return data


def translated(fn):
    @wraps(fn)
    def call(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except (ValueError, RuntimeError, PermissionError) as exc:
            raise type(exc)(tr(str(exc))) from exc
    return call


@translated
def verify(key):
    if not config.is_admin():
        raise PermissionError(tr('Open StellarHub as administrator to control fans.'))
    return manager().command('verify', key)


@translated
def apply(key, profile):
    if not config.is_admin():
        raise PermissionError(tr('Open StellarHub as administrator to control fans.'))
    m = manager()
    with m.lock:
        row = next((r for r in m.snapshot.get('channels', []) if r['id'] == key), None)
    if not row:
        raise ValueError(tr('The selected fan is no longer available.'))
    profile = validate(profile, row['minimum'])
    result = m.command('apply', key, profile)
    # Saving never arms a future session; every new session must verify the channel again.
    data = profiles()
    data[key] = profile
    try:
        path = _profile_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix('.tmp')
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        os.replace(tmp, path)
    except OSError:
        result['warning'] = tr('The profile is active, but could not be saved.')
    return result


@translated
def restore(key):
    return manager().command('restore', key)


def stop():
    global _manager
    with _guard:
        m, _manager = _manager, None
    if m:
        m.stop()


def release_idle():
    """Release NVML after leaving the view; an idle laptop GPU can power down."""
    global _manager
    with _guard:
        m = _manager
        if m:
            with m.lock:
                m.release_requested = True
                if m.pending or m.owned or m.snapshot.get('touched'):
                    return False
            _manager = None
    if m:
        m.stop()
    return True


atexit.register(stop)
