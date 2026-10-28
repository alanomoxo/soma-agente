// Soma Agente installer for Windows: pick the programs, click Install.
//  - After Effects, Photoshop, Illustrator, Premiere Pro: one CEP panel whose
//    manifest lists only the chosen programs; enables unsigned panels
//    (PlayerDebugMode) for CEP 11 and 12.
//  - Blender: legacy add-on in each Blender 4.2+ user folder, switched on once
//    by a small startup script.
//  - Cinema 4D: Python plugin in each Cinema 4D 2024+ preferences folder.
//  - Figma: plugin files plus a local helper (embedded Python) that starts at
//    login; the user imports the plugin manifest in Figma once.
// Built with the .NET Framework csc (C# 5), so no newer language features.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Soma Agente - Instalador")]
[assembly: AssemblyProduct("Soma Agente")]
[assembly: AssemblyDescription("Instalador do Soma Agente, agente de IA de código aberto para programas criativos (github.com/alanomoxo/soma-agente)")]
[assembly: AssemblyCompany("alanomoxo")]
[assembly: AssemblyCopyright("Copyright (c) 2026 alanomoxo and the Soma Agente contributors. MIT License.")]
[assembly: AssemblyVersion("1.7.0.0")]
[assembly: AssemblyFileVersion("1.7.0.0")]

