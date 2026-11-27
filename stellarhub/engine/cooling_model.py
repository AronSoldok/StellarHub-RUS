"""Hardware-independent fan policy. Temperatures in Celsius, output in percent."""
import math


def number(value, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError('Cooling value is outside the supported range.')
    return float(value)


def validate(profile, minimum):
    if not isinstance(profile, dict) or profile.get('mode') not in ('fixed', 'curve'):
        raise ValueError('Invalid cooling profile.')
    result = {'mode': profile['mode'], 'speed': number(profile.get('speed', 60), minimum, 100),
              'hysteresis': number(profile.get('hysteresis', 3), 0, 10),
              'fallRate': number(profile.get('fallRate', 5), 1, 20)}
    points = profile.get('points', [[30, minimum], [50, max(60, minimum)], [70, max(85, minimum)], [80, 100]])
    if not isinstance(points, list) or not 2 <= len(points) <= 12:
        raise ValueError('Use between 2 and 12 curve points.')
    result['points'] = []
    for p in points:
        if not isinstance(p, (list, tuple)) or len(p) != 2:
            raise ValueError('Invalid curve point.')
        t, speed = number(p[0], 0, 100), number(p[1], minimum, 100)
        if result['points'] and (t <= result['points'][-1][0] or speed < result['points'][-1][1]):
            raise ValueError('Curve temperatures must increase and speed must not decrease.')
        result['points'].append([t, speed])
    return result


def interpolate(points, temperature):
    if temperature <= points[0][0]:
        return points[0][1]
    for (a, x), (b, y) in zip(points, points[1:]):
        if temperature <= b:
            return x + (y - x) * (temperature - a) / (b - a)
    return points[-1][1]


class Policy:
    def __init__(self, profile, minimum, critical):
        self.profile = validate(profile, minimum)
        self.critical = number(critical, 40, 110)
        self.temperature = self.output = self.at = None

    def step(self, temperature, now):
        temperature = number(temperature, 0, 120)
        dt = 1 if self.at is None else now - self.at
        if not 0 < dt <= 5:
            raise ValueError('Cooling sensor data is stale.')
        self.at = now
        if temperature >= self.critical:
            # No smoothing or delay at the device's reported slowdown threshold.
            self.output = 100
            self.temperature = temperature
            return 100
        if self.temperature is None or temperature >= self.temperature or self.temperature - temperature > self.profile['hysteresis']:
            self.temperature = temperature
        target = self.profile['speed'] if self.profile['mode'] == 'fixed' else interpolate(self.profile['points'], self.temperature)
        self.output = target if self.output is None else max(target, self.output - self.profile['fallRate'] * dt)
        return round(self.output)
