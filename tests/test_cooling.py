"""Cooling policies and failure paths use a fake device: tests never write to hardware."""
import json
import multiprocessing
import re
import threading
from pathlib import Path
import tempfile
import time
import unittest
from unittest import mock

from stellarhub.engine import cooling as C
from stellarhub.engine.cooling_model import Policy, validate, interpolate
from stellarhub.engine.cooling_nvml import Nvidia


class Device:
    def __init__(self):
        self.auto, self.temp, self.speed = True, 55, 60
        self.writes, self.resets = [], 0
        self.fail_set = self.fail_reset = self.fail_read = False

    def discover(self):
        return [{'id': 'GPU-test/0', 'minimum': 50, 'critical': 85, 'verified': False}]

    def read(self, key):
        if self.fail_read:
            raise RuntimeError('sensor lost')
        return {'automatic': self.auto, 'temperature': self.temp, 'speed': self.speed}

    def set(self, key, speed):
        self.auto = False
        if self.fail_set:
            raise RuntimeError('write failed')
        self.writes.append(speed)

    def restore(self, key):
        self.resets += 1
        if self.fail_reset:
            raise RuntimeError('reset failed')
        self.auto = True

    def close(self):
        pass


class NvidiaAdapter(unittest.TestCase):
    def test_policy_values_match_the_driver_enum(self):
        adapter = Nvidia()
        adapter.devices['fan'] = (None, 0)

        def read_policy(name, *args):
            if name == 'nvmlDeviceGetFanControlPolicy_v2':
                args[-1]._obj.value = policy

        with mock.patch.object(adapter, 'call', side_effect=read_policy):
            policy = 0
            self.assertTrue(adapter.read('fan')['automatic'])
            policy = 1
            self.assertFalse(adapter.read('fan')['automatic'])
            policy = 2
            with self.assertRaisesRegex(RuntimeError, 'unknown policy 2'):
                adapter.read('fan')

    def test_failure_to_read_limits_explains_why_no_channel_was_offered(self):
        adapter = Nvidia()

        def driver(name, *args):
            if name in ('nvmlDeviceGetCount_v2', 'nvmlDeviceGetNumFans'):
                args[-1]._obj.value = 1
            elif name == 'nvmlDeviceGetName':
                args[1].value = b'NVIDIA test GPU'
            elif name == 'nvmlDeviceGetMinMaxFanSpeed':
                raise RuntimeError('NVML nvmlDeviceGetMinMaxFanSpeed: 3')

        with mock.patch.object(adapter, 'open'), mock.patch.object(adapter, 'call', side_effect=driver):
            self.assertEqual(adapter.discover(), [])
            self.assertEqual(adapter.discovery_details, [{
                'device': 'NVIDIA test GPU', 'reason': 'Unable to read NVIDIA fan capabilities.',
                'detail': 'NVML nvmlDeviceGetMinMaxFanSpeed: 3',
            }])


class Curves(unittest.TestCase):
    def test_rejects_untrusted_numbers_and_non_monotonic_curves(self):
        for speed in (True, '60', float('nan'), float('inf'), -1, 101, 49):
            with self.subTest(speed=speed), self.assertRaises(ValueError):
                validate({'mode': 'fixed', 'speed': speed}, 50)
        for points in ([[30, 60], [30, 70]], [[50, 70], [40, 80]], [[30, 80], [70, 60]], [[30, 40], [80, 100]]):
            with self.subTest(points=points), self.assertRaises(ValueError):
                validate({'mode': 'curve', 'points': points}, 50)

    def test_interpolation_clamps_at_both_ends(self):
        points = [[30, 50], [80, 100]]
        self.assertEqual(interpolate(points, 10), 50)
        self.assertEqual(interpolate(points, 55), 75)
        self.assertEqual(interpolate(points, 100), 100)

    def test_immediate_rise_gradual_fall_and_hysteresis(self):
        p = Policy({'mode': 'curve', 'points': [[30, 50], [80, 100]]}, 50, 90)
        self.assertEqual(p.step(50, 1), 70)
        self.assertEqual(p.step(52, 2), 72)
        self.assertEqual(p.step(50, 3), 72)  # 2 C fall is inside the hysteresis
        self.assertEqual(p.step(30, 4), 67)  # at most 5 percentage points/s down

    def test_fixed_speed_does_not_bypass_thermal_safeguard(self):
        p = Policy({'mode': 'fixed', 'speed': 50}, 50, 85)
        self.assertEqual(p.step(55, 1), 50)
        self.assertEqual(p.step(85, 2), 100)

    def test_sleep_gap_and_invalid_sensor_fail_closed(self):
        p = Policy({'mode': 'fixed'}, 50, 85)
        p.step(50, 1)
        with self.assertRaises(ValueError):
            p.step(60, 12)
        with self.assertRaises(ValueError):
            p.step(float('nan'), 13)


