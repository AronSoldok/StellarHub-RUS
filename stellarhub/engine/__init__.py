"""Motor de StellarHub: la parte que toca Windows de verdad. Sin interfaz.

Cada módulo es un archivo stellarhub/engine/<nombre>.py que declara:
    EXPORTS = {"funcion", ...}   funciones que la interfaz puede llamar y que responden rápido (< ~2 s)
    JOBS = {"funcion", ...}      funciones largas: se ejecutan como tarea, reciben `job` como primer argumento
                                 y avisan del progreso con job.progress(...) / job.log(...)
La interfaz las llama con SH.engine('<modulo>', '<funcion>', ...args) o SH.job('<modulo>', '<funcion>', args, opciones).
Todo lo que devuelven tiene que poder pasarse a JSON.
"""
import importlib

_cache = {}


def module(name):
    if not isinstance(name, str) or not name.isidentifier() or name.startswith("_"):
        raise ValueError(f"módulo no válido: {name!r}")
    if name not in _cache:
        _cache[name] = importlib.import_module(f"{__name__}.{name}")
    return _cache[name]


def resolve(mod, fn, kind):
    m = module(mod)
    allowed = getattr(m, "JOBS" if kind == "job" else "EXPORTS", set())
    if fn not in allowed:
        raise PermissionError(f"{mod}.{fn} no está permitido como {kind}")
    return getattr(m, fn)
