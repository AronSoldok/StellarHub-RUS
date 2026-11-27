"""Optional NVIDIA adapter, using the installed driver's documented NVML API.

Discovery never writes. A read-capable channel is only a candidate until an explicit
verification restores default policy, tests the current speed, then restores again.
No kernel driver is bundled and no notebook EC registers are guessed.
"""
import ctypes as c
import os

NVML_FAN_POLICY_TEMPERATURE_CONTINOUS_SW = 0  # Name as spelled in nvml.h.
NVML_FAN_POLICY_MANUAL = 1


class Nvidia:
    def __init__(self):
        self.lib = None
        self.devices = {}
        self.discovery_details = []

    def call(self, name, *args):
        rc = getattr(self.lib, name)(*args)
        if rc:
            raise RuntimeError(f'NVML {name}: {rc}')

    def open(self):
        if self.lib is not None:
            return
        # Absolute driver locations only: do not load a DLL from the working directory.
        system_dir = c.create_unicode_buffer(32768)
        if not c.windll.kernel32.GetSystemDirectoryW(system_dir, len(system_dir)):
            raise RuntimeError('The NVIDIA fan interface is not available.')
        for path in (os.path.join(system_dir.value, 'nvml.dll'),
                     r'C:\Program Files\NVIDIA Corporation\NVSMI\nvml.dll'):
            try:
                lib = c.WinDLL(path)
                for name in ('nvmlInit_v2', 'nvmlShutdown', 'nvmlDeviceSetFanSpeed_v2', 'nvmlDeviceSetDefaultFanSpeed_v2'):
                    getattr(lib, name).restype = c.c_int
                self.lib = lib
                self.call('nvmlInit_v2')
                return
            except (OSError, AttributeError, RuntimeError):
                self.lib = None
        raise RuntimeError('The NVIDIA fan interface is not available.')

    def discover(self):
        self.devices.clear()
        self.discovery_details.clear()
        self.open()
        count = c.c_uint()
        self.call('nvmlDeviceGetCount_v2', c.byref(count))
        rows = []
        for index in range(count.value):
            dev = c.c_void_p()
            self.call('nvmlDeviceGetHandleByIndex_v2', index, c.byref(dev))
            uuid, name = c.create_string_buffer(96), c.create_string_buffer(96)
            self.call('nvmlDeviceGetUUID', dev, uuid, len(uuid))
            self.call('nvmlDeviceGetName', dev, name, len(name))
            device_name = name.value.decode('utf-8', 'replace')
            fans, low, high, critical = c.c_uint(), c.c_uint(), c.c_uint(), c.c_uint()
            try:
                self.call('nvmlDeviceGetNumFans', dev, c.byref(fans))
                if not fans.value:
                    self.discovery_details.append({'device': device_name, 'reason': 'NVIDIA reports no fans for this GPU.'})
                    continue
                self.call('nvmlDeviceGetMinMaxFanSpeed', dev, c.byref(low), c.byref(high))
                self.call('nvmlDeviceGetTemperatureThreshold', dev, 1, c.byref(critical))  # slowdown
                if high.value != 100 or low.value > 100 or not 40 <= critical.value <= 110:
                    self.discovery_details.append({'device': device_name, 'reason': 'Unsupported fan limits or GPU temperature threshold.',
                                                   'detail': f'{low.value}–{high.value}%, {critical.value} °C'})
                    continue
            except (AttributeError, RuntimeError) as exc:
                self.discovery_details.append({'device': device_name, 'reason': 'Unable to read NVIDIA fan capabilities.', 'detail': str(exc)})
                continue
            for fan in range(fans.value):
                key = f'{uuid.value.decode()}/{fan}'
                # Conservative initial floor; zero-RPM and pump control are not offered.
                self.devices[key] = (dev, fan)
                try:
                    reading = self.read(key)
                except (AttributeError, RuntimeError) as exc:
                    self.devices.pop(key, None)
                    self.discovery_details.append({'device': device_name, 'fan': fan + 1,
                                                   'reason': 'Unable to read NVIDIA fan status.', 'detail': str(exc)})
                    continue
                rows.append({'id': key, 'name': device_name, 'fan': fan + 1,
                             'source': 'NVIDIA NVML', 'minimum': max(50, low.value), 'critical': critical.value,
                             'sensor': 'gpu', 'rpm': None, 'verified': False, **reading})
        return rows

    def read(self, key):
        dev, fan = self.devices[key]
        temp, speed, policy = c.c_uint(), c.c_uint(), c.c_uint()
        self.call('nvmlDeviceGetTemperature', dev, 0, c.byref(temp))
        self.call('nvmlDeviceGetFanSpeed_v2', dev, fan, c.byref(speed))
        self.call('nvmlDeviceGetFanControlPolicy_v2', dev, fan, c.byref(policy))
        if policy.value not in (NVML_FAN_POLICY_TEMPERATURE_CONTINOUS_SW, NVML_FAN_POLICY_MANUAL):
            raise RuntimeError(f'NVML nvmlDeviceGetFanControlPolicy_v2: unknown policy {policy.value}')
        return {'temperature': temp.value, 'speed': speed.value, 'automatic': policy.value == NVML_FAN_POLICY_TEMPERATURE_CONTINOUS_SW}

    def set(self, key, speed):
        dev, fan = self.devices[key]
        self.call('nvmlDeviceSetFanSpeed_v2', dev, fan, int(speed))

    def restore(self, key):
        dev, fan = self.devices[key]
        self.call('nvmlDeviceSetDefaultFanSpeed_v2', dev, fan)

    def close(self):
        if self.lib:
            self.lib.nvmlShutdown()
            self.lib = None
