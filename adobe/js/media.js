(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.AEMedia = api;
}(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  // Local helpers for voice transcription and video analysis. Claude cannot
  // hear audio or watch video, so the panel turns speech into text (whisper.cpp
  // on this computer, or an OpenAI-compatible transcription API) and videos into
  // timestamped frames plus a transcript of their soundtrack (FFmpeg).

  var FFMPEG_RELEASE = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/";
  var WHISPER_WINDOWS_ZIP = "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip";
  var MODEL_BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";
  var MODELS = {
    base: { file: "ggml-base.bin", label: "Base (148 MB, fastest)", megabytes: 148 },
    small: { file: "ggml-small.bin", label: "Small (488 MB, recommended)", megabytes: 488 },
    turbo: { file: "ggml-large-v3-turbo-q5_0.bin", label: "Large v3 Turbo (574 MB, most accurate)", megabytes: 574 }
  };
  var API_PROVIDERS = {
    openai: { host: "api.openai.com", path: "/v1/audio/transcriptions", model: "whisper-1", label: "OpenAI" },
    groq: { host: "api.groq.com", path: "/openai/v1/audio/transcriptions", model: "whisper-large-v3-turbo", label: "Groq" }
  };
  var API_LIMIT_BYTES = 25 * 1024 * 1024;

  function Media(n, dataDirectory) {
    this.n = n;
    this.win = n.process.platform === "win32";
    this.dataDirectory = dataDirectory;
    this.binDirectory = n.path.join(dataDirectory, "bin");
    this.modelDirectory = n.path.join(dataDirectory, "models");
  }

  Media.prototype.exe = function (name) { return this.win ? name + ".exe" : name; };

  Media.prototype.isFile = function (file) {
    var n = this.n;
    try {
      if (!n.fs.statSync(file).isFile()) { return false; }
      if (!this.win) { n.fs.accessSync(file, n.fs.constants.X_OK); }
      return true;
    } catch (error) {
      return false;
    }
  };

  Media.prototype.pathCandidates = function (exe) {
    var n = this.n, env = n.process.env || {}, list = [];
    String(env.Path || env.PATH || "").split(this.win ? ";" : ":").forEach(function (dir) { if (dir) { list.push(n.path.join(dir, exe)); } });
    // Apps opened from the macOS Finder do not inherit the Terminal PATH.
    if (!this.win) { list.push("/opt/homebrew/bin/" + exe, "/usr/local/bin/" + exe); }
    return list;
  };

  Media.prototype.firstExisting = function (candidates) {
    for (var i = 0; i < candidates.length; i += 1) {
      if (candidates[i] && this.isFile(candidates[i])) { return candidates[i]; }
    }
    return null;
  };

  Media.prototype.findFile = function (dir, name, depth) {
    var n = this.n, entries;
    try { entries = n.fs.readdirSync(dir); } catch (error) { return null; }
    for (var i = 0; i < entries.length; i += 1) {
      var full = n.path.join(dir, entries[i]);
      if (entries[i].toLowerCase() === name.toLowerCase() && this.isFile(full)) { return full; }
    }
    if (depth <= 0) { return null; }
    for (var j = 0; j < entries.length; j += 1) {
      var sub = n.path.join(dir, entries[j]);
      try { if (n.fs.statSync(sub).isDirectory()) { var found = this.findFile(sub, name, depth - 1); if (found) { return found; } } } catch (error) { /* unreadable */ }
    }
    return null;
  };

  Media.prototype.findFfmpeg = function () {
    var env = this.n.process.env || {}, exe = this.exe("ffmpeg");
    return this.firstExisting([env.FFMPEG_BIN, this.n.path.join(this.binDirectory, exe)].concat(this.pathCandidates(exe)));
  };

  Media.prototype.findWhisper = function () {
    var env = this.n.process.env || {}, exe = this.exe("whisper-cli");
    return this.firstExisting([env.WHISPER_BIN, this.findFile(this.n.path.join(this.binDirectory, "whisper"), exe, 3)].concat(this.pathCandidates(exe)));
  };

  Media.prototype.modelPath = function (name) {
    var model = MODELS[name];
    if (!model) { return null; }
    var file = this.n.path.join(this.modelDirectory, model.file);
    try { return this.n.fs.statSync(file).size > 1000000 ? file : null; } catch (error) { return null; }
  };

  // Downloads follow redirects (GitHub and Hugging Face both redirect to a CDN)
  // and land in a .part file that is renamed only once complete.
  Media.prototype.download = function (url, destination, onProgress) {
    var n = this.n;
    n.fs.mkdirSync(n.path.dirname(destination), { recursive: true });
    var partial = destination + ".part";
    return new Promise(function (resolve, reject) {
      function get(current, hops) {
        var request = n.https.get(current, { headers: { "User-Agent": "AE-Agent" } }, function (response) {
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            response.resume();
            if (hops > 8) { reject(new Error("Too many redirects while downloading " + url)); return; }
            get(new URL(response.headers.location, current).toString(), hops + 1);
            return;
          }
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error("Download failed (HTTP " + response.statusCode + "): " + url));
            return;
          }
          var total = parseInt(response.headers["content-length"], 10) || 0, received = 0;
          var out = n.fs.createWriteStream(partial);
          response.on("data", function (chunk) {
            received += chunk.length;
            if (onProgress) { onProgress(received, total); }
          });
          response.on("error", function (error) { out.destroy(); reject(error); });
          out.on("error", reject);
          out.on("finish", function () {
            if (total && received !== total) { reject(new Error("The download was interrupted. Try again.")); return; }
            try { n.fs.renameSync(partial, destination); resolve(destination); } catch (error) { reject(error); }
          });
          response.pipe(out);
        });
        request.on("error", reject);
        request.setTimeout(60000, function () { request.destroy(new Error("The download timed out. Check the internet connection and try again.")); });
      }
      get(url, 0);
    });
  };

  Media.prototype.installFfmpeg = function (onProgress) {
    var n = this.n, self = this;
    var platform = this.win ? "win32" : (n.process.platform === "darwin" ? "darwin" : n.process.platform);
    var arch = n.process.arch === "arm64" ? "arm64" : "x64";
    var archive = n.path.join(this.binDirectory, "ffmpeg-download.gz");
    var target = n.path.join(this.binDirectory, this.exe("ffmpeg"));
    return this.download(FFMPEG_RELEASE + "ffmpeg-" + platform + "-" + arch + ".gz", archive, onProgress).then(function () {
      return new Promise(function (resolve, reject) {
        var temp = target + ".tmp";
        var out = n.fs.createWriteStream(temp, { mode: 493 });
        var input = n.fs.createReadStream(archive);
        var gunzip = n.zlib.createGunzip();
        [input, gunzip, out].forEach(function (stream) { stream.on("error", reject); });
        out.on("finish", function () {
          try {
            n.fs.renameSync(temp, target);
            if (!self.win) { n.fs.chmodSync(target, 493); }
            n.fs.unlinkSync(archive);
            resolve(target);
          } catch (error) { reject(error); }
        });
        input.pipe(gunzip).pipe(out);
      });
    });
  };

  Media.prototype.installWhisper = function (onProgress) {
    var n = this.n, self = this;
    if (!this.win) {
      return Promise.reject(new Error("On macOS, install whisper.cpp with Homebrew: open Terminal and run  brew install whisper-cpp  then click Check again."));
    }
    var archive = n.path.join(this.binDirectory, "whisper-download.zip");
    var folder = n.path.join(this.binDirectory, "whisper");
    return this.download(WHISPER_WINDOWS_ZIP, archive, onProgress).then(function () {
      var quote = function (value) { return "'" + String(value).replace(/'/g, "''") + "'"; };
      return self.run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
        "Expand-Archive -LiteralPath " + quote(archive) + " -DestinationPath " + quote(folder) + " -Force"], { timeout: 180000 });
    }).then(function () {
      try { n.fs.unlinkSync(archive); } catch (error) { /* already removed */ }
      var binary = self.findWhisper();
      if (!binary) { throw new Error("whisper.cpp was downloaded, but whisper-cli.exe was not found inside it."); }
      return binary;
    });
  };

  Media.prototype.installModel = function (name, onProgress) {
    var model = MODELS[name];
    if (!model) { return Promise.reject(new Error("Unknown transcription model: " + name)); }
    return this.download(MODEL_BASE_URL + model.file, this.n.path.join(this.modelDirectory, model.file), onProgress);
  };

  Media.prototype.run = function (binary, args, options) {
    var n = this.n;
    options = options || {};
    return new Promise(function (resolve, reject) {
      n.childProcess.execFile(binary, args, {
        timeout: options.timeout || 600000,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        encoding: "utf8",
        cwd: options.cwd
      }, function (error, stdout, stderr) {
        if (error && !options.allowFailure) {
          var detail = String(stderr || "").trim().split(/\r?\n/).slice(-4).join(" ");
          reject(new Error(detail || error.message));
          return;
        }
        resolve({ stdout: String(stdout || ""), stderr: String(stderr || ""), code: error ? error.code : 0 });
      });
    });
  };

  // ffmpeg -i without an output prints the container details and exits with 1.
  Media.prototype.probe = function (file) {
    var ffmpeg = this.findFfmpeg();
    if (!ffmpeg) { return Promise.reject(new Error("FFmpeg is not installed.")); }
    return this.run(ffmpeg, ["-hide_banner", "-i", file], { allowFailure: true, timeout: 60000 }).then(function (result) {
      var text = result.stderr;
      var info = { duration: 0, width: 0, height: 0, fps: 0, hasVideo: /Stream #.*Video:/.test(text), hasAudio: /Stream #.*Audio:/.test(text) };
      var duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
      if (duration) { info.duration = parseInt(duration[1], 10) * 3600 + parseInt(duration[2], 10) * 60 + parseFloat(duration[3]); }
      var video = /Stream #.*Video:.*?(\d{2,5})x(\d{2,5})/.exec(text);
      if (video) { info.width = parseInt(video[1], 10); info.height = parseInt(video[2], 10); }
      var fps = /(\d+(?:\.\d+)?)\s*fps/.exec(text);
      if (fps) { info.fps = parseFloat(fps[1]); }
      if (!info.hasVideo && !info.hasAudio) { throw new Error("FFmpeg could not read this file: " + text.trim().split(/\r?\n/).pop()); }
      return info;
    });
  };

  Media.prototype.extractFrame = function (file, time, output, maxEdge) {
    var ffmpeg = this.findFfmpeg();
    var scale = "scale=w='min(" + maxEdge + ",iw)':h='min(" + maxEdge + ",ih)':force_original_aspect_ratio=decrease";
    return this.run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-ss", String(Math.max(0, time)), "-i", file, "-frames:v", "1", "-vf", scale, "-q:v", "3", "-y", output], { timeout: 120000 });
  };

  Media.prototype.extractAudio = function (file, output) {
    var ffmpeg = this.findFfmpeg();
    if (!ffmpeg) { return Promise.reject(new Error("FFmpeg is not installed.")); }
    return this.run(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-y", output], { timeout: 600000 }).then(function () { return output; });
  };

  function parseTimestamp(value) {
    var parts = /(\d+):(\d+):(\d+(?:[.,]\d+)?)/.exec(value);
    return parts ? parseInt(parts[1], 10) * 3600 + parseInt(parts[2], 10) * 60 + parseFloat(parts[3].replace(",", ".")) : 0;
  }

  // whisper.cpp marks silence and noise as [BLANK_AUDIO], (music) and so on.
  var NON_SPEECH = /^\s*[\[(][^\])]*[\])]\s*$/;

  function parseWhisperOutput(stdout) {
    var segments = [], timed = false;
    stdout.split(/\r?\n/).forEach(function (line) {
      var match = /^\s*\[([\d:.,]+)\s*-->\s*([\d:.,]+)\]\s*(.*)$/.exec(line);
      if (match) { timed = true; }
      if (match && match[3].trim() && !NON_SPEECH.test(match[3])) { segments.push({ start: parseTimestamp(match[1]), end: parseTimestamp(match[2]), text: match[3].trim() }); }
    });
    var text = timed ? segments.map(function (segment) { return segment.text; }).join(" ") : (NON_SPEECH.test(stdout) ? "" : stdout.trim());
    return { text: text.replace(/\s+/g, " ").trim(), segments: segments };
  }

  Media.prototype.transcribeLocal = function (wavFile, options) {
    var whisper = this.findWhisper();
    if (!whisper) { return Promise.reject(new Error("whisper.cpp is not installed. Open Settings → Voice & video and click Install.")); }
    var model = this.modelPath(options.model || "small");
    if (!model) { return Promise.reject(new Error("The " + (MODELS[options.model] || MODELS.small).label + " transcription model is not downloaded. Open Settings → Voice & video and click Download.")); }
    var threads = Math.max(1, Math.min(8, (this.n.os.cpus() || []).length || 4));
    var args = ["-m", model, "-f", wavFile, "-l", options.language || "auto", "-t", String(threads), "-np"];
    if (options.prompt) { args.push("--prompt", options.prompt); }
    return this.run(whisper, args, { timeout: 900000, cwd: this.n.path.dirname(whisper) }).then(function (result) { return parseWhisperOutput(result.stdout); });
  };

  Media.prototype.transcribeApi = function (file, options) {
    var n = this.n, provider = API_PROVIDERS[options.engine];
    if (!provider) { return Promise.reject(new Error("Unknown transcription service.")); }
    if (!options.apiKey) { return Promise.reject(new Error("Add your " + provider.label + " API key in Settings → Voice & video.")); }
    var data = n.fs.readFileSync(file);
    if (data.length > API_LIMIT_BYTES) { return Promise.reject(new Error("The audio is larger than the 25 MB limit of " + provider.label + ". Use local transcription for long recordings.")); }
    var boundary = "----AEAgent" + n.crypto.randomBytes(12).toString("hex");
    var parts = [];
    function field(name, value) { parts.push(n.Buffer.from("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name + "\"\r\n\r\n" + value + "\r\n", "utf8")); }
    field("model", options.apiModel || provider.model);
    field("response_format", "verbose_json");
    if (options.language && options.language !== "auto") { field("language", options.language); }
    if (options.prompt) { field("prompt", options.prompt); }
    parts.push(n.Buffer.from("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" + n.path.basename(file).replace(/"/g, "") + "\"\r\nContent-Type: application/octet-stream\r\n\r\n", "utf8"));
    parts.push(data);
    parts.push(n.Buffer.from("\r\n--" + boundary + "--\r\n", "utf8"));
    var body = n.Buffer.concat(parts);
    return new Promise(function (resolve, reject) {
      var request = n.https.request({
        host: provider.host, path: provider.path, method: "POST",
        headers: { "Authorization": "Bearer " + options.apiKey, "Content-Type": "multipart/form-data; boundary=" + boundary, "Content-Length": body.length }
      }, function (response) {
        var chunks = [];
        response.on("data", function (chunk) { chunks.push(chunk); });
        response.on("end", function () {
          var text = n.Buffer.concat(chunks).toString("utf8"), json = null;
          try { json = JSON.parse(text); } catch (error) { json = null; }
          if (response.statusCode !== 200) {
            reject(new Error(provider.label + " transcription failed (HTTP " + response.statusCode + "): " + ((json && json.error && json.error.message) || text.slice(0, 300))));
            return;
          }
          var segments = ((json && json.segments) || []).map(function (segment) { return { start: segment.start, end: segment.end, text: String(segment.text || "").trim() }; });
          resolve({ text: String((json && json.text) || "").trim(), segments: segments });
        });
      });
      request.on("error", reject);
      request.setTimeout(300000, function () { request.destroy(new Error(provider.label + " did not answer in time.")); });
      request.end(body);
    });
  };

  // options: { engine: "local" | "openai" | "groq", language, model, apiKey }
  Media.prototype.transcribe = function (file, options) {
    return options.engine === "local" ? this.transcribeLocal(file, options) : this.transcribeApi(file, options);
  };

  // Engines differ in what they need; report what is missing for the chosen one.
  Media.prototype.transcriptionProblem = function (options) {
    if (options.engine === "local") {
      if (!this.findWhisper()) { return "whisper.cpp is not installed."; }
      if (!this.modelPath(options.model || "small")) { return "The transcription model is not downloaded."; }
      return null;
    }
    if (!API_PROVIDERS[options.engine]) { return "Choose a transcription engine."; }
    return options.apiKey ? null : "Add your " + API_PROVIDERS[options.engine].label + " API key.";
  };

  // Evenly spaced sample times, centred in each slice so the very first and
  // last (often black) frames are avoided.
  function sampleTimes(duration, count) {
    var usable = Math.max(1, Math.min(count, Math.floor(duration / 0.25) || 1));
    var times = [];
    for (var i = 0; i < usable; i += 1) { times.push(Math.max(0, duration * (i + 0.5) / usable)); }
    return times;
  }

  function formatTime(seconds) {
    seconds = Math.max(0, seconds || 0);
    var minutes = Math.floor(seconds / 60);
    var rest = seconds - minutes * 60;
    return String(minutes).padStart(2, "0") + ":" + rest.toFixed(1).padStart(4, "0");
  }

  function formatTranscript(result) {
    if (!result) { return ""; }
    if (result.segments && result.segments.length) {
      return result.segments.map(function (segment) { return "[" + formatTime(segment.start) + "–" + formatTime(segment.end) + "] " + segment.text; }).join("\n");
    }
    return result.text || "";
  }

  // 16 kHz mono PCM WAV, the format whisper.cpp reads directly.
  function encodeWav(samples, sampleRate) {
    var buffer = new ArrayBuffer(44 + samples.length * 2);
    var view = new DataView(buffer);
    function text(offset, value) { for (var i = 0; i < value.length; i += 1) { view.setUint8(offset + i, value.charCodeAt(i)); } }
    text(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVE");
    text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, "data"); view.setUint32(40, samples.length * 2, true);
    for (var i = 0; i < samples.length; i += 1) {
      var s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buffer;
  }

  return {
    Media: Media,
    MODELS: MODELS,
    API_PROVIDERS: API_PROVIDERS,
    sampleTimes: sampleTimes,
    formatTime: formatTime,
    formatTranscript: formatTranscript,
    parseWhisperOutput: parseWhisperOutput,
    encodeWav: encodeWav
  };
}));
