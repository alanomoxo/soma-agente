"""Attachments for the Python hosts (Blender, Cinema 4D and the Soma Hub for Figma
and Cavalry): images, videos, audio, PDFs and documents.

Mirrors the Adobe panel (adobe/js/media.js and documents.js) and shares its tools
in the Soma data folder: FFmpeg (bin/), whisper.cpp (bin/whisper) and the
transcription models (models/). FFmpeg is downloaded once when the first video
arrives; without whisper.cpp the soundtrack is described as not transcribed.

prepare() turns file paths into parts every provider can render:
  {"type": "text", "text": ...}
  {"type": "image", "path": ..., "media_type": ...}
  {"type": "pdf", "path": ..., "text": <extracted text, for providers that cannot read PDFs>}
"""
import glob
import gzip
import os
import platform
import re
import shutil
import subprocess
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
import zlib

from . import system

IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".wmv", ".mts", ".mpg", ".mpeg"}
AUDIO_EXT = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus", ".wma"}
TEXT_EXT = {".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".srt", ".vtt", ".js", ".jsx",
            ".ts", ".py", ".css", ".yaml", ".yml", ".ini", ".log", ".rtf"}
OFFICE_EXT = {".docx", ".pptx", ".xlsx", ".odt", ".odp", ".ods"}
SUPPORTED = set(IMAGE_TYPES) | VIDEO_EXT | AUDIO_EXT | TEXT_EXT | OFFICE_EXT | {".pdf"}
MAX_TEXT = 60000
MAX_IMAGE_BYTES = 4800000
MAX_PDF_BYTES = 20000000
FRAMES = 8
FFMPEG_RELEASE = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/"
MODELS = ("ggml-small.bin", "ggml-large-v3-turbo-q5_0.bin", "ggml-base.bin")


