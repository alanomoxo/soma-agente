"""Interface language: English or Portuguese (Brazil).

Shared by every Soma program through <data folder>/language.txt ("pt" or
"en", written by the installer and the Adobe panel). Without that file the
program's own language decides (hint()), then the system language.
"""
import locale
import os
import sys
import time

from . import system

_hint = None


def hint(language_code):
    """The host program's interface language (e.g. "pt_BR"), used when no choice was saved."""
    global _hint
    _hint = language_code or None
    _cache[1] = None


def _system_language():
    if sys.platform == "win32":
        try:
            import ctypes
            return locale.windows_locale.get(ctypes.windll.kernel32.GetUserDefaultUILanguage(), "")
        except (AttributeError, OSError):
            pass
    try:
        return locale.getlocale()[0] or os.environ.get("LANG", "")
    except ValueError:
        return os.environ.get("LANG", "")


_cache = [0.0, None]


def lang():
    # Panels redraw often; read the saved choice at most every few seconds.
    now = time.time()
    if _cache[1] is None or now - _cache[0] > 3:
        _cache[:] = [now, _read()]
    return _cache[1]


def _read():
    try:
        with open(os.path.join(system.data_directory(), "language.txt"), "r", encoding="utf-8") as handle:
            saved = handle.read().strip().lower()
        if saved in ("pt", "en"):
            return saved
    except OSError:
        pass
    code = (_hint or _system_language() or "").lower()
    return "pt" if code.startswith("pt") or code.startswith("portuguese") else "en"


def choice():
    """The saved choice: "pt", "en" or "auto"."""
    try:
        with open(os.path.join(system.data_directory(), "language.txt"), "r", encoding="utf-8") as handle:
            saved = handle.read().strip().lower()
        return saved if saved in ("pt", "en") else "auto"
    except OSError:
        return "auto"


def set_choice(value):
    """Saves "pt", "en" or "auto" (follow the program and system) for every Soma program."""
    path = os.path.join(system.data_directory(), "language.txt")
    try:
        if value in ("pt", "en"):
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(value)
        elif os.path.exists(path):
            os.remove(path)
    except OSError:
        pass
    _cache[1] = None


def L(en, pt):
    """Picks the text for the current language."""
    return pt if lang() == "pt" else en