class Recovery(unittest.TestCase):
    def setUp(self):
        self.device = Device()
        self.control = C.Controller(self.device)
        self.key = 'GPU-test/0'

    def test_discovery_and_untouched_restore_do_not_write(self):
        self.control.tick(time.monotonic())
        self.control.restore(self.key)
        self.control.close()
        self.assertEqual(self.device.writes, [])
        self.assertEqual(self.device.resets, 0)

    def test_no_control_before_explicit_verification(self):
        with self.assertRaises(ValueError):
            self.control.apply(self.key, {'mode': 'fixed'})
        self.assertEqual(self.device.writes, [])

    def test_verification_restores_and_requires_automatic_initial_policy(self):
        self.control.verify(self.key)
        self.assertTrue(self.device.auto)
        self.assertEqual(self.device.resets, 2)
        self.assertTrue(self.control.channels[self.key]['verified'])
        self.device.auto = False
        with self.assertRaises(ValueError):
            self.control.verify(self.key)

    def test_failed_write_after_policy_change_is_restored(self):
        self.device.fail_set = True
        with self.assertRaises(RuntimeError):
            self.control.verify(self.key)
        self.assertTrue(self.device.auto)
        self.assertFalse(self.control.channels[self.key]['verified'])

    def test_hot_gpu_is_not_switched_to_manual_for_verification(self):
        self.device.temp = 84
        with self.assertRaises(ValueError):
            self.control.verify(self.key)
        self.assertEqual(self.device.writes, [])
        self.assertEqual(self.device.resets, 0)

    def test_failed_recovery_is_retained_and_retried(self):
        self.control.verify(self.key)
        self.control.apply(self.key, {'mode': 'fixed'})
        self.device.fail_reset = True
        with self.assertRaises(RuntimeError):
            self.control.restore(self.key)
        self.assertIn(self.key, self.control.touched)
        self.device.fail_reset = False
        self.control.tick(time.monotonic())
        self.assertTrue(self.device.auto)
        self.assertNotIn(self.key, self.control.touched)

    def test_missing_sensor_revokes_verification_and_stops_control(self):
        self.control.verify(self.key)
        self.control.apply(self.key, {'mode': 'fixed'})
        self.device.fail_read = True
        self.control.tick(time.monotonic())
        self.assertTrue(self.device.auto)
        self.assertNotIn(self.key, self.control.active)
        self.assertFalse(self.control.channels[self.key]['verified'])

    def test_reported_zero_speed_triggers_recovery(self):
        self.control.verify(self.key)
        self.control.apply(self.key, {'mode': 'fixed'})
        self.device.speed = 0
        for i in range(3):
            self.control.tick(time.monotonic() + i)
        self.assertTrue(self.device.auto)
        self.assertFalse(self.control.active)

    def test_close_returns_every_owned_channel_to_automatic(self):
        self.control.verify(self.key)
        self.control.apply(self.key, {'mode': 'fixed'})
        self.assertFalse(self.device.auto)
        self.assertEqual(self.control.close(), [])
        self.assertTrue(self.device.auto)

    def test_external_owner_is_not_overwritten_by_apply(self):
        self.control.verify(self.key)
        self.device.auto = False
        writes = len(self.device.writes)
        with self.assertRaises(ValueError):
            self.control.apply(self.key, {'mode': 'fixed'})
        self.assertEqual(len(self.device.writes), writes)


class Api(unittest.TestCase):
    def test_every_cooling_ui_sentence_has_a_russian_translation(self):
        root = Path(__file__).resolve().parents[1] / 'stellarhub/ui'
        catalog = {}
        for path in (root / 'i18n/ru').glob('*.json'):
            catalog.update(json.loads(path.read_text(encoding='utf-8')))
        source = (root / 'js/modules/monitor-cooling.js').read_text(encoding='utf-8')
        keys = set(re.findall(r"\bt\('([^']*)'", source))
        self.assertGreater(len(keys), 30)
        self.assertFalse(keys - set(catalog))

    def test_unprivileged_write_does_not_even_start_controller(self):
        with mock.patch.object(C.config, 'is_admin', return_value=False), mock.patch.object(C, 'manager') as manager:
            for name, args in [('verify', ['gpu']), ('apply', ['gpu', {'mode': 'fixed'}])]:
                with self.assertRaises(PermissionError):
                    getattr(C, name)(*args)
            manager.assert_not_called()

    def test_corrupt_saved_profile_cannot_reach_ui(self):
        manager = mock.Mock(lock=C.threading.RLock(), snapshot={'channels': [{'id': 'GPU-test/0', 'minimum': 50}]})
        with mock.patch.object(C, 'manager', return_value=manager), mock.patch.object(C, 'profiles', return_value={
            'GPU-test/0': {'mode': 'curve', 'points': [['<script>', 50], [80, 100]]}}):
            self.assertEqual(C.status()['profiles'], {})

    def test_saved_profile_never_creates_a_write_command_at_status(self):
        manager = mock.Mock(lock=C.threading.RLock(), snapshot={'channels': [{'id': 'GPU-test/0', 'minimum': 50}]})
        with mock.patch.object(C, 'manager', return_value=manager), mock.patch.object(C, 'profiles', return_value={
            'GPU-test/0': {'mode': 'fixed', 'speed': 60}}):
            self.assertEqual(C.status()['profiles']['GPU-test/0']['speed'], 60)
            manager.command.assert_not_called()


class Worker(unittest.TestCase):
    def test_pipe_loss_restores_owned_channel_without_any_ui_callback(self):
        device = Device()
        parent, child = multiprocessing.Pipe()
        with mock.patch.object(C, 'Nvidia', return_value=device), mock.patch.object(C, '_lease', return_value=(mock.Mock(), 1)):
            thread = threading.Thread(target=C.worker, args=(child,), daemon=True)
            thread.start()
            try:
                for seq, op in [(1, 'verify'), (2, 'apply')]:
                    parent.send({'seq': seq, 'op': op, 'key': 'GPU-test/0', 'profile': {'mode': 'fixed'}})
                    deadline = time.monotonic() + 3
                    while time.monotonic() < deadline:
                        if parent.poll(.1):
                            result = parent.recv()
                            if result.get('reply') == seq:
                                self.assertTrue(result.get('ok'), result)
                                break
                    else:
                        self.fail('worker did not acknowledge command')
                self.assertFalse(device.auto)
            finally:
                parent.close()  # equivalent to the parent dying: no stop command is sent
                thread.join(3)
            self.assertFalse(thread.is_alive())
            self.assertTrue(device.auto)


if __name__ == '__main__':
    unittest.main()
