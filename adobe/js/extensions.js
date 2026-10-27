// Skills and connectors shared by every Soma program (same files and rules as
// python/soma_core/extensions.py). Skills are SKILL.md folders; connectors are
// MCP servers. Connectors added by the agent and skills downloaded from a URL
// stay pending until the user approves them.
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SomaExtensions = api;
}(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  function Extensions(n, dataDir) {
    this.n = n;
    this.dataDir = dataDir;
  }

  function slugify(name) {
    var slug = String(name || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!slug) { throw new Error("Give the skill or connector a name (letters, numbers, dashes)."); }
    return slug.slice(0, 60);
  }

  function parseSkill(text) {
    var meta = {}, body = text;
    var match = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(String(text).replace(/\r\n/g, "\n"));
    if (match) {
      body = match[2];
      var key = null;
      match[1].split("\n").forEach(function (line) {
        // Indented lines continue a block value (description: > or |).
        if (key && /^\s+\S/.test(line)) { meta[key] = (meta[key] ? meta[key] + " " : "") + line.trim(); return; }
        key = null;
        var i = line.indexOf(":");
        if (i > 0) {
          var name = line.slice(0, i).trim().toLowerCase();
          var value = line.slice(i + 1).trim();
          if (/^[>|][-+]?$/.test(value)) { key = name; meta[name] = ""; return; }
          meta[name] = value.replace(/^["']|["']$/g, "");
        }
      });
    }
    return { meta: meta, body: body };
  }

  Extensions.prototype.skillsDir = function () {
    var dir = this.n.path.join(this.dataDir, "skills");
    this.n.fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  Extensions.prototype.listSkills = function () {
    var self = this, fs = this.n.fs, path = this.n.path, root = this.skillsDir();
    return fs.readdirSync(root).sort().map(function (slug) {
      var file = path.join(root, slug, "SKILL.md");
      if (!fs.existsSync(file)) { return null; }
      var meta = parseSkill(fs.readFileSync(file, "utf8")).meta;
      var state = fs.existsSync(path.join(root, slug, ".pending")) ? "pending" : (fs.existsSync(path.join(root, slug, ".disabled")) ? "disabled" : "enabled");
      return { name: slug, title: meta.name || slug, description: meta.description || "", state: state };
    }).filter(Boolean);
  };

  Extensions.prototype.mark = function (folder, state) {
    var fs = this.n.fs, path = this.n.path;
    [".pending", ".disabled"].forEach(function (flag) { try { fs.unlinkSync(path.join(folder, flag)); } catch (e) { /* absent */ } });
    if (state === "pending" || state === "disabled") { fs.writeFileSync(path.join(folder, "." + state), ""); }
  };

  Extensions.prototype.readSkill = function (name) {
    var fs = this.n.fs, path = this.n.path, slug = slugify(name), folder = path.join(this.skillsDir(), slug);
    var file = path.join(folder, "SKILL.md");
    if (!fs.existsSync(file)) { throw new Error("Skill " + name + " not found. Use soma_list_skills."); }
    if (fs.existsSync(path.join(folder, ".pending"))) { throw new Error("Skill " + slug + " is waiting for the user's approval in the Soma panel."); }
    var files = [];
    (function walk(dir) {
      fs.readdirSync(dir).forEach(function (entry) {
        var full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) { walk(full); } else if (["SKILL.md", ".pending", ".disabled"].indexOf(entry) < 0) { files.push(path.relative(folder, full)); }
      });
    }(folder));
    return { name: slug, folder: folder, skill: fs.readFileSync(file, "utf8"), files: files.slice(0, 100) };
  };

  Extensions.prototype.writeSkill = function (name, description, instructions, state) {
    var path = this.n.path, slug = slugify(name), folder = path.join(this.skillsDir(), slug);
    this.n.fs.mkdirSync(folder, { recursive: true });
    var text = "---\nname: " + name + "\ndescription: " + String(description || "").replace(/\n/g, " ") + "\n---\n\n" + String(instructions || "").trim() + "\n";
    this.n.fs.writeFileSync(path.join(folder, "SKILL.md"), text, "utf8");
    this.mark(folder, state || "enabled");
    return { name: slug, state: state || "enabled", folder: folder };
  };

  // A SKILL.md the user picked from disk: copied with its folder's files.
  Extensions.prototype.importSkillFile = function (file) {
    var fs = this.n.fs, path = this.n.path;
    var meta = parseSkill(fs.readFileSync(file, "utf8")).meta;
    var slug = slugify(meta.name || path.basename(path.dirname(file)));
    var folder = path.join(this.skillsDir(), slug);
    (function copy(from, to) {
      fs.mkdirSync(to, { recursive: true });
      fs.readdirSync(from).forEach(function (entry) {
        var source = path.join(from, entry), target = path.join(to, entry);
        if (fs.statSync(source).isDirectory()) { copy(source, target); } else { fs.copyFileSync(source, target); }
      });
    }(path.dirname(file), folder));
    this.mark(folder, "enabled");
    return slug;
  };

  Extensions.prototype.setSkillState = function (name, state) {
    var folder = this.n.path.join(this.skillsDir(), slugify(name));
    if (!this.n.fs.existsSync(folder)) { throw new Error("Skill " + name + " not found."); }
    this.mark(folder, state);
  };

  Extensions.prototype.deleteSkill = function (name) {
    var folder = this.n.path.join(this.skillsDir(), slugify(name));
    if (this.n.fs.existsSync(folder)) { this.n.fs.rmSync(folder, { recursive: true, force: true }); }
    return { deleted: slugify(name) };
  };

  Extensions.prototype.get = function (url, accept) {
    var https = this.n.https, NodeBuffer = this.n.Buffer;
    return new Promise(function (resolve, reject) {
      (function fetch(target, hops) {
        https.get(target, { headers: { "User-Agent": "SomaAgente", Accept: accept || "application/vnd.github+json" } }, function (res) {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 5) { res.resume(); fetch(res.headers.location, hops + 1); return; }
          if (res.statusCode !== 200) { res.resume(); reject(new Error("HTTP " + res.statusCode + " for " + target)); return; }
          var chunks = [];
          res.on("data", function (c) { chunks.push(c); });
          res.on("end", function () { resolve(NodeBuffer.concat(chunks)); });
        }).on("error", reject);
      }(url, 0));
    });
  };

  // A raw SKILL.md URL or a GitHub folder (github.com/<owner>/<repo>/tree/<ref>/<path>). Pending until approved.
  Extensions.prototype.installSkillFromUrl = function (url) {
    var self = this, fs = this.n.fs, path = this.n.path;
    var match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+?)\/?$/.exec(url);
    var done;
    if (match) {
      var slug = slugify(match[4].split("/").pop());
      var folder = path.join(this.skillsDir(), slug);
      var fetchDir = function (sub, target) {
        fs.mkdirSync(target, { recursive: true });
        var api = "https://api.github.com/repos/" + match[1] + "/" + match[2] + "/contents/" + encodeURI(sub) + "?ref=" + encodeURIComponent(match[3]);
        return self.get(api).then(function (body) {
          return JSON.parse(body.toString("utf8")).reduce(function (chain, item) {
            return chain.then(function () {
              var destination = path.join(target, item.name);
              if (item.type === "dir") { return fetchDir(item.path, destination); }
              if (item.type === "file" && item.size < 5000000) { return self.get(item.download_url, "application/octet-stream").then(function (data) { fs.writeFileSync(destination, data); }); }
            });
          }, Promise.resolve());
        });
      };
      done = fetchDir(match[4], folder).then(function () { return { slug: slug, folder: folder }; });
    } else {
      var raw = url.replace("https://github.com/", "https://raw.githubusercontent.com/").replace("/blob/", "/");
      done = this.get(raw, "text/plain").then(function (data) {
        var text = data.toString("utf8");
        var meta = parseSkill(text).meta;
        var slug2 = slugify(meta.name || path.basename(raw).replace(/\.md$/i, ""));
        var folder2 = path.join(self.skillsDir(), slug2);
        fs.mkdirSync(folder2, { recursive: true });
        fs.writeFileSync(path.join(folder2, "SKILL.md"), text, "utf8");
        return { slug: slug2, folder: folder2 };
      });
    }
    return done.then(function (result) {
      if (!fs.existsSync(path.join(result.folder, "SKILL.md"))) {
        fs.rmSync(result.folder, { recursive: true, force: true });
        throw new Error("No SKILL.md found at " + url + ".");
      }
      self.mark(result.folder, "pending");
      return { name: result.slug, state: "pending", note: "Downloaded skills need the user's approval in the Soma panel before use." };
    });
  };

  // ---------------------------------------------------------------- connectors
  Extensions.prototype.connectorsFile = function () { return this.n.path.join(this.dataDir, "connectors.json"); };

  Extensions.prototype.loadConnectors = function () {
    try {
      var data = JSON.parse(this.n.fs.readFileSync(this.connectorsFile(), "utf8"));
      return data && data.connectors ? data.connectors : {};
    } catch (error) { return {}; }
  };

  Extensions.prototype.saveConnectors = function (connectors) {
    this.n.fs.writeFileSync(this.connectorsFile(), JSON.stringify({ connectors: connectors }, null, 2), "utf8");
  };

  Extensions.prototype.addConnector = function (spec, addedBy) {
    var name = slugify(spec.name);
    if (!spec.command && !spec.url) { throw new Error("A connector needs a command (stdio MCP server) or a url (HTTP MCP server)."); }
    var entry = { description: String(spec.description || ""), addedBy: addedBy || "agent", state: addedBy === "user" ? "enabled" : "pending" };
    if (spec.url) { entry.url = String(spec.url); entry.headers = spec.headers || {}; } else { entry.command = String(spec.command); entry.args = (spec.args || []).map(String); entry.env = spec.env || {}; }
    var connectors = this.loadConnectors();
    connectors[name] = entry;
    this.saveConnectors(connectors);
    return { name: name, state: entry.state };
  };

  Extensions.prototype.setConnectorState = function (name, state) {
    var connectors = this.loadConnectors();
    if (!connectors[name]) { throw new Error("Connector " + name + " not found."); }
    connectors[name].state = state;
    this.saveConnectors(connectors);
  };

  Extensions.prototype.removeConnector = function (name) {
    var connectors = this.loadConnectors();
    delete connectors[slugify(name)];
    this.saveConnectors(connectors);
    return { removed: slugify(name) };
  };

  Extensions.prototype.activeConnectors = function () {
    var all = this.loadConnectors(), active = {};
    Object.keys(all).forEach(function (name) { if (all[name].state === "enabled") { active[name] = all[name]; } });
    return active;
  };

  Extensions.prototype.pending = function () {
    var connectors = this.loadConnectors();
    var items = Object.keys(connectors).filter(function (n) { return connectors[n].state === "pending"; }).map(function (n) {
      var c = connectors[n];
      return { kind: "connector", name: n, detail: c.url || [c.command].concat(c.args || []).join(" "), description: c.description || "" };
    });
    return items.concat(this.listSkills().filter(function (s) { return s.state === "pending"; }).map(function (s) {
      return { kind: "skill", name: s.name, detail: s.description, description: s.title };
    }));
  };

  Extensions.prototype.approve = function (kind, name, accept) {
    if (kind === "connector") { if (accept) { this.setConnectorState(name, "enabled"); } else { this.removeConnector(name); } }
    else if (accept) { this.setSkillState(name, "enabled"); } else { this.deleteSkill(name); }
  };

  // ------------------------------------------------------------- agent side
  Extensions.prototype.instructions = function () {
    var skills = this.listSkills().filter(function (s) { return s.state === "enabled"; });
    var connectors = this.activeConnectors();
    var lines = ["Skills and connectors: you can extend yourself. soma_create_skill saves reusable know-how the user asks you to remember (a workflow, a style guide); soma_install_skill downloads a SKILL.md or a GitHub skill folder; soma_add_connector registers an MCP server (stdio command or HTTP URL). Downloaded skills and new connectors only work after the user approves them in the Soma panel, so tell the user to approve them; connectors become available from the next message."];
    if (skills.length) { lines.push("Available skills (call soma_read_skill before using one whose description matches the request): " + skills.map(function (s) { return s.name + " — " + (s.description || s.title); }).join("; ") + "."); }
    var names = Object.keys(connectors);
    if (names.length) { lines.push("Connected MCP servers you can use alongside the program's tools: " + names.map(function (n) { return n + (connectors[n].description ? " (" + connectors[n].description + ")" : ""); }).join(", ") + "."); }
    return " " + lines.join(" ");
  };

  var str = { type: "string" };
  var empty = { type: "object", properties: {}, additionalProperties: false };
  function byName(extra) { return { type: "object", properties: { name: str }, required: ["name"], additionalProperties: false }; }
  Extensions.TOOLS = [
    { name: "soma_list_skills", description: "List the Soma skills (reusable instructions) with their state.", inputSchema: empty },
    { name: "soma_read_skill", description: "Read a skill's SKILL.md (and list its extra files) before following it.", inputSchema: byName() },
    { name: "soma_create_skill", description: "Create or update a skill from instructions you write (what to do, steps, preferences). Ready immediately, in every Soma program.", inputSchema: { type: "object", properties: { name: str, description: { type: "string", description: "When to use it, one sentence." }, instructions: { type: "string", description: "Markdown instructions." } }, required: ["name", "description", "instructions"], additionalProperties: false } },
    { name: "soma_install_skill", description: "Download a skill from a URL: a SKILL.md file or a GitHub folder (github.com/<owner>/<repo>/tree/<branch>/<path>). Waits for the user's approval.", inputSchema: { type: "object", properties: { url: str }, required: ["url"], additionalProperties: false } },
    { name: "soma_delete_skill", description: "Delete a skill.", inputSchema: byName() },
    { name: "soma_list_connectors", description: "List the MCP connectors and their state (enabled, pending approval, disabled).", inputSchema: empty },
    { name: "soma_add_connector", description: "Register an MCP server as a connector: either command + args (+ env) for a stdio server, or url (+ headers) for an HTTP server. The user must approve it in the Soma panel; it is usable from the next message.", inputSchema: { type: "object", properties: { name: str, description: str, command: str, args: { type: "array", items: str }, env: { type: "object", additionalProperties: str }, url: str, headers: { type: "object", additionalProperties: str } }, required: ["name"], additionalProperties: false } },
    { name: "soma_remove_connector", description: "Remove a connector.", inputSchema: byName() }
  ];

  Extensions.prototype.call = function (name, args) {
    var self = this;
    return Promise.resolve().then(function () {
      switch (name) {
        case "soma_list_skills": return { skills: self.listSkills() };
        case "soma_read_skill": return self.readSkill(args.name);
        case "soma_create_skill": return self.writeSkill(args.name, args.description, args.instructions, "enabled");
        case "soma_install_skill": return self.installSkillFromUrl(String(args.url || ""));
        case "soma_delete_skill": return self.deleteSkill(args.name);
        case "soma_list_connectors":
          var all = self.loadConnectors();
          return { connectors: Object.keys(all).map(function (n) { var c = all[n]; return { name: n, state: c.state, description: c.description, command: c.command, args: c.args, url: c.url, env: Object.keys(c.env || {}), headers: Object.keys(c.headers || {}) }; }) };
        case "soma_add_connector":
          var added = self.addConnector(args, "agent");
          added.note = "Ask the user to approve the connector in the Soma panel; it works from the next message.";
          return added;
        case "soma_remove_connector": return self.removeConnector(args.name);
        default: throw new Error("Unknown tool " + name);
      }
    }).then(function (data) { return { ok: true, data: data }; }, function (error) { return { ok: false, error: error.message }; });
  };

  // ------------------------------------------------------- provider configs
  Extensions.prototype.claudeServers = function () {
    var active = this.activeConnectors(), servers = {};
    Object.keys(active).forEach(function (n) {
      var c = active[n];
      servers[n] = c.url ? { type: "http", url: c.url, headers: c.headers || {} } : { command: c.command, args: c.args || [], env: c.env || {} };
    });
    return servers;
  };

  Extensions.prototype.codexOverrides = function () {
    var active = this.activeConnectors(), args = [];
    function table(obj) { return "{" + Object.keys(obj).map(function (k) { return JSON.stringify(k) + " = " + JSON.stringify(String(obj[k])); }).join(", ") + "}"; }
    Object.keys(active).forEach(function (n) {
      var c = active[n], key = "mcp_servers." + n;
      if (c.url) {
        args.push("-c", key + ".url=" + JSON.stringify(c.url));
        if (c.headers && Object.keys(c.headers).length) { args.push("-c", key + ".http_headers=" + table(c.headers)); }
      } else {
        args.push("-c", key + ".command=" + JSON.stringify(c.command), "-c", key + ".args=" + JSON.stringify(c.args || []));
        if (c.env && Object.keys(c.env).length) { args.push("-c", key + ".env=" + table(c.env)); }
      }
      args.push("-c", key + ".default_tools_approval_mode=\"approve\"");
    });
    return args;
  };

  // Antigravity reads one global config: soma-<name> per enabled connector, allowed for headless agy.
  Extensions.prototype.syncAntigravity = function () {
    var n = this.n, active = this.activeConnectors(), wanted = {};
    Object.keys(active).forEach(function (name) {
      var c = active[name];
      wanted["soma-" + name] = c.url ? { serverUrl: c.url, headers: c.headers || {} } : { command: c.command, args: c.args || [], env: c.env || {} };
    });
    var gemini = n.path.join(n.os.homedir(), ".gemini");
    function read(file) { try { var t = n.fs.readFileSync(file, "utf8").trim(); return t ? JSON.parse(t) : {}; } catch (e) { return null; } }
    [n.path.join(gemini, "config", "mcp_config.json"), n.path.join(gemini, "antigravity", "mcp_config.json")].forEach(function (file) {
      if (!n.fs.existsSync(file)) { return; }
      var config = read(file);
      if (!config) { return; }
      var servers = config.mcpServers = config.mcpServers || {};
      Object.keys(servers).filter(function (k) { return k.indexOf("soma-") === 0; }).forEach(function (k) { delete servers[k]; });
      Object.keys(wanted).forEach(function (k) { servers[k] = wanted[k]; });
      n.fs.writeFileSync(file, JSON.stringify(config, null, 2), "utf8");
    });
    var settingsFile = n.path.join(gemini, "antigravity-cli", "settings.json");
    var settings = read(settingsFile);
    if (!settings) { return; }
    settings.permissions = settings.permissions || {};
    var allow = (settings.permissions.allow || []).filter(function (r) { return r.indexOf("mcp(soma-") !== 0; });
    settings.permissions.allow = allow.concat(Object.keys(wanted).map(function (k) { return "mcp(" + k + "/*)"; }));
    n.fs.mkdirSync(n.path.dirname(settingsFile), { recursive: true });
    n.fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), "utf8");
  };

  return { Extensions: Extensions, slugify: slugify, parseSkill: parseSkill };
}));