def kind(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in IMAGE_TYPES:
        return "image"
    if ext in VIDEO_EXT:
        return "video"
    if ext in AUDIO_EXT:
        return "audio"
    if ext == ".pdf":
        return "pdf"
    if ext in TEXT_EXT or ext in OFFICE_EXT:
        return "document"
    return None


def file_filter():
    """Patterns for the hosts' file pickers, e.g. "*.png;*.pdf;..."."""
    return ";".join("*" + ext for ext in sorted(SUPPORTED))


# ------------------------------------------------------------------ tools on this computer
def _exe(name):
    return name + ".exe" if system.WINDOWS else name


def _bin_dir():
    return os.path.join(system.data_directory(), "bin")


def _usable(path):
    return bool(path) and os.path.isfile(path) and (system.WINDOWS or os.access(path, os.X_OK))


def find_ffmpeg():
    candidates = [os.environ.get("FFMPEG_BIN"), os.path.join(_bin_dir(), _exe("ffmpeg"))]
    candidates += [os.path.join(d, _exe("ffmpeg")) for d in system._path_dirs()]
    return next((c for c in candidates if _usable(c)), None)


def find_whisper():
    found = glob.glob(os.path.join(_bin_dir(), "whisper", "**", _exe("whisper-cli")), recursive=True)
    candidates = [os.environ.get("WHISPER_BIN")] + found + [os.path.join(d, _exe("whisper-cli")) for d in system._path_dirs()]
    return next((c for c in candidates if _usable(c)), None)


def find_model():
    for name in MODELS:
        path = os.path.join(system.data_directory(), "models", name)
        if os.path.isfile(path) and os.path.getsize(path) > 1000000:
            return path
    return None


def install_ffmpeg():
    """Downloads the same static FFmpeg build the Adobe panel uses into the shared bin folder."""
    platform = "win32" if system.WINDOWS else ("darwin" if sys.platform == "darwin" else "linux")
    arch = "arm64" if platform.machine().lower() in ("arm64", "aarch64") else "x64"
    os.makedirs(_bin_dir(), exist_ok=True)
    target = os.path.join(_bin_dir(), _exe("ffmpeg"))
    request = urllib.request.Request(FFMPEG_RELEASE + "ffmpeg-%s-%s.gz" % (platform, arch), headers={"User-Agent": "SomaAgente"})
    from .extensions import _ssl_context  # extensions imports system only
    with urllib.request.urlopen(request, timeout=600, context=_ssl_context()) as response, open(target + ".gz", "wb") as handle:
        shutil.copyfileobj(response, handle)
    with gzip.open(target + ".gz", "rb") as source, open(target + ".tmp", "wb") as handle:
        shutil.copyfileobj(source, handle)
    os.replace(target + ".tmp", target)
    os.remove(target + ".gz")
    if not system.WINDOWS:
        os.chmod(target, 0o755)
        if sys.platform == "darwin" and _run([target, "-version"], 15).returncode != 0:
            # Downloaded binaries can be quarantined or, on Apple chips, need a signature.
            _run(["xattr", "-d", "com.apple.quarantine", target], 15)
            _run(["codesign", "--force", "--sign", "-", target], 30)
    return target


def _run(args, timeout, env=None):
    try:
        return subprocess.run(args, capture_output=True, timeout=timeout, creationflags=system.hidden_window_flags(), stdin=subprocess.DEVNULL, env=env)
    except (OSError, subprocess.SubprocessError) as error:
        return subprocess.CompletedProcess(args, 1, b"", str(error).encode("utf-8"))


# ------------------------------------------------------------------ clipboard
# Files copied in Explorer/Finder, else a copied image (a screenshot) saved as PNG.
CLIPBOARD_WINDOWS = """
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$files = [System.Windows.Forms.Clipboard]::GetFileDropList()
if ($files -and $files.Count) { $files | ForEach-Object { $_ }; exit }
$image = [System.Windows.Forms.Clipboard]::GetImage()
if ($image) { $image.Save($env:SOMA_PASTE_OUT, [System.Drawing.Imaging.ImageFormat]::Png); $env:SOMA_PASTE_OUT }
"""
CLIPBOARD_MAC = [
    "try", "set copied to (the clipboard as «class furl»)", "return POSIX path of copied", "end try",
    "try", "set png to (the clipboard as «class PNGf»)",
    "set target to open for access (POSIX file (system attribute \"SOMA_PASTE_OUT\")) with write permission",
    "write png to target", "close access target", "return system attribute \"SOMA_PASTE_OUT\"", "end try",
    "return \"\"",
]


def clipboard_files():
    """What Ctrl/Cmd+V would attach: paths of supported files on the system clipboard
    (a copied image is saved as a PNG in the Soma data folder, kept for a day)."""
    folder = os.path.join(system.data_directory(), "pasted")
    os.makedirs(folder, exist_ok=True)
    for name in os.listdir(folder):
        old = os.path.join(folder, name)
        if time.time() - os.path.getmtime(old) > 86400:
            try:
                os.remove(old)
            except OSError:
                pass
    env = dict(os.environ, SOMA_PASTE_OUT=os.path.join(folder, "colado-%s.png" % time.strftime("%Y%m%d-%H%M%S")))
    if system.WINDOWS:
        out = _run(["powershell", "-NoProfile", "-NonInteractive", "-STA", "-Command", CLIPBOARD_WINDOWS], 20, env)
    else:
        args = ["osascript"]
        for line in CLIPBOARD_MAC:
            args += ["-e", line]
        out = _run(args, 20, env)
    paths = [line.strip() for line in out.stdout.decode("utf-8", "replace").splitlines()]
    return [p for p in paths if p and os.path.isfile(p) and kind(p)]


# ------------------------------------------------------------------ video and audio
def probe(ffmpeg, path):
    text = _run([ffmpeg, "-hide_banner", "-i", path], 60).stderr.decode("utf-8", "replace")
    info = {"duration": 0.0, "width": 0, "height": 0, "fps": 0.0, "video": "Video:" in text, "audio": "Audio:" in text}
    found = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
    if found:
        info["duration"] = int(found.group(1)) * 3600 + int(found.group(2)) * 60 + float(found.group(3))
    found = re.search(r"Stream #.*Video:.*?(\d{2,5})x(\d{2,5})", text)
    if found:
        info["width"], info["height"] = int(found.group(1)), int(found.group(2))
    found = re.search(r"(\d+(?:\.\d+)?)\s*fps", text)
    if found:
        info["fps"] = float(found.group(1))
    return info


def clock(seconds):
    seconds = max(0.0, seconds)
    return "%d:%05.2f" % (int(seconds // 60), seconds % 60)


def transcribe(ffmpeg, path, work):
    """Speech in the file as text, or None when whisper.cpp or a model is missing."""
    whisper, model = find_whisper(), find_model()
    if not (whisper and model):
        return None
    wav = os.path.join(work, "audio.wav")
    _run([ffmpeg, "-hide_banner", "-loglevel", "error", "-i", path, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-y", wav], 600)
    if not os.path.isfile(wav):
        return None
    threads = str(max(1, min(8, os.cpu_count() or 4)))
    out = _run([whisper, "-m", model, "-f", wav, "-l", "auto", "-t", threads, "-np"], 900).stdout.decode("utf-8", "replace")
    os.remove(wav)
    lines = re.findall(r"^\s*\[([\d:.,]+)\s*-->\s*[\d:.,]+\]\s*(.*)$", out, re.M)
    speech = [text.strip() for _start, text in lines if text.strip() and not re.match(r"^\s*[\[(][^\])]*[\])]\s*$", text)]
    return " ".join(speech) if lines else out.strip()


def _media_parts(path, heading, video, status):
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        if status:
            status("ffmpeg")
        try:
            ffmpeg = install_ffmpeg()
        except Exception as error:  # noqa: BLE001 - reported to the model instead
            return [{"type": "text", "text": "%s. It could not be opened: FFmpeg is missing and could not be downloaded (%s)." % (heading, error)}]
    info = probe(ffmpeg, path)
    work = os.path.join(system.data_directory(), "attachments", "%d-%d" % (int(time.time() * 1000), os.getpid()))
    os.makedirs(work, exist_ok=True)
    parts = []
    details = ", ".join(x for x in ("%.2f s" % info["duration"] if info["duration"] else "",
                                     "%dx%d px" % (info["width"], info["height"]) if info["width"] else "",
                                     "%g fps" % info["fps"] if info["fps"] and video else "") if x)
    transcript = transcribe(ffmpeg, path, work) if info["audio"] else None
    sound = ("\nTranscript of the audio:\n" + transcript) if transcript else (
        "\nThe audio was not transcribed (voice transcription is not set up on this computer)." if info["audio"] else "\nIt has no audio.")
    if not video:
        shutil.rmtree(work, ignore_errors=True)
        return [{"type": "text", "text": "%s%s.%s" % (heading, " (%s)" % details if details else "", sound)}]
    times = [info["duration"] * (i + 0.5) / FRAMES for i in range(FRAMES)] if info["duration"] > 0.5 else [0.0]
    frames = []
    for number, moment in enumerate(times, 1):
        frame = os.path.join(work, "frame-%02d.jpg" % number)
        _run([ffmpeg, "-hide_banner", "-loglevel", "error", "-ss", "%.3f" % moment, "-i", path, "-frames:v", "1",
              "-vf", "scale=w='min(768,iw)':h='min(768,ih)':force_original_aspect_ratio=decrease", "-q:v", "3", "-y", frame], 120)
        if os.path.isfile(frame):
            frames.append((moment, frame))
    parts.append({"type": "text", "text": "%s%s. %d frames sampled evenly across the clip follow, each labeled with its time.%s" % (
        heading, " (%s)" % details if details else "", len(frames), sound)})
    for number, (moment, frame) in enumerate(frames, 1):
        parts.append({"type": "text", "text": "Frame %d/%d at %s" % (number, len(frames), clock(moment))})
        parts.append({"type": "image", "path": frame, "media_type": "image/jpeg"})
    return parts


def _image_parts(path, heading):
    if os.path.getsize(path) <= MAX_IMAGE_BYTES:
        return [{"type": "text", "text": heading + "."}, {"type": "image", "path": path, "media_type": IMAGE_TYPES[os.path.splitext(path)[1].lower()]}]
    ffmpeg = find_ffmpeg()
    if ffmpeg:
        small = os.path.join(system.data_directory(), "attachments", "%d-%s.jpg" % (int(time.time() * 1000), os.getpid()))
        os.makedirs(os.path.dirname(small), exist_ok=True)
        _run([ffmpeg, "-hide_banner", "-loglevel", "error", "-i", path, "-vf",
              "scale=w='min(2000,iw)':h='min(2000,ih)':force_original_aspect_ratio=decrease", "-q:v", "3", "-y", small], 120)
        if os.path.isfile(small) and os.path.getsize(small) <= MAX_IMAGE_BYTES:
            return [{"type": "text", "text": heading + " (reduced to fit)."}, {"type": "image", "path": small, "media_type": "image/jpeg"}]
    return [{"type": "text", "text": heading + ". It is too large to send as an image (over 4.8 MB)."}]


# ------------------------------------------------------------------ documents
def _xml_text(data, paragraph_tags):
    """Text of an Office/OpenDocument XML part, one line per paragraph."""
    root = ET.fromstring(data)
    lines = []
    for element in root.iter():
        name = element.tag.split("}")[-1]
        if name in paragraph_tags:
            text = "".join(t for t in element.itertext()).strip()
            if text:
                lines.append(text)
    return "\n".join(lines)


def _number(name):
    found = re.findall(r"\d+", name)
    return int(found[-1]) if found else 0


def _xlsx_text(archive):
    shared = []
    if "xl/sharedStrings.xml" in archive.namelist():
        root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
        shared = ["".join(si.itertext()) for si in root if si.tag.endswith("}si")]
    out = []
    for name in sorted((n for n in archive.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n)), key=_number):
        out.append("## Sheet %d" % _number(name))
        root = ET.fromstring(archive.read(name))
        for row in root.iter():
            if not row.tag.endswith("}row"):
                continue
            cells = []
            for cell in row:
                if not cell.tag.endswith("}c"):
                    continue
                value = next((v.text or "" for v in cell if v.tag.endswith("}v")), "")
                if cell.get("t") == "s" and value.isdigit() and int(value) < len(shared):
                    value = shared[int(value)]
                elif cell.get("t") == "inlineStr":
                    value = "".join(cell.itertext())
                cells.append(value)
            if any(cells):
                out.append("\t".join(cells))
    return "\n".join(out)


def document_text(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in (".docx", ".pptx", ".xlsx", ".odt", ".odp", ".ods"):
        with zipfile.ZipFile(path) as archive:
            if ext == ".docx":
                return _xml_text(archive.read("word/document.xml"), {"p"})
            if ext == ".pptx":
                slides = sorted((n for n in archive.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)), key=_number)
                return "\n\n".join("## Slide %d\n%s" % (_number(n), _xml_text(archive.read(n), {"p"})) for n in slides)
            if ext == ".xlsx":
                return _xlsx_text(archive)
            return _xml_text(archive.read("content.xml"), {"p", "h", "table-row"})
    with open(path, "rb") as handle:
        raw = handle.read()
    text = raw.decode("utf-8") if _utf8(raw) else raw.decode("cp1252", "replace")
    if ext == ".rtf":
        # Font, color and style tables are not text.
        text = re.sub(r"\{\\(?:fonttbl|colortbl|stylesheet|info|\*)(?:[^{}]|\{[^{}]*\})*\}", "", text)
        text = re.sub(r"\\par[d]?\b ?", "\n", text)
        text = re.sub(r"\\'([0-9a-f]{2})", lambda m: bytes([int(m.group(1), 16)]).decode("cp1252"), text)
        text = re.sub(r"\\[a-z]+-?\d* ?|[{}]", "", text)
    elif ext in (".html", ".htm"):
        text = re.sub(r"(?is)<(script|style).*?</\1>", "", text)
        text = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</h\d>|</li>", "\n", text)
        text = re.sub(r"<[^>]+>", "", text)
    return text


def _utf8(raw):
    try:
        raw.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


# ------------------------------------------------------------------ PDF text
def _pdf_string(token, cmap):
    """Bytes of a literal (…) or hex <…> string, decoded with the fonts' ToUnicode map when it has one."""
    if token.startswith(b"<"):
        digits = re.sub(rb"[^0-9a-fA-F]", b"", token[1:-1])
        raw = bytes.fromhex((digits + b"0" * (len(digits) % 2)).decode("ascii"))
    else:
        body, raw, i = token[1:-1], bytearray(), 0
        escapes = {ord("n"): 10, ord("r"): 13, ord("t"): 9, ord("b"): 8, ord("f"): 12}
        while i < len(body):
            c = body[i]
            if c == 0x5C and i + 1 < len(body):
                n = body[i + 1]
                if n in escapes:
                    raw.append(escapes[n])
                    i += 2
                elif 0x30 <= n <= 0x37:
                    octal = re.match(rb"[0-7]{1,3}", body[i + 1:i + 4]).group(0)
                    raw.append(int(octal, 8) & 0xFF)
                    i += 1 + len(octal)
                elif n in (0x0A, 0x0D):
                    i += 2
                else:
                    raw.append(n)
                    i += 2
            else:
                raw.append(c)
                i += 1
        raw = bytes(raw)
    if cmap:
        width = 2 if max(cmap) > 0xFF else 1
        if len(raw) % width == 0:
            codes = [int.from_bytes(raw[i:i + width], "big") for i in range(0, len(raw), width)]
            if sum(1 for c in codes if c in cmap) >= len(codes) / 2:
                return "".join(cmap.get(c, "") for c in codes)
    if raw.startswith(b"\xfe\xff"):
        return raw[2:].decode("utf-16-be", "replace")
    return raw.decode("latin-1")


def _cmap(data):
    mapping = {}
    for block in re.findall(rb"beginbfchar(.*?)endbfchar", data, re.S):
        for src, dst in re.findall(rb"<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>", block):
            mapping[int(src, 16)] = bytes.fromhex(dst.decode()).decode("utf-16-be", "replace") if dst else ""
    for block in re.findall(rb"beginbfrange(.*?)endbfrange", data, re.S):
        for low, high, dst in re.findall(rb"<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])", block):
            low, high = int(low, 16), int(high, 16)
            if dst.startswith(b"["):
                for offset, item in enumerate(re.findall(rb"<([0-9a-fA-F]*)>", dst)):
                    mapping[low + offset] = bytes.fromhex(item.decode()).decode("utf-16-be", "replace")
            elif high - low < 65536:
                start = int(dst[1:-1] or b"0", 16)
                for offset in range(high - low + 1):
                    mapping[low + offset] = chr(start + offset) if start + offset < 0x110000 else ""
    return mapping


TOKEN = re.compile(rb"\((?:\\.|[^\\)])*\)|<[0-9a-fA-F\s]*>|\[|\]|-?\d*\.?\d+|/[^\s/<>\[\]()]+|[A-Za-z'\"*]+", re.S)


def pdf_text(path, limit=MAX_TEXT):
    """Best-effort text of a PDF (no third-party libraries): reads the page content
    streams and the fonts' ToUnicode maps. Scanned PDFs have no text to find."""
    with open(path, "rb") as handle:
        data = handle.read()
    streams = []
    for match in re.finditer(rb"stream\r?\n", data):
        end = data.find(b"endstream", match.end())
        if end < 0:
            continue
        chunk = data[match.end():end]
        # The stream's dictionary: everything since its "N 0 obj".
        head = data[max(0, data.rfind(b"obj", max(0, match.start() - 4000), match.start())):match.start()]
        if re.search(rb"/Subtype\s*/Image|/FontFile|/Length1|/Subtype\s*/(Type1C|CIDFontType0C|OpenType)", head):
            continue  # images and embedded fonts
        if b"FlateDecode" in head:
            try:
                chunk = zlib.decompressobj().decompress(chunk)
            except zlib.error:
                continue
        elif b"/Filter" in head:
            continue  # other encodings (JPEG, LZW…)
        # Page content and ToUnicode maps are text; anything else is binary.
        sample = chunk[:4000]
        if sample and sum(1 for b in sample if b in (9, 10, 13) or 32 <= b < 127) < 0.9 * len(sample):
            continue
        streams.append(chunk)
    cmap = {}
    for chunk in streams:
        if b"begincmap" in chunk:
            cmap.update(_cmap(chunk))
    out, total = [], 0
    for chunk in streams:
        if b"BT" not in chunk or (b"Tj" not in chunk and b"TJ" not in chunk):
            continue
        # Follow where text lands (Tm/Td/T*) and break lines or add spaces only where the
        # page has a gap: some PDFs place every glyph separately. Glyph widths are not read,
        # so a text run is assumed to be about half the font size per character wide.
        line, stack = [], []
        pos = {"x": 0.0, "y": 0.0, "lx": 0.0, "ly": 0.0, "size": 10.0, "scale": 1.0, "lead": 0.0, "end": None, "last_y": None}

        def emit(text):
            size = pos["size"] * pos["scale"] or 10.0
            if pos["last_y"] is not None:
                if abs(pos["y"] - pos["last_y"]) > 0.5 * size:
                    line.append("\n")
                elif pos["x"] - pos["end"] > 0.2 * size and line and not line[-1].endswith((" ", "\n")):
                    line.append(" ")
            line.append(text)
            pos["end"] = pos["x"] + 0.5 * size * len(text)
            pos["x"], pos["last_y"] = pos["end"], pos["y"]

        for token in TOKEN.findall(chunk):
            numbers = [s for s in stack if isinstance(s, float)]
            if token in (b"Tj", b"'", b'"'):
                if token != b"Tj":
                    pos["ly"] -= pos["lead"] or pos["size"] * 1.2
                    pos["x"], pos["y"] = pos["lx"], pos["ly"]
                if stack and isinstance(stack[-1], str):
                    emit(stack[-1])
                stack = []
            elif token == b"TJ":
                text = "".join(s for s in stack if isinstance(s, str))
                if text:
                    emit(text)
                stack = []
            elif token == b"[":
                stack = []
            elif token == b"]":
                stack = [s for s in stack if isinstance(s, str)]
            elif token.startswith((b"(", b"<")):
                stack.append(_pdf_string(token, cmap))
            elif re.match(rb"-?\d*\.?\d+$", token):
                if stack and isinstance(stack[-1], str) and float(token) < -180:
                    stack.append(" ")  # a wide kerning gap inside a TJ array is a space
                else:
                    stack.append(float(token))
            elif token == b"Tf" and numbers:
                pos["size"] = abs(numbers[-1]) or 10.0
                stack = []
            elif token == b"TL" and numbers:
                pos["lead"] = numbers[-1]
                stack = []
            elif token == b"Tm" and len(numbers) >= 6:
                pos["scale"] = max(abs(numbers[-6]), abs(numbers[-5])) or 1.0
                pos["x"] = pos["lx"] = numbers[-2]
                pos["y"] = pos["ly"] = numbers[-1]
                stack = []
            elif token in (b"Td", b"TD") and len(numbers) >= 2:
                if token == b"TD":
                    pos["lead"] = -numbers[-1]
                pos["lx"] += numbers[-2] * pos["scale"]
                pos["ly"] += numbers[-1] * pos["scale"]
                pos["x"], pos["y"] = pos["lx"], pos["ly"]
                stack = []
            elif token == b"T*":
                pos["ly"] -= (pos["lead"] or pos["size"] * 1.2) * pos["scale"]
                pos["x"], pos["y"] = pos["lx"], pos["ly"]
                stack = []
            elif token.isalpha() or token == b"BT":
                stack = []
        text = re.sub(r"[ \t]+\n", "\n", re.sub(r"\n{3,}", "\n\n", "".join(s for s in line if isinstance(s, str))))
        out.append(text)
        total += len(text)
        if total > limit:
            break
    return re.sub(r"[^\S\n]+", " ", "\n".join(out)).strip()[:limit]


# ------------------------------------------------------------------ all together
def prepare(paths, status=None):
    """Parts for every attachment, in order. status(step) is called before slow steps ("ffmpeg")."""
    parts = []
    for number, path in enumerate(paths, 1):
        name = os.path.basename(path)
        what = kind(path)
        heading = "Attachment %d: %s \u201c%s\u201d (file: %s)" % (number, {"image": "image", "video": "video", "audio": "audio file",
                                                                           "pdf": "PDF document", "document": "document"}.get(what, "file"), name, path)
        try:
            if what == "image":
                parts += _image_parts(path, heading)
            elif what in ("video", "audio"):
                parts += _media_parts(path, heading, what == "video", status)
            elif what == "pdf":
                text = pdf_text(path)
                parts.append({"type": "text", "text": heading + "."})
                parts.append({"type": "pdf", "path": path, "size": os.path.getsize(path),
                              "text": text or "(No text could be extracted: the PDF is probably scanned images.)"})
            elif what == "document":
                text = document_text(path).strip()
                cut = len(text) > MAX_TEXT
                parts.append({"type": "text", "text": "%s%s:\n%s" % (heading, " (first %d characters)" % MAX_TEXT if cut else "", text[:MAX_TEXT] or "(empty)")})
            else:
                parts.append({"type": "text", "text": heading + ". This file type cannot be read; only its name and path are known."})
        except Exception as error:  # noqa: BLE001 - one bad file should not stop the message
            parts.append({"type": "text", "text": "%s. It could not be read: %s" % (heading, error)})
    return parts