namespace Soma
{
    static class Paths
    {
        public const string BundleId = "com.framepilot.aeagent";
        public const string Version = "1.7.0";
        // SOMA_TEST_ROOT redirects every write (files and registry) for testing.
        public static readonly string TestRoot = Environment.GetEnvironmentVariable("SOMA_TEST_ROOT");
        public static string Roaming { get { return TestRoot != null ? Path.Combine(TestRoot, "Roaming") : Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData); } }
        public static string Local { get { return TestRoot != null ? Path.Combine(TestRoot, "Local") : Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData); } }
        public static string RealRoaming { get { return Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData); } }
        public static string RealLocal { get { return Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData); } }
        public static string Extensions { get { return Path.Combine(Roaming, @"Adobe\CEP\extensions"); } }
        public static string CepTarget { get { return Path.Combine(Extensions, BundleId); } }
        public static string CepBackups { get { return Path.Combine(Roaming, @"Adobe\CEP\extension-backups"); } }
        public static string Data { get { return Path.Combine(Roaming, "AE Agent"); } }
        public static string Backups { get { return Path.Combine(Data, "backups"); } }
        public static string FigmaHome { get { return Path.Combine(Local, @"Soma Agente\figma"); } }
        public static string FigmaManifest { get { return Path.Combine(FigmaHome, @"plugin\manifest.json"); } }
        public static string CavalryScript { get { return Path.Combine(Roaming, @"Cavalry\Scripts\Soma Agente.js"); } }
        public static string RegistryRoot { get { return TestRoot == null ? @"Software" : @"Software\SomaAgenteTest"; } }
        public static string CsxsKey(int version) { return RegistryRoot + @"\Adobe\CSXS." + version; }
        public static string RunKey { get { return RegistryRoot + @"\Microsoft\Windows\CurrentVersion\Run"; } }
        public static string Stamp() { return DateTime.Now.ToString("yyyyMMdd-HHmmss-fff"); }
    }

    // Interface language, Portuguese (Brazil) or English. Shared with every plugin
    // through %APPDATA%\AE Agent\language.txt; without it, Windows' language decides.
    static class Lang
    {
        public static bool En = Load();
        static string File_ { get { return Path.Combine(Paths.Data, "language.txt"); } }

        static bool Load()
        {
            try
            {
                string saved = File.Exists(File_) ? File.ReadAllText(File_).Trim().ToLowerInvariant() : "";
                if (saved == "pt" || saved == "en") { return saved == "en"; }
            }
            catch { }
            return !System.Globalization.CultureInfo.CurrentUICulture.Name.StartsWith("pt", StringComparison.OrdinalIgnoreCase);
        }

        public static void Save()
        {
            Directory.CreateDirectory(Paths.Data);
            File.WriteAllText(File_, En ? "en" : "pt");
        }

        public static string T(string pt, string en) { return En ? en : pt; }
    }

    class App
    {
        public string Id, Label, Detail;
        public bool Adobe, Found, Installed;
        public List<string> Targets = new List<string>();
        public string Exe;
        public string[] HostCodes = new string[0];
        public string ProcessName;
    }

    static class Detect
    {
        static IEnumerable<string> Dirs(string parent, string pattern)
        {
            try { return Directory.GetDirectories(parent, pattern).ToList(); } catch { return new string[0]; }
        }

        static int Year(string name)
        {
            Match m = Regex.Match(name, @"(20\d\d)");
            return m.Success ? int.Parse(m.Groups[1].Value) : 0;
        }

        static App Adobe(string id, string label, string folder, string exe, int minYear, string[] codes, string process)
        {
            var app = new App { Id = id, Label = label, Adobe = true, HostCodes = codes, ProcessName = process };
            string adobe = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Adobe");
            int best = 0;
            foreach (string dir in Dirs(adobe, folder + " 20*"))
            {
                int year = Year(Path.GetFileName(dir));
                if (year >= minYear && year > best && File.Exists(Path.Combine(dir, exe))) { best = year; app.Exe = Path.Combine(dir, exe); }
            }
            app.Found = best > 0;
            app.Detail = app.Found ? label + " " + best : label + " " + minYear + Lang.T("+ não encontrado", "+ not found");
            return app;
        }

        static string[] CepHosts()
        {
            try
            {
                string manifest = File.ReadAllText(Path.Combine(Paths.CepTarget, @"CSXS\manifest.xml"));
                return Regex.Matches(manifest, "<Host Name=\"([A-Z]+)\"").Cast<Match>().Select(m => m.Groups[1].Value).ToArray();
            }
            catch { return new string[0]; }
        }

        public static List<App> All()
        {
            var apps = new List<App>
            {
                Adobe("aftereffects", "After Effects", "Adobe After Effects", @"Support Files\AfterFX.exe", 2025, new[] { "AEFT" }, "AfterFX"),
                Adobe("photoshop", "Photoshop", "Adobe Photoshop", "Photoshop.exe", 2025, new[] { "PHXS", "PHSP" }, "Photoshop"),
                Adobe("illustrator", "Illustrator", "Adobe Illustrator", @"Support Files\Contents\Windows\Illustrator.exe", 2025, new[] { "ILST" }, "Illustrator"),
                Adobe("premierepro", "Premiere Pro", "Adobe Premiere Pro", "Adobe Premiere Pro.exe", 2025, new[] { "PPRO" }, "Adobe Premiere Pro")
            };
            string[] cep = CepHosts();
            foreach (App a in apps) { a.Installed = a.HostCodes.Any(c => cep.Contains(c)); }

            var blender = new App { Id = "blender", Label = "Blender", ProcessName = "blender" };
            var versions = new List<string>();
            foreach (string dir in Dirs(Path.Combine(Paths.RealRoaming, @"Blender Foundation\Blender"), "*"))
            {
                Version v;
                if (Version.TryParse(Path.GetFileName(dir), out v) && v >= new Version(4, 2))
                {
                    blender.Targets.Add(Path.Combine(Paths.Roaming, @"Blender Foundation\Blender", Path.GetFileName(dir)));
                    versions.Add(Path.GetFileName(dir));
                }
            }
            blender.Found = blender.Targets.Count > 0;
            blender.Detail = blender.Found ? "Blender " + string.Join(", ", versions) : Lang.T("Blender 4.2+ não encontrado (abra o Blender uma vez)", "Blender 4.2+ not found (open Blender once)");
            blender.Installed = blender.Targets.Any(t => Directory.Exists(Path.Combine(t, @"scripts\addons\soma_agente")));
            apps.Add(blender);

            var c4d = new App { Id = "cinema4d", Label = "Cinema 4D", ProcessName = "Cinema 4D" };
            var years = new List<string>();
            foreach (string dir in Dirs(Path.Combine(Paths.RealRoaming, "Maxon"), "Maxon Cinema 4D 20*"))
            {
                string name = Path.GetFileName(dir);
                Match m = Regex.Match(name, @"^Maxon Cinema 4D (20\d\d)_[0-9A-Fa-f]+$");
                if (m.Success && int.Parse(m.Groups[1].Value) >= 2024)
                {
                    c4d.Targets.Add(Path.Combine(Paths.Roaming, "Maxon", name));
                    if (!years.Contains(m.Groups[1].Value)) { years.Add(m.Groups[1].Value); }
                }
            }
            c4d.Found = c4d.Targets.Count > 0;
            c4d.Detail = c4d.Found ? "Cinema 4D " + string.Join(", ", years) : Lang.T("Cinema 4D 2024+ não encontrado (abra o C4D uma vez)", "Cinema 4D 2024+ not found (open C4D once)");
            c4d.Installed = c4d.Targets.Any(t => Directory.Exists(Path.Combine(t, @"plugins\soma_agente")));
            apps.Add(c4d);

            var figma = new App { Id = "figma", Label = "Figma", ProcessName = "Figma" };
            string figmaDir = Path.Combine(Paths.RealLocal, "Figma");
            figma.Found = File.Exists(Path.Combine(figmaDir, "Figma.exe")) || Dirs(figmaDir, "app-*").Any();
            figma.Detail = figma.Found ? Lang.T("Figma (app desktop)", "Figma (desktop app)") : Lang.T("Figma desktop não encontrado", "Figma desktop not found");
            figma.Installed = Directory.Exists(Paths.FigmaHome);
            apps.Add(figma);

            // Cavalry: a script panel in its Scripts folder; the Soma Hub runs its agent.
            var cavalry = new App { Id = "cavalry", Label = "Cavalry", ProcessName = "Cavalry" };
            cavalry.Found = File.Exists(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Cavalry\Cavalry.exe")) || Directory.Exists(Path.Combine(Paths.RealRoaming, "Cavalry"));
            cavalry.Detail = cavalry.Found ? "Cavalry" : Lang.T("Cavalry não encontrado", "Cavalry not found");
            cavalry.Installed = File.Exists(Paths.CavalryScript);
            apps.Add(cavalry);

            var antigravity = new App { Id = "antigravity", Label = "Antigravity" };
            antigravity.Found = Antigravity.Found();
            antigravity.Detail = antigravity.Found ? Lang.T("Antigravity: comandar todos os apps de uma vez", "Antigravity: drive every app at once") : Lang.T("Antigravity não encontrado (antigravity.google)", "Antigravity not found (antigravity.google)");
            antigravity.Installed = Antigravity.Connected();
            apps.Add(antigravity);

            // SOMA_TEST_MISSING=cinema4d,figma shows those programs as not found (UI testing).
            string missing = Environment.GetEnvironmentVariable("SOMA_TEST_MISSING");
            if (!string.IsNullOrEmpty(missing))
            {
                foreach (App app in apps.Where(a => missing.Split(',').Contains(a.Id)))
                {
                    app.Found = false;
                    app.Installed = false;
                    app.Detail = app.Label + Lang.T(" não encontrado", " not found");
                }
            }
            return apps;
        }

        // PATH of this process plus the saved user and machine PATH: a CLI installed
        // after login is not yet in the PATH that Explorer handed to us.
        static List<string> PathDirs()
        {
            var dirs = new List<string>();
            foreach (string path in new[] { Environment.GetEnvironmentVariable("PATH"), Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.User), Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.Machine) })
            {
                foreach (string d in (path ?? "").Split(';'))
                {
                    string dir = Environment.ExpandEnvironmentVariables(d.Trim().Trim('"'));
                    if (dir.Length > 0 && !dirs.Contains(dir, StringComparer.OrdinalIgnoreCase)) { dirs.Add(dir); }
                }
            }
            return dirs;
        }

        static IEnumerable<string> OnPath(string exe)
        {
            var found = new List<string>();
            foreach (string dir in PathDirs()) { try { found.Add(Path.Combine(dir, exe)); } catch { } }
            found.Add(Path.Combine(Paths.RealLocal, @"Microsoft\WinGet\Links\" + exe));
            return found;
        }

        // Native binaries that npm, pnpm or nvm installs keep inside node_modules
        // (npm itself only puts .cmd shims on the PATH).
        static IEnumerable<string> InNodeModules(string scope, string exe)
        {
            var roots = new List<string> { Path.Combine(Paths.RealRoaming, "npm"), Path.Combine(Paths.RealLocal, "pnpm") };
            string shim = Path.GetFileNameWithoutExtension(exe) + ".cmd";
            foreach (string dir in PathDirs()) { try { if (File.Exists(Path.Combine(dir, shim))) { roots.Add(dir); } } catch { } }
            var found = new List<string>();
            foreach (string root in roots)
            {
                var modules = new List<string> { Path.Combine(root, "node_modules") };
                foreach (string g in Dirs(Path.Combine(root, "global"), "*")) { modules.Add(Path.Combine(g, "node_modules")); }
                foreach (string m in modules) { Search(Path.Combine(m, scope), exe, 9, found); }
            }
            return found;
        }

        static void Search(string dir, string exe, int depth, List<string> found)
        {
            try
            {
                string file = Path.Combine(dir, exe);
                if (File.Exists(file)) { found.Add(file); }
                if (depth > 0) { foreach (string d in Directory.GetDirectories(dir)) { Search(d, exe, depth - 1, found); } }
            }
            catch { }
        }

        static bool AnyExists(IEnumerable<string> files)
        {
            foreach (string f in files) { try { if (File.Exists(f)) { return true; } } catch { } }
            return false;
        }

        public static bool Claude()
        {
            var c = new List<string> { Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), @".local\bin\claude.exe") };
            var roots = new List<string> { Path.Combine(Paths.RealRoaming, @"Claude\claude-code") };
            foreach (string parent in new[] { Path.Combine(Paths.RealLocal, "Claude-Data"), Path.Combine(Paths.RealLocal, "Packages") })
            {
                foreach (string d in Dirs(parent, "Claude_*")) { roots.Add(Path.Combine(d, "claude-code")); roots.Add(Path.Combine(d, @"LocalCache\Roaming\Claude\claude-code")); }
            }
            foreach (string root in roots)
            {
                try { c.AddRange(Directory.GetFiles(root, "claude.exe", SearchOption.AllDirectories)); } catch { }
            }
            c.AddRange(OnPath("claude.exe"));
            c.AddRange(InNodeModules("@anthropic-ai", "claude.exe"));
            return AnyExists(c);
        }

        public static bool Codex()
        {
            var c = new List<string>();
            c.AddRange(Dirs(Path.Combine(Paths.RealLocal, @"OpenAI\Codex\bin"), "*").Select(d => Path.Combine(d, "codex.exe")));
            c.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), @".local\bin\codex.exe"));
            c.AddRange(OnPath("codex.exe"));
            c.AddRange(InNodeModules("@openai", "codex.exe"));
            return AnyExists(c);
        }

        // Antigravity CLI (agy), which the agent runs; the Antigravity app alone is not enough.
        public static bool Agy()
        {
            var c = new List<string> { Path.Combine(Paths.RealLocal, @"agy\bin\agy.exe"), Path.Combine(Paths.RealLocal, @"Programs\Antigravity\bin\agy.exe"), Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), @".local\bin\agy.exe") };
            c.AddRange(OnPath("agy.exe"));
            return AnyExists(c);
        }

        public static bool Running(App app)
        {
            if (Paths.TestRoot != null || app.ProcessName == null) { return false; }
            return Process.GetProcessesByName(app.ProcessName).Length > 0;
        }
    }

    static class Installer
    {
        static Stream Resource(string name) { return Assembly.GetExecutingAssembly().GetManifestResourceStream(name); }

        public static Image Picture(string name)
        {
            using (Stream s = Resource(name))
            {
                if (s == null) { return null; }
                var m = new MemoryStream();
                s.CopyTo(m);
                return Image.FromStream(new MemoryStream(m.ToArray()));
            }
        }

        static void Extract(string resource, string destination)
        {
            using (Stream payload = Resource(resource))
            using (var zip = new ZipArchive(payload, ZipArchiveMode.Read))
            {
                string root = Path.GetFullPath(destination);
                foreach (ZipArchiveEntry entry in zip.Entries)
                {
                    string dest = Path.GetFullPath(Path.Combine(destination, entry.FullName));
                    if (!dest.StartsWith(root, StringComparison.OrdinalIgnoreCase)) { continue; }
                    if (entry.FullName.EndsWith("/")) { Directory.CreateDirectory(dest); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    entry.ExtractToFile(dest, true);
                }
            }
        }

        // Moves an existing folder aside (nothing is deleted).
        static string Shelve(string folder, string backupRoot, string label)
        {
            if (!Directory.Exists(folder)) { return null; }
            Directory.CreateDirectory(backupRoot);
            string backup = Path.Combine(backupRoot, label + "-" + Paths.Stamp());
            Directory.Move(folder, backup);
            return backup;
        }

        // Puts the payload in place through a staging folder, restoring the old one on failure.
        static void Replace(string resource, string target, string backupRoot, string label, Action<string> prepare)
        {
            string stage = target + ".staging-" + Guid.NewGuid().ToString("N").Substring(0, 8);
            Extract(resource, stage);
            if (prepare != null) { prepare(stage); }
            string backup = null;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                backup = Shelve(target, backupRoot, label);
                Directory.Move(stage, target);
            }
            catch
            {
                if (backup != null && !Directory.Exists(target)) { Directory.Move(backup, target); }
                try { Directory.Delete(stage, true); } catch { }
                throw;
            }
        }

        static void EnableUnsignedPanels()
        {
            Directory.CreateDirectory(Paths.Data);
            foreach (int version in new[] { 11, 12 })
            {
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(Paths.CsxsKey(version)))
                {
                    string record = Path.Combine(Paths.Data, version == 12 ? "cep-debug-before-install.txt" : "cep-debug-before-install-" + version + ".txt");
                    object previous = key.GetValue("PlayerDebugMode");
                    if (!File.Exists(record)) { File.WriteAllText(record, previous == null ? "ABSENT" : previous.ToString()); }
                    key.SetValue("PlayerDebugMode", "1", RegistryValueKind.String);
                }
            }
        }

        static void RestoreUnsignedPanels()
        {
            foreach (int version in new[] { 11, 12 })
            {
                string record = Path.Combine(Paths.Data, version == 12 ? "cep-debug-before-install.txt" : "cep-debug-before-install-" + version + ".txt");
                if (!File.Exists(record)) { continue; }
                string previous = File.ReadAllText(record).Trim();
                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(Paths.CsxsKey(version)))
                {
                    if (previous == "ABSENT") { key.DeleteValue("PlayerDebugMode", false); } else { key.SetValue("PlayerDebugMode", previous, RegistryValueKind.String); }
                }
                File.Delete(record);
            }
        }

        const string BlenderStartup =
            "# Soma Agente: switches the add-on on once after installation.\n" +
            "import os\n\nimport addon_utils\nimport bpy\n\n" +
            "MARKER = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), \"addons\", \"soma_agente\", \".enabled-once\")\n\n\n" +
            "def _enable():\n" +
            "    if os.path.exists(MARKER):\n        return None\n" +
            "    addon_utils.enable(\"soma_agente\", default_set=True, persistent=True)\n" +
            "    try:\n        bpy.ops.wm.save_userpref()\n    except Exception:\n        pass\n" +
            "    with open(MARKER, \"w\") as handle:\n        handle.write(\"1\")\n" +
            "    return None\n\n\n" +
            "def register():\n    bpy.app.timers.register(_enable, first_interval=1.0)\n\n\n" +
            "def unregister():\n    pass\n";

        public static void Install(List<App> apps, Action<string> step)
        {
            var adobe = apps.Where(a => a.Adobe).ToList();
            if (adobe.Count > 0)
            {
                step(Lang.T("Instalando o painel Adobe…", "Installing the Adobe panel…"));
                string hosts = string.Join("\n", adobe.SelectMany(a => a.HostCodes.Select(code => "      <Host Name=\"" + code + "\" Version=\"" + (code == "PHXS" || code == "PHSP" ? "[26.0,99.9]" : code == "ILST" ? "[29.0,99.9]" : "[25.0,99.9]") + "\" />")));
                Replace("cep.zip", Paths.CepTarget, Paths.CepBackups, Paths.BundleId, delegate (string stage)
                {
                    string manifestPath = Path.Combine(stage, @"CSXS\manifest.xml");
                    string manifest = File.ReadAllText(manifestPath);
                    manifest = Regex.Replace(manifest, @"<HostList>[\s\S]*?</HostList>", "<HostList>\n" + hosts + "\n    </HostList>");
                    File.WriteAllText(manifestPath, manifest);
                });
                EnableUnsignedPanels();
            }
            foreach (App app in apps.Where(a => a.Id == "blender"))
            {
                foreach (string target in app.Targets)
                {
                    step(Lang.T("Instalando no ", "Installing in ") + app.Label + " " + Path.GetFileName(target) + "…");
                    Replace("blender.zip", Path.Combine(target, @"scripts\addons\soma_agente"), Path.Combine(Paths.Backups, "blender"), "soma_agente-" + Path.GetFileName(target), null);
                    string startup = Path.Combine(target, @"scripts\startup");
                    Directory.CreateDirectory(startup);
                    File.WriteAllText(Path.Combine(startup, "soma_agente_autoenable.py"), BlenderStartup);
                }
            }
            foreach (App app in apps.Where(a => a.Id == "cinema4d"))
            {
                foreach (string target in app.Targets)
                {
                    step(Lang.T("Instalando no ", "Installing in ") + Path.GetFileName(target) + "…");
                    Replace("c4d.zip", Path.Combine(target, @"plugins\soma_agente"), Path.Combine(Paths.Backups, "cinema4d"), "soma_agente-" + Path.GetFileName(target), null);
                }
            }
            if (apps.Any(a => a.Id == "cavalry"))
            {
                step(Lang.T("Instalando no Cavalry…", "Installing in Cavalry…"));
                Directory.CreateDirectory(Path.GetDirectoryName(Paths.CavalryScript));
                using (Stream s = Resource("cavalry.js"))
                using (var file = File.Create(Paths.CavalryScript)) { s.CopyTo(file); }
            }
            // The Soma Hub (also the Figma helper) is always installed: it lets
            // Antigravity drive every open program. It starts at login.
            step(Lang.T("Instalando o Soma Hub…", "Installing the Soma Hub…"));
            StopHub();
            ReplaceParts("figma.zip", Paths.FigmaHome, Path.Combine(Paths.Backups, "figma"), delegate (string stage) { PreparePython(Path.Combine(stage, "python"), step); });
            using (RegistryKey run = Registry.CurrentUser.CreateSubKey(Paths.RunKey))
            {
                run.DeleteValue("SomaAgenteFigma", false);
                run.SetValue("SomaAgenteHub", "\"" + HubPython + "\" \"" + HubScript + "\"", RegistryValueKind.String);
            }
            if (File.Exists(LegacyShortcutPath)) { File.Delete(LegacyShortcutPath); }
            CreateShortcut();
            string token = HubToken();
            if (apps.Any(a => a.Id == "antigravity"))
            {
                step(Lang.T("Conectando o Antigravity a todos os apps…", "Connecting Antigravity to every app…"));
                Antigravity.Connect(token);
            }
            File.WriteAllText(Path.Combine(Paths.Data, "installed-version.txt"), Paths.Version);
            Lang.Save();
            StartHub();
        }

        // Python for the Soma Hub: the official embeddable build from python.org
        // (pinned and checked), reused from the current install when present,
        // instead of being packed inside this installer.
        const string PythonUrl = "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip";
        const string PythonSha = "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3";

        static void PreparePython(string destination, Action<string> step)
        {
            string current = Path.Combine(Paths.FigmaHome, "python");
            if (File.Exists(Path.Combine(current, "python312.dll")) && File.Exists(Path.Combine(current, "pythonw.exe")))
            {
                CopyFolder(current, destination);
                return;
            }
            string cache = Path.Combine(Paths.Data, @"cache\python-3.12.10-embed-amd64.zip");
            if (!File.Exists(cache) || GitHubRelease.Sha256(File.ReadAllBytes(cache)) != PythonSha)
            {
                step(Lang.T("Baixando o Python (python.org)…", "Downloading Python (python.org)…"));
                byte[] data = GitHubRelease.Get(PythonUrl);
                if (GitHubRelease.Sha256(data) != PythonSha) { throw new InvalidDataException(Lang.T("o Python baixado não confere com o SHA-256 esperado", "the downloaded Python does not match the expected SHA-256")); }
                Directory.CreateDirectory(Path.GetDirectoryName(cache));
                File.WriteAllBytes(cache, data);
            }
            ZipFile.ExtractToDirectory(cache, destination);
        }

        static void CopyFolder(string source, string destination)
        {
            Directory.CreateDirectory(destination);
            foreach (string dir in Directory.GetDirectories(source, "*", SearchOption.AllDirectories))
            {
                Directory.CreateDirectory(Path.Combine(destination, dir.Substring(source.Length + 1)));
            }
            foreach (string file in Directory.GetFiles(source, "*", SearchOption.AllDirectories))
            {
                File.Copy(file, Path.Combine(destination, file.Substring(source.Length + 1)), true);
            }
        }

        // Like Replace, but swaps each top-level folder separately: Explorer or Figma
        // can keep the root folder itself open, which blocks moving it.
        static void ReplaceParts(string resource, string target, string backupRoot, Action<string> prepare)
        {
            string stage = target + ".staging-" + Guid.NewGuid().ToString("N").Substring(0, 8);
            Extract(resource, stage);
            if (prepare != null) { prepare(stage); }
            Directory.CreateDirectory(target);
            string stamp = Paths.Stamp();
            try
            {
                foreach (string part in Directory.GetDirectories(stage))
                {
                    string name = Path.GetFileName(part);
                    string current = Path.Combine(target, name);
                    if (Directory.Exists(current))
                    {
                        Directory.CreateDirectory(Path.Combine(backupRoot, "figma-" + stamp));
                        Retry(delegate { Directory.Move(current, Path.Combine(backupRoot, "figma-" + stamp, name)); });
                    }
                    Retry(delegate { Directory.Move(part, current); });
                }
            }
            finally
            {
                try { Directory.Delete(stage, true); } catch { }
            }
        }

        // Folders of a just-stopped process can stay busy for a moment.
        static void Retry(Action action)
        {
            for (int attempt = 0; ; attempt += 1)
            {
                try { action(); return; }
                catch (IOException) { if (attempt >= 10) { throw; } }
                catch (UnauthorizedAccessException) { if (attempt >= 10) { throw; } }
                Thread.Sleep(500);
            }
        }

        static string HubPython { get { return Path.Combine(Paths.FigmaHome, @"python\pythonw.exe"); } }
        static string HubScript { get { return Path.Combine(Paths.FigmaHome, @"bridge\soma_hub.py"); } }

        // Shared secret for the hub's MCP endpoint; the hub reads the same file.
        static string HubToken()
        {
            string file = Path.Combine(Paths.Data, "hub-token.txt");
            if (File.Exists(file) && File.ReadAllText(file).Trim().Length > 0) { return File.ReadAllText(file).Trim(); }
            var bytes = new byte[24];
            using (var rng = System.Security.Cryptography.RandomNumberGenerator.Create()) { rng.GetBytes(bytes); }
            string token = string.Concat(bytes.Select(b => b.ToString("x2")));
            Directory.CreateDirectory(Paths.Data);
            File.WriteAllText(file, token);
            return token;
        }

        static string Programs { get { return Paths.TestRoot != null ? Path.Combine(Paths.TestRoot, "StartMenu") : Environment.GetFolderPath(Environment.SpecialFolder.Programs); } }
        static string ShortcutPath { get { return Path.Combine(Programs, "Soma Hub.lnk"); } }
        static string LegacyShortcutPath { get { return Path.Combine(Programs, "Soma Agente para Figma.lnk"); } }

        static void CreateShortcut()
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(ShortcutPath));
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                object shell = Activator.CreateInstance(shellType);
                object link = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { ShortcutPath });
                Type linkType = link.GetType();
                linkType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { HubPython });
                linkType.InvokeMember("Arguments", BindingFlags.SetProperty, null, link, new object[] { "\"" + HubScript + "\"" });
                linkType.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { "Soma Hub: conecta o Figma e o Antigravity aos seus programas" });
                linkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
            }
            catch { /* the Run entry still starts it at login */ }
        }

        static void StartHub()
        {
            if (Paths.TestRoot != null) { return; }
            try
            {
                Process.Start(new ProcessStartInfo(HubPython, "\"" + HubScript + "\"") { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(HubScript) });
            }
            catch { }
        }

        static void StopHub()
        {
            string home = Path.GetFullPath(Paths.FigmaHome);
            foreach (Process p in Process.GetProcessesByName("pythonw").Concat(Process.GetProcessesByName("python")))
            {
                try { if (p.MainModule.FileName.StartsWith(home, StringComparison.OrdinalIgnoreCase)) { p.Kill(); p.WaitForExit(5000); } } catch { }
            }
        }

        public static void Uninstall(List<App> apps)
        {
            Shelve(Paths.CepTarget, Paths.CepBackups, Paths.BundleId + "-removed");
            RestoreUnsignedPanels();
            foreach (App app in apps.Where(a => a.Id == "blender"))
            {
                foreach (string target in app.Targets)
                {
                    Shelve(Path.Combine(target, @"scripts\addons\soma_agente"), Path.Combine(Paths.Backups, "blender"), "soma_agente-removed-" + Path.GetFileName(target));
                    string startup = Path.Combine(target, @"scripts\startup\soma_agente_autoenable.py");
                    if (File.Exists(startup)) { File.Delete(startup); }
                }
            }
            foreach (App app in apps.Where(a => a.Id == "cinema4d"))
            {
                foreach (string target in app.Targets) { Shelve(Path.Combine(target, @"plugins\soma_agente"), Path.Combine(Paths.Backups, "cinema4d"), "soma_agente-removed-" + Path.GetFileName(target)); }
            }
            if (File.Exists(Paths.CavalryScript))
            {
                string backup = Path.Combine(Paths.Backups, "cavalry");
                Directory.CreateDirectory(backup);
                File.Move(Paths.CavalryScript, Path.Combine(backup, "Soma Agente-removed-" + Paths.Stamp() + ".js"));
            }
            StopHub();
            if (Directory.Exists(Paths.FigmaHome))
            {
                string backup = Path.Combine(Paths.Backups, "figma", "figma-removed-" + Paths.Stamp());
                Directory.CreateDirectory(backup);
                foreach (string part in Directory.GetDirectories(Paths.FigmaHome))
                {
                    string name = Path.GetFileName(part);
                    Retry(delegate { Directory.Move(part, Path.Combine(backup, name)); });
                }
                try { Directory.Delete(Paths.FigmaHome, false); } catch { /* still open in Explorer; empty */ }
            }
            using (RegistryKey run = Registry.CurrentUser.CreateSubKey(Paths.RunKey)) { run.DeleteValue("SomaAgenteFigma", false); run.DeleteValue("SomaAgenteHub", false); }
            foreach (string link in new[] { ShortcutPath, LegacyShortcutPath }) { if (File.Exists(link)) { File.Delete(link); } }
            Antigravity.Disconnect();
        }
    }

    // Registers the Soma Hub as MCP server "soma" for the Antigravity app, IDE
    // and CLI, and lets the headless CLI use only its three tools.
    static class Antigravity
    {
        static readonly string[] Rules = { "mcp(soma/*)" };

        static string Gemini { get { return Paths.TestRoot != null ? Path.Combine(Paths.TestRoot, "gemini") : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".gemini"); } }
        static string[] McpFiles { get { return new[] { Path.Combine(Gemini, @"config\mcp_config.json"), Path.Combine(Gemini, @"antigravity\mcp_config.json") }; } }
        static string CliSettings { get { return Path.Combine(Gemini, @"antigravity-cli\settings.json"); } }

        static System.Web.Script.Serialization.JavaScriptSerializer Json() { return new System.Web.Script.Serialization.JavaScriptSerializer(); }

        static Dictionary<string, object> Read(string file)
        {
            try
            {
                string text = File.Exists(file) ? File.ReadAllText(file).Trim() : "";
                if (text.Length == 0) { return new Dictionary<string, object>(); }
                return Json().Deserialize<Dictionary<string, object>>(text) ?? new Dictionary<string, object>();
            }
            catch { return null; } // unreadable: leave the user's file alone
        }

        static void Write(string file, Dictionary<string, object> value)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            File.WriteAllText(file, Json().Serialize(value));
        }

        static Dictionary<string, object> Child(Dictionary<string, object> parent, string key)
        {
            object existing;
            var child = parent.TryGetValue(key, out existing) ? existing as Dictionary<string, object> : null;
            if (child == null) { child = new Dictionary<string, object>(); parent[key] = child; }
            return child;
        }

        public static bool Found()
        {
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return File.Exists(Path.Combine(local, @"Programs\Antigravity\Antigravity.exe")) || Detect.Agy() ||Directory.Exists(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), @".gemini\antigravity"));
        }

        public static bool Connected()
        {
            return McpFiles.Any(f => { var c = Read(f); return c != null && c.ContainsKey("mcpServers") && ((Dictionary<string, object>)c["mcpServers"]).ContainsKey("soma"); });
        }

        public static void Connect(string token)
        {
            foreach (string file in McpFiles)
            {
                var config = Read(file);
                if (config == null) { continue; }
                Child(config, "mcpServers")["soma"] = new Dictionary<string, object>
                {
                    { "serverUrl", "http://127.0.0.1:47821/mcp" },
                    { "headers", new Dictionary<string, object> { { "Authorization", "Bearer " + token } } },
                    { "timeoutSeconds", 3600 }
                };
                Write(file, config);
            }
            var settings = Read(CliSettings);
            if (settings == null) { return; }
            var permissions = Child(settings, "permissions");
            object existing;
            var allow = permissions.TryGetValue("allow", out existing) && existing is System.Collections.ArrayList ? (System.Collections.ArrayList)existing : new System.Collections.ArrayList();
            foreach (string rule in Rules) { if (!allow.Contains(rule)) { allow.Add(rule); } }
            permissions["allow"] = allow;
            Write(CliSettings, settings);
        }

        public static void Disconnect()
        {
            foreach (string file in McpFiles)
            {
                var config = Read(file);
                object servers;
                if (config != null && config.TryGetValue("mcpServers", out servers) && servers is Dictionary<string, object> && ((Dictionary<string, object>)servers).Remove("soma")) { Write(file, config); }
            }
            var settings = Read(CliSettings);
            object permissions, allow;
            if (settings != null && settings.TryGetValue("permissions", out permissions) && permissions is Dictionary<string, object> && ((Dictionary<string, object>)permissions).TryGetValue("allow", out allow) && allow is System.Collections.ArrayList)
            {
                foreach (string rule in Rules) { ((System.Collections.ArrayList)allow).Remove(rule); }
                Write(CliSettings, settings);
            }
        }
    }

    // Latest Release of the Soma Agente repository (same source as the Soma Hub updater).
    class GitHubRelease
    {
        const string Repository = "alanomoxo/soma-agente";
        const string Asset = "Soma-Agente-Instalador.exe";
        public string Version, InstallerUrl, ShaUrl, PageUrl;

        public static string Sha256(byte[] data)
        {
            using (var sha = System.Security.Cryptography.SHA256.Create()) { return string.Concat(sha.ComputeHash(data).Select(b => b.ToString("x2"))); }
        }

        public static byte[] Get(string url)
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            using (var client = new WebClient())
            {
                client.Headers[HttpRequestHeader.UserAgent] = "SomaAgente-Installer/" + Paths.Version;
                return client.DownloadData(url);
            }
        }

        public static GitHubRelease Latest()
        {
            string json = Encoding.UTF8.GetString(Get("https://api.github.com/repos/" + Repository + "/releases/latest"));
            var release = new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
            var result = new GitHubRelease { Version = Convert.ToString(release["tag_name"]).TrimStart('v', 'V'), PageUrl = Convert.ToString(release["html_url"]) };
            foreach (object item in (System.Collections.ArrayList)release["assets"])
            {
                var asset = (Dictionary<string, object>)item;
                string name = Convert.ToString(asset["name"]);
                if (name == Asset) { result.InstallerUrl = Convert.ToString(asset["browser_download_url"]); }
                if (name == Asset + ".sha256") { result.ShaUrl = Convert.ToString(asset["browser_download_url"]); }
            }
            return result.InstallerUrl != null && result.ShaUrl != null ? result : null;
        }

        public static int Compare(string a, string b)
        {
            System.Version va, vb;
            if (!System.Version.TryParse(a, out va) || !System.Version.TryParse(b, out vb)) { return 0; }
            return va.CompareTo(vb);
        }

    }

    // Rounded button filled with the Soma gradient.
    class GradientButton : Control
    {
        public bool Primary = true;
        bool hover;

        public GradientButton()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.SupportsTransparentBackColor | ControlStyles.ResizeRedraw, true);
            Cursor = Cursors.Hand;
            ForeColor = Color.White;
            Font = new Font("Segoe UI Semibold", 11f);
            BackColor = Color.Transparent;
        }

        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnEnabledChanged(EventArgs e) { Cursor = Enabled ? Cursors.Hand : Cursors.Default; Invalidate(); base.OnEnabledChanged(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var rect = new Rectangle(0, 0, Width - 1, Height - 1);
            int r = Height / 2;
            using (var path = new GraphicsPath())
            {
                path.AddArc(rect.X, rect.Y, r * 2, r * 2, 90, 180);
                path.AddArc(rect.Right - r * 2, rect.Y, r * 2, r * 2, 270, 180);
                path.CloseFigure();
                if (Primary)
                {
                    using (var brush = new LinearGradientBrush(rect, Color.Black, Color.Black, LinearGradientMode.Horizontal))
                    {
                        var blend = new ColorBlend();
                        blend.Colors = new[] { Color.FromArgb(0xF4, 0x83, 0x3D), Color.FromArgb(0xE7, 0x0E, 0x77), Color.FromArgb(0x6C, 0x0D, 0xC1) };
                        blend.Positions = new[] { 0f, 0.5f, 1f };
                        brush.InterpolationColors = blend;
                        g.FillPath(brush, path);
                    }
                    if (hover && Enabled) { using (var glow = new SolidBrush(Color.FromArgb(28, 255, 255, 255))) { g.FillPath(glow, path); } }
                    if (!Enabled) { using (var dim = new SolidBrush(Color.FromArgb(140, 10, 10, 10))) { g.FillPath(dim, path); } }
                }
                else
                {
                    using (var fill = new SolidBrush(hover ? Color.FromArgb(0x2A, 0x2A, 0x2A) : Color.FromArgb(0x1C, 0x1C, 0x1C))) { g.FillPath(fill, path); }
                    using (var pen = new Pen(Color.FromArgb(0x3A, 0x3A, 0x3A))) { g.DrawPath(pen, path); }
                }
            }
            TextRenderer.DrawText(g, Text, Font, rect, Enabled ? ForeColor : Color.FromArgb(170, 170, 170), TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);
        }
    }

    class MainForm : Form
    {
        static readonly Color Bg = Color.FromArgb(0x0A, 0x0A, 0x0A);
        static readonly Color Panel = Color.FromArgb(0x15, 0x15, 0x15);
        static readonly Color Muted = Color.FromArgb(0x9A, 0x9A, 0x9A);
        static readonly Color Green = Color.FromArgb(0x52, 0xD9, 0x8B);
        static readonly Color Amber = Color.FromArgb(0xF4, 0x83, 0x3D);
        static readonly Color Pink = Color.FromArgb(0xE7, 0x0E, 0x77);
        static readonly Color Red = Color.FromArgb(0xFF, 0x62, 0x6D);

        static readonly Color Dim = Color.FromArgb(0xB4, 0xB4, 0xB4);

        Label title, subtitle, status;
        FlowLayoutPanel list, aiRow;
        TableLayoutPanel root;
        GradientButton installButton, secondButton;
        LinkLabel uninstallLink, languageLink;
        List<App> apps;
        Dictionary<string, CheckBox> boxes = new Dictionary<string, CheckBox>();
        bool done;

        [System.Runtime.InteropServices.DllImport("dwmapi.dll")]
        static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            int on = 1;
            try { DwmSetWindowAttribute(Handle, 20, ref on, 4); } catch { }
        }

        // Everything is stacked in a table whose rows take each control's real
        // size, so nothing overlaps at 125%/150%/200% display scale or with
        // larger text; long labels wrap to the window width.
        public MainForm()
        {
            SuspendLayout();
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            Text = "Instalar Soma Agente";
            ClientSize = new Size(520, 720);
            MinimumSize = new Size(460, 600);
            FormBorderStyle = FormBorderStyle.Sizable;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Bg;
            ForeColor = Color.White;
            Font = new Font("Segoe UI", 10f);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, Padding = new Padding(32, 22, 32, 14), BackColor = Bg };
            root.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));

            var header = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = new Padding(0, 0, 0, 10), BackColor = Bg };
            header.Controls.Add(new PictureBox { Image = Installer.Picture("mark.png"), SizeMode = PictureBoxSizeMode.Zoom, Size = new Size(52, 52), Margin = new Padding(0, 0, 10, 0) });
            header.Controls.Add(new PictureBox { Image = Installer.Picture("wordmark.png"), SizeMode = PictureBoxSizeMode.Zoom, Size = new Size(140, 52), Margin = new Padding(0) });
            header.Controls.Add(new Label { Text = "Agente", ForeColor = Muted, Font = new Font("Segoe UI", 13f), AutoSize = true, Margin = new Padding(6, 14, 0, 0) });
            languageLink = new LinkLabel { AutoSize = true, LinkColor = Dim, ActiveLinkColor = Pink, VisitedLinkColor = Dim, LinkBehavior = LinkBehavior.HoverUnderline, Margin = new Padding(18, 18, 0, 0) };
            languageLink.LinkClicked += delegate { Lang.En = !Lang.En; ApplyLanguage(); };
            header.Controls.Add(languageLink);

            title = new Label { Font = new Font("Segoe UI Semibold", 15f), AutoSize = true, Margin = new Padding(0, 0, 0, 4) };
            subtitle = new Label { ForeColor = Dim, AutoSize = true, Margin = new Padding(0, 0, 0, 12) };
            list = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoScroll = true, BackColor = Panel, Padding = new Padding(14, 10, 14, 10), Margin = new Padding(0, 0, 0, 10) };
            aiRow = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Top, WrapContents = true, Margin = new Padding(0, 0, 0, 6), BackColor = Bg };
            status = new Label { Text = "", ForeColor = Dim, AutoSize = true, Margin = new Padding(0, 0, 0, 10) };
            installButton = new GradientButton { Dock = DockStyle.Top, Height = 48, Margin = new Padding(0, 0, 0, 8) };
            installButton.Click += delegate { if (done) { Close(); } else { RunInstall(); } };
            secondButton = new GradientButton { Primary = false, Dock = DockStyle.Top, Height = 40, Font = new Font("Segoe UI", 10.5f), Margin = new Padding(0, 0, 0, 4) };
            secondButton.Click += delegate { Close(); };
            uninstallLink = new LinkLabel { AutoSize = true, Anchor = AnchorStyles.Right, LinkColor = Dim, ActiveLinkColor = Pink, VisitedLinkColor = Dim, LinkBehavior = LinkBehavior.HoverUnderline, Visible = false, Margin = new Padding(0) };
            uninstallLink.LinkClicked += delegate { RunUninstall(); };

            foreach (Control c in new Control[] { header, title, subtitle, list, aiRow, status, installButton, secondButton, uninstallLink })
            {
                root.RowStyles.Add(c == list ? new RowStyle(SizeType.Percent, 100f) : new RowStyle(SizeType.AutoSize));
                root.Controls.Add(c);
            }
            Controls.Add(root);
            root.Resize += delegate { FitText(); };
            ResumeLayout(false);
            Shown += delegate { ApplyLanguage(); CheckGitHub(); };
        }

        // Sets every fixed text in the chosen language and rebuilds the program list.
        void ApplyLanguage()
        {
            Text = Lang.T("Instalar Soma Agente", "Install Soma Agente");
            languageLink.Text = Lang.T("English", "Português");
            title.Text = Lang.T("Agente de IA para seus programas", "AI agent for your apps");
            subtitle.Text = Lang.T("Marque onde instalar. Você conversa com o Claude, o ChatGPT ou o Antigravity, e ele trabalha dentro do programa.", "Choose where to install. You chat with Claude, ChatGPT or Antigravity, and it works inside the app.");
            secondButton.Text = Lang.T("Fechar", "Close");
            uninstallLink.Text = Lang.T("Desinstalar", "Uninstall");
            status.Text = "";
            FitText();
            Reload();
        }

        int ContentWidth { get { return Math.Max(100, root.ClientSize.Width - root.Padding.Horizontal); } }

        // Wrapping labels need a maximum width; keep it equal to the window's content width.
        void FitText()
        {
            foreach (Label label in new[] { title, subtitle, status }) { label.MaximumSize = new Size(ContentWidth, 0); }
            foreach (Control row in list.Controls) { row.MaximumSize = new Size(Math.Max(80, list.ClientSize.Width - list.Padding.Horizontal - 4), 0); }
        }

        Label TextLine(string text, Color color, float size)
        {
            return new Label { Text = text, ForeColor = color, AutoSize = true, Font = new Font("Segoe UI", size), Margin = new Padding(0, 4, 0, 4), MaximumSize = new Size(Math.Max(80, list.ClientSize.Width - list.Padding.Horizontal - 4), 0) };
        }

        void AddAi(string name, bool found, string url)
        {
            aiRow.Controls.Add(new Label { Text = name + (found ? " ✓" : " ✗"), ForeColor = found ? Green : Amber, AutoSize = true, Margin = new Padding(0, 2, 6, 2) });
            if (!found)
            {
                var link = new LinkLabel { Text = Lang.T("baixar", "download"), AutoSize = true, LinkColor = Pink, ActiveLinkColor = Amber, LinkBehavior = LinkBehavior.HoverUnderline, Margin = new Padding(0, 2, 16, 2) };
                link.LinkClicked += delegate { Open(url); };
                aiRow.Controls.Add(link);
            }
            else
            {
                aiRow.Controls[aiRow.Controls.Count - 1].Margin = new Padding(0, 2, 16, 2);
            }
        }

        void Reload()
        {
            apps = Detect.All();
            list.SuspendLayout();
            list.Controls.Clear();
            boxes.Clear();
            int rowWidth = Math.Max(80, list.ClientSize.Width - list.Padding.Horizontal - 4);
            foreach (App app in apps)
            {
                // Missing programs stay enabled (so Windows does not paint them
                // dark gray) but cannot be ticked.
                var box = new CheckBox
                {
                    Text = app.Found ? app.Detail + (app.Installed ? Lang.T("  ·  instalado", "  ·  installed") : "") : app.Detail,
                    Checked = app.Found,
                    AutoCheck = app.Found,
                    Cursor = app.Found ? Cursors.Hand : Cursors.Default,
                    AutoSize = true,
                    MaximumSize = new Size(rowWidth, 0),
                    ForeColor = app.Found ? Color.White : Dim,
                    Font = new Font("Segoe UI", 10.5f, app.Found ? FontStyle.Regular : FontStyle.Italic),
                    Margin = new Padding(0, 5, 0, 5)
                };
                list.Controls.Add(box);
                boxes[app.Id] = box;
            }
            list.ResumeLayout();
            bool claude = Detect.Claude(), codex = Detect.Codex();
            bool agy = Detect.Agy();
            aiRow.Controls.Clear();
            aiRow.Controls.Add(new Label { Text = Lang.T("IA:", "AI:"), ForeColor = Dim, AutoSize = true, Margin = new Padding(0, 2, 8, 2) });
            AddAi("Claude Code", claude, "https://code.claude.com/docs/en/setup");
            AddAi("ChatGPT", codex, "https://chatgpt.com/codex");
            AddAi("Antigravity CLI", agy, "https://antigravity.google/docs/getting-started");
            if (!claude || !agy)
            {
                // The chat apps alone are not enough; the Soma panel installs the CLIs with one click.
                status.ForeColor = Amber;
                status.Text = Lang.T("O Soma usa o Claude Code e a CLI do Antigravity, que não vêm com os apps de chat. Depois de instalar o Soma, clique em Instalar dentro do painel (o Claude Code precisa do plano Pro ou Max).",
                    "Soma uses Claude Code and the Antigravity CLI, which do not come with the chat apps. After installing Soma, click Install inside the panel (Claude Code needs a Pro or Max plan).");
            }
            if (!claude && !codex && !agy) { status.ForeColor = Amber; status.Text = Lang.T("Instale pelo menos uma IA (Claude Code, Codex do ChatGPT ou CLI do Antigravity) para o agente funcionar. Dá para instalar depois, pelo botão Instalar no painel do Soma.", "Install at least one AI (Claude Code, ChatGPT Codex or the Antigravity CLI) for the agent to work. You can also install it later with the Install button in the Soma panel."); }
            FitText();
            uninstallLink.Visible = apps.Any(a => a.Installed);
            if (!done) { installButton.Text = apps.Any(a => a.Installed) ? Lang.T("Instalar / atualizar para ", "Install / update to ") + Paths.Version : Lang.T("Instalar", "Install"); }
        }

        List<App> Selected()
        {
            return apps.Where(a => a.Found && boxes.ContainsKey(a.Id) && boxes[a.Id].Checked).ToList();
        }

        void RunInstall()
        {
            List<App> chosen = Selected();
            if (!chosen.Any()) { status.ForeColor = Amber; status.Text = Lang.T("Marque pelo menos um programa.", "Select at least one app."); return; }
            var open = chosen.Where(a => a.Adobe && Detect.Running(a)).Select(a => a.Label).ToList();
            if (open.Any())
            {
                status.ForeColor = Amber;
                status.Text = Lang.T("Feche ", "Close ") + string.Join(", ", open) + Lang.T(" (salve antes) e clique em Instalar de novo.", " (save first) and click Install again.");
                return;
            }
            installButton.Enabled = false;
            secondButton.Enabled = false;
            uninstallLink.Visible = false;
            foreach (CheckBox b in boxes.Values) { b.AutoCheck = false; }
            status.ForeColor = Muted;
            Exception failure = null;
            var worker = new Thread(delegate ()
            {
                try { Installer.Install(chosen, delegate (string s) { BeginInvoke((Action)delegate { status.Text = s; }); }); }
                catch (Exception ex) { failure = ex; }
                BeginInvoke((Action)delegate { Finish(chosen, failure); });
            });
            worker.IsBackground = true;
            worker.Start();
        }

        void Finish(List<App> chosen, Exception failure)
        {
            installButton.Enabled = true;
            secondButton.Enabled = true;
            if (failure != null)
            {
                Reload();
                status.ForeColor = Red;
                status.Text = Lang.T("Não deu para instalar: ", "Could not install: ") + failure.Message;
                installButton.Text = Lang.T("Tentar de novo", "Try again");
                return;
            }
            done = true;
            title.Text = Lang.T("Pronto! Soma Agente instalado.", "Done! Soma Agente is installed.");
            subtitle.Text = Lang.T("Reabra os programas. Na primeira vez, escolha a IA e conecte sua conta.", "Reopen the apps. The first time, pick the AI and connect your account.");
            var lines = new List<string>();
            foreach (App app in chosen)
            {
                if (app.Adobe) { lines.Add(app.Label + ": Window > Extensions > Soma Agente"); }
                else if (app.Id == "blender") { lines.Add(Lang.T("Blender: 3D View > barra lateral (tecla N) > aba Soma", "Blender: 3D View > sidebar (N key) > Soma tab")); }
                else if (app.Id == "cinema4d") { lines.Add(Lang.T("Cinema 4D: menu Extensions > Soma Agente", "Cinema 4D: Extensions menu > Soma Agente")); }
                else if (app.Id == "figma") { lines.Add(Lang.T("Figma: Plugins > Development > Import plugin from manifest… (caminho copiado)", "Figma: Plugins > Development > Import plugin from manifest… (path copied)")); }
                else if (app.Id == "cavalry") { lines.Add(Lang.T("Cavalry: menu Scripts > Soma Agente", "Cavalry: Scripts menu > Soma Agente")); }
                else if (app.Id == "antigravity") { lines.Add(Lang.T("Antigravity: o servidor \"soma\" já está nas MCP Servers. Com os programas abertos, peça por exemplo \"use o soma para listar os apps\".", "Antigravity: the \"soma\" server is already in MCP Servers. With the apps open, ask for example \"use soma to list the apps\".")); }
            }
            list.Controls.Clear();
            foreach (string line in lines) { list.Controls.Add(TextLine(line, Color.White, 10.5f)); }
            if (chosen.Any(a => a.Id == "figma"))
            {
                try { Clipboard.SetText(Paths.FigmaManifest); } catch { }
                var copy = new GradientButton { Text = Lang.T("Copiar caminho do manifest do Figma", "Copy the Figma manifest path"), Primary = false, Size = new Size(Math.Max(120, list.ClientSize.Width - list.Padding.Horizontal - 4), 36), Font = new Font("Segoe UI", 10f), Margin = new Padding(0, 8, 0, 4) };
                copy.Click += delegate { try { Clipboard.SetText(Paths.FigmaManifest); status.Text = Lang.T("Copiado: ", "Copied: ") + Paths.FigmaManifest; } catch { } };
                list.Controls.Add(copy);
                var folder = new LinkLabel { Text = Lang.T("Abrir a pasta do plugin do Figma", "Open the Figma plugin folder"), AutoSize = true, LinkColor = Pink, ActiveLinkColor = Amber, Margin = new Padding(0, 4, 0, 4) };
                folder.LinkClicked += delegate { Open(Path.GetDirectoryName(Paths.FigmaManifest)); };
                list.Controls.Add(folder);
            }
            FitText();
            status.ForeColor = Green;
            status.Text = Lang.T("Versões anteriores foram guardadas em pastas de backup.", "Previous versions were kept in backup folders.");
            installButton.Text = Lang.T("Concluir", "Finish");
            secondButton.Text = Lang.T("Fechar", "Close");
            uninstallLink.Visible = true;
        }

        void RunUninstall()
        {
            if (MessageBox.Show(this, Lang.T("Remover o Soma Agente de todos os programas?\n\nOs arquivos vão para pastas de backup (nada é apagado) e suas configurações ficam guardadas.", "Remove Soma Agente from every app?\n\nThe files go to backup folders (nothing is deleted) and your settings are kept."), Lang.T("Desinstalar Soma Agente", "Uninstall Soma Agente"), MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) { return; }
            var open = Detect.All().Where(a => a.Adobe && a.Installed && Detect.Running(a)).Select(a => a.Label).ToList();
            if (open.Any()) { status.ForeColor = Amber; status.Text = Lang.T("Feche ", "Close ") + string.Join(", ", open) + Lang.T(" antes de desinstalar.", " before uninstalling."); return; }
            try
            {
                Installer.Uninstall(Detect.All());
                done = false;
                title.Text = Lang.T("Soma Agente removido.", "Soma Agente removed.");
                status.ForeColor = Muted;
                status.Text = Lang.T("Você pode instalar de novo quando quiser.", "You can install it again any time.");
                Reload();
            }
            catch (Exception ex)
            {
                status.ForeColor = Red;
                status.Text = Lang.T("Não deu para desinstalar: ", "Could not uninstall: ") + ex.Message;
            }
        }

        // When a newer version is published on GitHub, offers its download page.
        // The installer itself never downloads and runs another program; the
        // Soma Hub keeps installed copies up to date.
        void CheckGitHub()
        {
            if (Program.NoSelfUpdate) { return; }
            var worker = new Thread(delegate ()
            {
                try
                {
                    GitHubRelease latest = GitHubRelease.Latest();
                    if (latest == null || GitHubRelease.Compare(latest.Version, Paths.Version) <= 0) { return; }
                    BeginInvoke((Action)delegate
                    {
                        status.ForeColor = Amber;
                        status.Text = Lang.T("A versão ", "Version ") + latest.Version + Lang.T(" já está no GitHub.", " is on GitHub.");
                        if (MessageBox.Show(this, Lang.T("Existe uma versão mais nova do Soma Agente (", "A newer Soma Agente is available (") + latest.Version + Lang.T(").\n\nAbrir a página de download no GitHub?", ").\n\nOpen the download page on GitHub?"), "Soma Agente", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                        {
                            Open(latest.PageUrl);
                            Close();
                        }
                    });
                }
                catch { }
            });
            worker.IsBackground = true;
            worker.Start();
        }

        static void Open(string target)
        {
            try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true }); } catch { }
        }
    }

    static class Program
    {
        static void Log(string text)
        {
            try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "soma-agente-install.log"), DateTime.Now.ToString("s") + " " + text + Environment.NewLine); } catch { }
        }

        static void ScaleFonts(Control control, float scale)
        {
            // Read every font first: children inherit the parent's, so scaling in
            // place would enlarge inherited fonts twice.
            var all = new List<KeyValuePair<Control, Font>>();
            var pending = new Stack<Control>();
            pending.Push(control);
            while (pending.Count > 0)
            {
                Control c = pending.Pop();
                all.Add(new KeyValuePair<Control, Font>(c, c.Font));
                foreach (Control child in c.Controls) { pending.Push(child); }
            }
            foreach (var entry in all) { entry.Key.Font = new Font(entry.Value.FontFamily, entry.Value.Size * scale, entry.Value.Style); }
        }

        // Set when started by an older installer that already fetched this one from GitHub.
        public static bool NoSelfUpdate;

        [STAThread]
        static int Main(string[] args)
        {
            NoSelfUpdate = args.Any(a => a.Equals("/no-self-update", StringComparison.OrdinalIgnoreCase)) || Environment.GetEnvironmentVariable("SOMA_NO_SELF_UPDATE") == "1";
            // /silent [/apps=aftereffects,blender,...] installs without the window; /uninstall removes.
            try
            {
                if (args.Any(a => a.Equals("/uninstall", StringComparison.OrdinalIgnoreCase)))
                {
                    Installer.Uninstall(Detect.All());
                    return 0;
                }
                if (args.Any(a => a.Equals("/silent", StringComparison.OrdinalIgnoreCase)))
                {
                    string filter = args.Where(a => a.StartsWith("/apps=", StringComparison.OrdinalIgnoreCase)).Select(a => a.Substring(6)).FirstOrDefault();
                    var wanted = filter == null ? null : filter.Split(',');
                    // /update (used by the Soma Hub auto-update) refreshes only what is already installed.
                    bool update = args.Any(a => a.Equals("/update", StringComparison.OrdinalIgnoreCase));
                    var chosen = Detect.All().Where(a => a.Found && (update ? a.Installed : (wanted == null || wanted.Contains(a.Id)))).ToList();
                    if (chosen.Any(a => a.Adobe && Detect.Running(a))) { Log("Close the Adobe programs first."); return 2; }
                    Installer.Install(chosen, delegate (string s) { Log(s); });
                    return 0;
                }
            }
            catch (Exception ex) { Log(ex.ToString()); return 1; }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var form = new MainForm();
            // SOMA_UI_SCALE emulates a larger display scale (fonts and sizes) for layout testing.
            float scale;
            if (float.TryParse(Environment.GetEnvironmentVariable("SOMA_UI_SCALE") ?? "", System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out scale) && scale > 1f)
            {
                ScaleFonts(form, scale);
                form.Scale(new SizeF(scale, scale));
            }
            Application.Run(form);
            return 0;
        }
    }
}
