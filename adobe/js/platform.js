(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.AEPlatform = api;
}(typeof window !== "undefined" ? window : this, function () {
  "use strict";
  function windows(n) { return n.process && n.process.platform === "win32"; }
  function pathDirs(n) {
    var env = n.process.env || {};
    return String(env.Path || env.PATH || "").split(windows(n) ? ";" : ":").filter(Boolean);
  }
  // PATH entries for exe, plus WinGet's link folder on Windows.
  function onPath(n, exe) {
    var list = pathDirs(n).map(function (dir) { return n.path.join(dir, exe); });
    if (windows(n)) { list.push(n.path.join(n.process.env.LOCALAPPDATA || n.path.join(n.os.homedir(), "AppData", "Local"), "Microsoft", "WinGet", "Links", exe)); }
    return list;
  }
  // Native binaries that npm, pnpm or nvm installs keep inside node_modules
  // (on Windows npm only puts .cmd shims on the PATH).
  function inNodeModules(n, scope, exe) {
    var env = n.process.env || {}, win = windows(n), roots = [], found = [];
    if (win) {
      roots.push(n.path.join(env.APPDATA || n.path.join(n.os.homedir(), "AppData", "Roaming"), "npm"));
      roots.push(n.path.join(env.LOCALAPPDATA || n.path.join(n.os.homedir(), "AppData", "Local"), "pnpm"));
      var shim = exe.replace(/\.exe$/i, "") + ".cmd";
      pathDirs(n).forEach(function (dir) { if (n.fs.existsSync(n.path.join(dir, shim))) { roots.push(dir); } });
    } else {
      roots.push("/opt/homebrew/lib", "/usr/local/lib", n.path.join(n.os.homedir(), ".npm-global", "lib"));
    }
    function search(dir, depth) {
      var entries;
      try { entries = n.fs.readdirSync(dir); } catch (error) { return; }
      if (entries.indexOf(exe) >= 0) { found.push(n.path.join(dir, exe)); }
      if (depth > 0) {
        entries.forEach(function (name) {
          var full = n.path.join(dir, name);
          try { if (n.fs.statSync(full).isDirectory()) { search(full, depth - 1); } } catch (error) { /* unreadable */ }
        });
      }
    }
    roots.forEach(function (root) {
      var modules = [n.path.join(root, "node_modules")];
      try { n.fs.readdirSync(n.path.join(root, "global")).forEach(function (g) { modules.push(n.path.join(root, "global", g, "node_modules")); }); } catch (error) { /* no pnpm store */ }
      modules.forEach(function (m) { search(n.path.join(m, scope), 9); });
    });
    return found;
  }
  function dataDirectory(n) {
    return windows(n) ? n.path.join(n.process.env.APPDATA || n.path.join(n.os.homedir(), "AppData", "Roaming"), "AE Agent") : n.path.join(n.os.homedir(), "Library", "Application Support", "AE Agent");
  }
  // Codex CLI (ChatGPT): explicit override, saved path, the copy bundled with the
  // Codex desktop app (newest build folder wins), npm and standalone installs.
  function findCodexBinary(n) {
    var env = n.process.env || {}, candidates = [], win = windows(n), exe = win ? "codex.exe" : "codex";
    if (env.CODEX_BIN) { candidates.push(env.CODEX_BIN); }
    var config = n.path.join(dataDirectory(n), "codex-path.txt");
    if (n.fs.existsSync(config)) { candidates.push(n.fs.readFileSync(config, "utf8").trim()); }
    if (win) {
      var local = env.LOCALAPPDATA || n.path.join(n.os.homedir(), "AppData", "Local");
      var roaming = env.APPDATA || n.path.join(n.os.homedir(), "AppData", "Roaming");
      var bundled = n.path.join(local, "OpenAI", "Codex", "bin");
      try {
        n.fs.readdirSync(bundled).map(function (name) {
          var file = n.path.join(bundled, name, exe);
          try { return { file: file, time: n.fs.statSync(file).mtime.getTime() }; } catch (error) { return null; }
        }).filter(Boolean).sort(function (a, b) { return b.time - a.time; }).forEach(function (entry) { candidates.push(entry.file); });
      } catch (error) { /* Codex desktop app not installed. */ }
    } else {
      candidates.push("/Applications/Codex.app/Contents/Resources/codex", "/opt/homebrew/bin/codex", "/usr/local/bin/codex", n.path.join(n.os.homedir(), ".npm-global", "bin", "codex"));
    }
    candidates.push(n.path.join(n.os.homedir(), ".local", "bin", exe));
    candidates = candidates.concat(onPath(n, exe), inNodeModules(n, "@openai", exe));
    for (var i = 0; i < candidates.length; i += 1) {
      if (candidates[i] && isExecutable(n, candidates[i], win)) { return candidates[i]; }
    }
    return null;
  }
  // Antigravity CLI (agy): override, saved path, its installer's folder, ~/.local/bin, PATH.
  function findAgyBinary(n) {
    var env = n.process.env || {}, win = windows(n), exe = win ? "agy.exe" : "agy";
    var candidates = [env.AGY_BIN];
    var config = n.path.join(dataDirectory(n), "agy-path.txt");
    if (n.fs.existsSync(config)) { candidates.push(n.fs.readFileSync(config, "utf8").trim()); }
    if (win) {
      var local = env.LOCALAPPDATA || n.path.join(n.os.homedir(), "AppData", "Local");
      candidates.push(n.path.join(local, "agy", "bin", exe), n.path.join(local, "Programs", "Antigravity", "bin", exe));
    }
    candidates.push(n.path.join(n.os.homedir(), ".local", "bin", exe));
    candidates = candidates.concat(onPath(n, exe));
    for (var i = 0; i < candidates.length; i += 1) {
      if (candidates[i] && isExecutable(n, candidates[i], win)) { return candidates[i]; }
    }
    return null;
  }
  function compareVersions(a, b) {
    var x = String(a).split("."), y = String(b).split(".");
    for (var i = 0; i < Math.max(x.length, y.length); i += 1) {
      var d = (parseInt(x[i], 10) || 0) - (parseInt(y[i], 10) || 0);
      if (d) { return d; }
    }
    return 0;
  }
  // Claude Code CLI: explicit override, saved path, standalone installs, then the
  // copy bundled with the Claude desktop app (newest version folder wins).
  function findClaudeBinary(n) {
    var env = n.process.env || {}, candidates = [], win = windows(n), exe = win ? "claude.exe" : "claude";
    if (env.CLAUDE_BIN) { candidates.push(env.CLAUDE_BIN); }
    var config = n.path.join(dataDirectory(n), "claude-path.txt");
    if (n.fs.existsSync(config)) { candidates.push(n.fs.readFileSync(config, "utf8").trim()); }
    candidates.push(n.path.join(n.os.homedir(), ".local", "bin", exe));
    // Apps opened from the macOS Finder/Dock get a minimal PATH, so list the
    // usual install locations (native installer, Homebrew, npm) explicitly.
    if (!win) { candidates.push("/opt/homebrew/bin/claude", "/usr/local/bin/claude", n.path.join(n.os.homedir(), ".claude", "local", "claude"), n.path.join(n.os.homedir(), ".npm-global", "bin", "claude")); }
    var appRoots = [];
    if (win) {
      var roaming = env.APPDATA || n.path.join(n.os.homedir(), "AppData", "Roaming");
      var local = env.LOCALAPPDATA || n.path.join(n.os.homedir(), "AppData", "Local");
      appRoots.push(n.path.join(roaming, "Claude", "claude-code"));
      // Store (MSIX) builds of the desktop app keep their data in per-package folders.
      [n.path.join(local, "Claude-Data"), n.path.join(local, "Packages")].forEach(function (parent) {
        try {
          n.fs.readdirSync(parent).filter(function (name) { return /^claude_/i.test(name); }).forEach(function (name) {
            appRoots.push(n.path.join(parent, name, "claude-code"));
            appRoots.push(n.path.join(parent, name, "LocalCache", "Roaming", "Claude", "claude-code"));
          });
        } catch (error) { /* folder absent */ }
      });
    } else {
      appRoots.push(n.path.join(n.os.homedir(), "Library", "Application Support", "Claude", "claude-code"));
    }
    var versions = [];
    appRoots.forEach(function (appRoot) {
      try {
        n.fs.readdirSync(appRoot).filter(function (v) { return /^\d+(\.\d+)*$/.test(v); }).forEach(function (v) { versions.push({ version: v, dir: n.path.join(appRoot, v) }); });
      } catch (error) { /* Claude desktop app data not here. */ }
    });
    // The desktop app's layout differs by platform (Windows: <version>/<hash>/claude.exe;
    // macOS may nest it deeper, e.g. inside an .app bundle), so search each version folder.
    function collect(dir, depth) {
      var entries;
      try { entries = n.fs.readdirSync(dir); } catch (error) { return; }
      entries.forEach(function (name) {
        var full = n.path.join(dir, name);
        if (name === exe) { candidates.push(full); return; }
        if (depth > 0) {
          try { if (n.fs.statSync(full).isDirectory()) { collect(full, depth - 1); } } catch (error) { /* unreadable */ }
        }
      });
    }
    versions.sort(function (a, b) { return compareVersions(b.version, a.version); }).forEach(function (entry) {
      collect(entry.dir, 4);
    });
    candidates = candidates.concat(onPath(n, exe), inNodeModules(n, "@anthropic-ai", exe));
    for (var i = 0; i < candidates.length; i += 1) {
      if (candidates[i] && isExecutable(n, candidates[i], win)) { return candidates[i]; }
    }
    return null;
  }
  function isExecutable(n, file, win) {
    try {
      if (!n.fs.statSync(file).isFile()) { return false; }
      if (win) { return /\.exe$/i.test(file); }
      n.fs.accessSync(file, n.fs.constants.X_OK);
      return true;
    } catch (error) {
      return false;
    }
  }
  function environment(n, binary) {
    var source = n.process.env || {}, env = {}, entries = [], win = windows(n);
    Object.keys(source).forEach(function (key) { if (!win || key.toLowerCase() !== "path") { env[key] = source[key]; } });
    function add(value) { if (value && entries.indexOf(value) < 0) { entries.push(value); } }
    add(n.path.dirname(binary));
    if (!win) { ["/usr/local/bin", "/opt/homebrew/bin", n.path.join(n.os.homedir(), ".local", "bin"), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].forEach(add); }
    String(source.Path || source.PATH || "").split(win ? ";" : ":").forEach(add);
    env[win ? "Path" : "PATH"] = entries.join(win ? ";" : ":");
    return env;
  }
  function openFolder(n, folder) {
    var child = n.childProcess.spawn(windows(n) ? "explorer.exe" : "open", [folder], { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", function () {});
    child.unref();
  }
  // The chat apps, which do not include the command-line agents Soma runs;
  // only used to explain what is missing.
  function hasClaudeApp(n) {
    if (!n.fs) { return false; }
    var env = n.process.env || {}, local = env.LOCALAPPDATA || n.path.join(n.os.homedir(), "AppData", "Local");
    if (!windows(n)) { return n.fs.existsSync("/Applications/Claude.app"); }
    try { if (n.fs.readdirSync(n.path.join(local, "Packages")).some(function (name) { return /^claude_/i.test(name); })) { return true; } } catch (error) { /* no Store apps */ }
    return n.fs.existsSync(n.path.join(local, "AnthropicClaude")) || n.fs.existsSync(n.path.join(local, "Programs", "Claude"));
  }
  function hasAntigravityApp(n) {
    if (!n.fs) { return false; }
    var env = n.process.env || {}, local = env.LOCALAPPDATA || n.path.join(n.os.homedir(), "AppData", "Local");
    return windows(n) ? n.fs.existsSync(n.path.join(local, "Programs", "Antigravity", "Antigravity.exe")) : n.fs.existsSync("/Applications/Antigravity.app");
  }
  return { windows: windows, dataDirectory: dataDirectory, findCodexBinary: findCodexBinary, findClaudeBinary: findClaudeBinary, findAgyBinary: findAgyBinary, hasClaudeApp: hasClaudeApp, hasAntigravityApp: hasAntigravityApp, environment: environment, openFolder: openFolder };
}));
