"""Soma Hub auto-update from GitHub Releases.

Every few hours the hub reads the latest Release of the Soma Agente repository.
When its tag is newer than the installed version, it downloads the installer,
checks it against the SHA-256 published in the same Release, and runs it with
/update (only the programs that already have Soma) once no Adobe program with
the panel is open — the installer replaces panel files, so those must be closed.

Turn it off by creating auto-update-off.txt in the data folder.
"""
import hashlib
import json
import os
import subprocess
import threading
import time
import urllib.request

from soma_core import VERSION, system

REPOSITORY = "alanomoxo/soma-agente"
API = "https://api.github.com/repos/%s/releases/latest" % REPOSITORY
INSTALLER = "Soma-Agente-Instalador.exe"
CHECK_EVERY = 6 * 3600
RETRY_EVERY = 10 * 60
ADOBE_PROCESSES = ("AfterFX.exe", "Photoshop.exe", "Illustrator.exe", "Adobe Premiere Pro.exe")


def _version_tuple(text):
    parts = []
    for piece in str(text or "").lstrip("vV").split("."):
        digits = "".join(ch for ch in piece if ch.isdigit())
        parts.append(int(digits) if digits else 0)
    return tuple(parts + [0] * (3 - len(parts)))


def installed_version():
    override = os.environ.get("SOMA_INSTALLED_VERSION")
    if override:
        return override
    try:
        with open(os.path.join(system.data_directory(), "installed-version.txt"), "r", encoding="utf-8") as handle:
            return handle.read().strip() or VERSION
    except OSError:
        return VERSION


def _get(url, accept="application/vnd.github+json"):
    request = urllib.request.Request(url, headers={"User-Agent": "SomaAgente-Hub/" + VERSION, "Accept": accept})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def _adobe_running():
    if not system.WINDOWS:
        return []
    try:
        out = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], capture_output=True, text=True, timeout=30, creationflags=system.hidden_window_flags()).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    running = []
    for line in out.splitlines():
        name = line.split('","')[0].strip('"')
        if name in ADOBE_PROCESSES and name not in running:
            running.append(name)
    return running


class Updater:
    def __init__(self):
        self.state = {"current": installed_version(), "latest": None, "status": "idle", "detail": "", "notes": "", "checked": None}
        self.lock = threading.Lock()
        self.ready_path = None
        self.dry_run = os.environ.get("SOMA_UPDATE_DRY_RUN") == "1"

    def disabled(self):
        return os.path.exists(os.path.join(system.data_directory(), "auto-update-off.txt"))

    def _set(self, **values):
        with self.lock:
            self.state.update(values)

    def snapshot(self):
        with self.lock:
            return dict(self.state)

    def start(self):
        if system.WINDOWS:
            threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        time.sleep(float(os.environ.get("SOMA_UPDATE_FIRST_DELAY", "60")))
        while True:
            wait = CHECK_EVERY
            try:
                if not self.disabled():
                    wait = self.check_and_install()
            except Exception as error:  # noqa: BLE001 - try again next round
                self._set(status="error", detail="%s: %s" % (type(error).__name__, error))
            time.sleep(wait)

    def check_and_install(self):
        """One round. Returns how long to wait before the next round."""
        release = json.loads(_get(API).decode("utf-8"))
        latest = release.get("tag_name", "")
        self._set(latest=latest.lstrip("vV"), notes=(release.get("body") or "")[:2000], checked=time.time(), current=installed_version())
        if _version_tuple(latest) <= _version_tuple(installed_version()):
            self._set(status="up-to-date", detail="")
            return CHECK_EVERY
        if not self.ready_path or not os.path.exists(self.ready_path):
            self.ready_path = self._download(release)
        if self.dry_run:
            self._set(status="downloaded", detail=self.ready_path)
            return CHECK_EVERY
        running = _adobe_running()
        if running:
            self._set(status="waiting", detail="Close %s to install version %s." % (", ".join(n.replace(".exe", "") for n in running), latest.lstrip("vV")))
            return RETRY_EVERY
        self._set(status="installing", detail="Installing version %s…" % latest.lstrip("vV"))
        # Detached: the installer stops and restarts this hub while it runs.
        subprocess.Popen([self.ready_path, "/silent", "/update"], creationflags=0x00000008 | 0x00000200, close_fds=True)
        return CHECK_EVERY

    def _download(self, release):
        assets = {a.get("name"): a.get("browser_download_url") for a in release.get("assets", [])}
        if INSTALLER not in assets or INSTALLER + ".sha256" not in assets:
            raise RuntimeError("The release %s has no %s with its .sha256." % (release.get("tag_name"), INSTALLER))
        expected = _get(assets[INSTALLER + ".sha256"], "application/octet-stream").decode("utf-8").split()[0].strip().lower()
        self._set(status="downloading", detail="")
        data = _get(assets[INSTALLER], "application/octet-stream")
        actual = hashlib.sha256(data).hexdigest()
        if actual != expected:
            raise RuntimeError("Downloaded installer does not match the published SHA-256; not installing.")
        folder = os.path.join(system.data_directory(), "updates")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, "Soma-Agente-Instalador-%s.exe" % release.get("tag_name", "new").lstrip("vV"))
        with open(path, "wb") as handle:
            handle.write(data)
        return path
