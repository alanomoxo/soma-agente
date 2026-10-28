(function () {
  "use strict";

  var HOST = window.SomaHosts.current();

  var elements = {
    accountButton: document.getElementById("accountButton"),
    accountLabel: document.getElementById("accountLabel"),
    accountDot: document.getElementById("accountDot"),
    openaiDiagnosticSummary: document.getElementById("openaiDiagnosticSummary"),
    claudeDiagnosticSummary: document.getElementById("claudeDiagnosticSummary"),
    claudeConnectButton: document.getElementById("claudeConnectButton"),
    claudeConnectLabel: document.getElementById("claudeConnectLabel"),
    claudeDot: document.getElementById("claudeDot"),
    diagnosticTimestamp: document.getElementById("diagnosticTimestamp"),
    diagnosticMessage: document.getElementById("diagnosticMessage"),
    runDiagnostics: document.getElementById("runDiagnostics"),
    copyDiagnostics: document.getElementById("copyDiagnostics"),
    undoButton: document.getElementById("undoButton"),
    editModeButton: document.getElementById("editModeButton"),
    toolModeButton: document.getElementById("toolModeButton"),
    toolPhaseBar: document.getElementById("toolPhaseBar"),
    planToolButton: document.getElementById("planToolButton"),
    buildToolButton: document.getElementById("buildToolButton"),
    showDraftButton: document.getElementById("showDraftButton"),
    createToolButton: document.getElementById("createToolButton"),
    settingsButton: document.getElementById("settingsButton"),
    settingsPopover: document.getElementById("settingsPopover"),
    closeSettings: document.getElementById("closeSettings"),
    persistentInstructions: document.getElementById("persistentInstructions"),
    saveInstructions: document.getElementById("saveInstructions"),
    instructionsStatus: document.getElementById("instructionsStatus"),
    toolStoragePath: document.getElementById("toolStoragePath"),
    settingsToolList: document.getElementById("settingsToolList"),
    openToolsFolder: document.getElementById("openToolsFolder"),
    openExportsFolder: document.getElementById("openExportsFolder"),
    dockPosition: document.getElementById("dockPosition"),
    dockSize: document.getElementById("dockSize"),
    dockLabels: document.getElementById("dockLabels"),
    accentInput: document.getElementById("accentInput"),
    resetAccentButton: document.getElementById("resetAccentButton"),
    systemBanner: document.getElementById("systemBanner"),
    progressPanel: document.getElementById("progressPanel"),
    progressTitle: document.getElementById("progressTitle"),
    progressDetail: document.getElementById("progressDetail"),
    progressBar: document.getElementById("progressBar"),
    conversation: document.getElementById("conversation"),
    promptInput: document.getElementById("promptInput"),
    attachButton: document.getElementById("attachButton"),
    imageInput: document.getElementById("imageInput"),
    micButton: document.getElementById("micButton"),
    recordingTimer: document.getElementById("recordingTimer"),
    modelButton: document.getElementById("modelButton"),
    modelLabel: document.getElementById("modelLabel"),
    effortLabel: document.getElementById("effortLabel"),
    modelPopover: document.getElementById("modelPopover"),
    modelList: document.getElementById("modelList"),
    effortSection: document.getElementById("effortSection"),
    effortList: document.getElementById("effortList"),
    sendButton: document.getElementById("sendButton"),
    attachmentTray: document.getElementById("attachmentTray"),
    connectionLabel: document.getElementById("connectionLabel"),
    referencesButton: document.getElementById("referencesButton"),
    referencesPopover: document.getElementById("referencesPopover"),
    referenceList: document.getElementById("referenceList"),
    addReferenceButton: document.getElementById("addReferenceButton"),
    referenceInput: document.getElementById("referenceInput"),
    sttEngine: document.getElementById("sttEngine"),
    sttLanguage: document.getElementById("sttLanguage"),
    sttModel: document.getElementById("sttModel"),
    sttLocalSection: document.getElementById("sttLocalSection"),
    sttApiSection: document.getElementById("sttApiSection"),
    sttApiKey: document.getElementById("sttApiKey"),
    whisperStatus: document.getElementById("whisperStatus"),
    installWhisper: document.getElementById("installWhisper"),
    modelStatus: document.getElementById("modelStatus"),
    downloadModel: document.getElementById("downloadModel"),
    voiceAutoSend: document.getElementById("voiceAutoSend"),
    ffmpegStatus: document.getElementById("ffmpegStatus"),
    installFfmpeg: document.getElementById("installFfmpeg"),
    videoFrames: document.getElementById("videoFrames"),
    videoTranscribe: document.getElementById("videoTranscribe"),
    mediaProgress: document.getElementById("mediaProgress"),
    mediaProgressLabel: document.getElementById("mediaProgressLabel"),
    mediaProgressPercent: document.getElementById("mediaProgressPercent"),
    mediaProgressBar: document.getElementById("mediaProgressBar"),
    checkMedia: document.getElementById("checkMedia"),
    openMediaFolder: document.getElementById("openMediaFolder")
  };

  var L = window.SomaI18n.L;
  window.SomaI18n.start();
  applyHostProfile();
  var welcomeMarkup = elements.conversation.innerHTML;
  var attachments = [];
  var outgoingTempFiles = [];
  var activeAssistantMessages = {};
  var activeToolEvents = {};
  var mediaRecorder = null;
  var mediaStream = null;
  var recordedChunks = [];
  var recordingStartedAt = 0;
  var recordingTicker = null;
  var transcribing = false;
  var waitingForAttachments = false;
  var chatTempFiles = [];
  var skippedPins = {};
  var attachmentCounter = 0;
  var mediaBusy = false;
  var isBusy = false;
  var activeRun = null;
  var toolQueue = Promise.resolve();
  var pendingToolCalls = 0;
  var pendingCompletion = null;
  var chatMode = "edit";
  var toolPhase = "plan";
  var latestToolDraft = null;
  var library = null;
  var dock = null;
  var libraryError = null;
  var libraryBackupPath = null;
  var libraryDirectory = null;
  var exportDirectory = null;
  var completedToolCount = 0;
  var currentTurnMutations = 0;
  var lastTurnMutations = 0;
  var progressResetTimer = null;
  var defaultAccent = "#e70e77";
  var connectionDiagnostics = { claude: "Not checked" };

  // Welcome copy, suggestions and host-only controls come from the profile.
  function applyHostProfile() {
    var eyebrow = document.querySelector(".brand .eyebrow");
    if (eyebrow) { eyebrow.textContent = HOST.name + " copilot"; }
    var welcome = document.querySelector(".welcome-message > p");
    if (welcome && HOST.welcome) { welcome.textContent = HOST.welcome; }
    var list = document.querySelector(".welcome-message .suggestions");
    if (list && HOST.suggestions) {
      list.innerHTML = "";
      HOST.suggestions.forEach(function (text) {
        var button = document.createElement("button");
        button.className = "suggestion";
        button.type = "button";
        button.textContent = text;
        list.appendChild(button);
      });
    }
    var features = HOST.features || {};
    document.getElementById("easeButton").hidden = !features.eases;
    elements.undoButton.hidden = !features.undo;
    document.title = "Soma Agente · " + HOST.name;
  }

  function getNodeRequire() {
    if (window.cep_node && typeof window.cep_node.require === "function") {
      return window.cep_node.require;
    }
    if (typeof window.require === "function") {
      return window.require;
    }
    return null;
  }

  var nodeRequire = getNodeRequire();
  var node = {};
  if (nodeRequire) {
    node.childProcess = nodeRequire("child_process");
    node.fs = nodeRequire("fs");
    node.os = nodeRequire("os");
    node.path = nodeRequire("path");
    node.readline = nodeRequire("readline");
    node.process = nodeRequire("process");
    node.Buffer = nodeRequire("buffer").Buffer;
    node.http = nodeRequire("http");
    node.https = nodeRequire("https");
    node.zlib = nodeRequire("zlib");
    node.crypto = nodeRequire("crypto");
  }

  var cep = window.__adobe_cep__ || null;
  var media = null;
  var referenceStore = null;
  if (node.fs && window.AEMedia && window.AEReferences) {
    media = new window.AEMedia.Media(node, window.AEPlatform.dataDirectory(node));
    referenceStore = new window.AEReferences.Store(node, node.path.join(window.AEPlatform.dataDirectory(node), "References"));
    try { referenceStore.load(); } catch (error) { referenceStore.items = []; }
  }
  // Skills and connectors, shared with every other Soma program.
  var extensions = node.fs && window.SomaExtensions ? new window.SomaExtensions.Extensions(node, window.AEPlatform.dataDirectory(node)) : null;

  function isUndoOrRedoShortcut(event) {
    var key = String(event.key || "").toLowerCase();
    var commandModifier = event.ctrlKey || event.metaKey;
    return commandModifier && (key === "z" || key === "y");
  }

  function blockHostUndoShortcuts() {
    // CEP normally forwards unclaimed panel key events to After Effects. Register
    // both platform key-code variants so an accidental Undo/Redo remains inside
    // the panel instead of reverting an agent-created project change.
    if (cep && typeof cep.registerKeyEventsInterest === "function") {
      try {
        cep.registerKeyEventsInterest(JSON.stringify([
          { keyCode: 6, metaKey: true },
          { keyCode: 6, metaKey: true, shiftKey: true },
          { keyCode: 16, metaKey: true, shiftKey: true },
          { keyCode: 90, ctrlKey: true },
          { keyCode: 90, ctrlKey: true, shiftKey: true },
          { keyCode: 89, ctrlKey: true }
        ]));
      } catch (error) {
        // The DOM guard below still protects focused controls on older CEP hosts.
      }
    }
    document.addEventListener("keydown", function (event) {
      if (!isUndoOrRedoShortcut(event)) { return; }
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  blockHostUndoShortcuts();

  function initializeLibrary() {
    var adapter;
    if (node.fs && node.path && node.os) {
      libraryDirectory = window.AEPlatform.dataDirectory(node);
      exportDirectory = node.path.join(libraryDirectory, "Exports");
      var filePath = node.path.join(libraryDirectory, "tools.json");
      libraryBackupPath = filePath + ".previous";
      adapter = {
        read: function () { return node.fs.existsSync(filePath) ? node.fs.readFileSync(filePath, "utf8") : null; },
        write: function (text) {
          node.fs.mkdirSync(libraryDirectory, { recursive: true });
          if (node.fs.existsSync(filePath)) { node.fs.copyFileSync(filePath, libraryBackupPath); }
          var temp = filePath + ".tmp";
          node.fs.writeFileSync(temp, text, "utf8");
          node.fs.renameSync(temp, filePath);
        }
      };
    } else {
      adapter = { read: function () { return window.localStorage.getItem("aeAgent.tools.v1"); }, write: function (text) { window.localStorage.setItem("aeAgent.tools.v1", text); } };
    }
    library = new window.AEToolLibrary.Store(adapter);
    try { library.load(); } catch (error) { libraryError = error; }
    dock = new window.AEToolDock(library, {
      error: showBanner, run: runSavedTool, launch: launchNativeTool, export: exportNativeTool,
      changed: renderSettingsTools,
      edit: function (tool) {
        setChatMode("tools");
        elements.promptInput.value = "Update my saved tool “" + tool.name + "” (id: " + tool.id + "). ";
        elements.promptInput.focus(); resizePrompt();
      },
      removed: function () { renderSettingsTools(); showBanner("Tool removed from the dock." + (libraryBackupPath ? " The previous library is kept in tools.json.previous." : ""), "info"); }
    });
    elements.toolStoragePath.textContent = libraryDirectory || "Stored in this panel’s local browser data.";
    renderSettingsTools();
    if (libraryError) { showBanner("Your tool library could not be loaded. It has been preserved: " + libraryError.message); }
  }

  function setChatMode(mode) {
    if (isBusy) { return; }
    chatMode = mode;
    elements.editModeButton.setAttribute("aria-pressed", mode === "edit" ? "true" : "false");
    elements.toolModeButton.setAttribute("aria-pressed", mode === "tools" ? "true" : "false");
    elements.toolPhaseBar.hidden = mode !== "tools";
    elements.promptInput.placeholder = mode === "tools" ? "Describe a reusable tool and its options…" : "Message Soma Agente";
  }

  function setToolPhase(phase) {
    if (isBusy) { return; }
    toolPhase = phase;
    elements.planToolButton.setAttribute("aria-pressed", phase === "plan" ? "true" : "false");
    elements.buildToolButton.setAttribute("aria-pressed", phase === "build" ? "true" : "false");
    elements.promptInput.placeholder = phase === "plan" ? "Plan a reusable tool and preview its interface…" : "Build or update the planned tool…";
  }

  function updateRunControls() {
    var canStop = isBusy && activeRun;
    elements.sendButton.disabled = isBusy && (!canStop || activeRun.interruptPending || (activeRun.stopRequested && !activeRun.interruptFailed));
    elements.sendButton.classList.toggle("busy", Boolean(canStop));
    elements.sendButton.classList.toggle("stopping", Boolean(canStop && activeRun.stopRequested));
    elements.sendButton.innerHTML = canStop ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" stroke="none"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/></svg>';
    var label = canStop ? (activeRun.interruptFailed ? "Retry stop" : activeRun.stopRequested ? "Stopping…" : "Stop request") : "Send";
    elements.sendButton.title = label;
    elements.sendButton.setAttribute("aria-label", label);
    [elements.editModeButton, elements.toolModeButton, elements.planToolButton, elements.buildToolButton, elements.createToolButton].forEach(function (button) { button.disabled = isBusy; });
    elements.showDraftButton.disabled = isBusy || !latestToolDraft;
    if (dock) { dock.setBusy(isBusy); }
  }

  function stopRequest() {
    var run = activeRun;
    if (!isBusy || !run) { return; }
    run.stopRequested = true;
    setProgress("Stopping the request", "No further tools will start. If an " + HOST.name + " script is already running, wait for it to return or press Esc in " + HOST.name + ".", "running");
    updateRunControls();
    interruptRun(run);
  }

  function interruptRun(run) {
    if (run !== activeRun || !run.stopRequested || !run.proc || run.kind !== "chat" || run.interruptSent) { return; }
    run.interruptSent = true;
    // Ending the Claude Code process stops generation; the session can still be resumed.
    try { run.proc.kill(); } catch (error) { /* already exited */ }
  }

  function showBanner(message, kind) {
    elements.systemBanner.textContent = message;
    elements.systemBanner.className = "system-banner" + (kind === "info" ? " info" : "");
    elements.systemBanner.hidden = false;
  }

  function hideBanner() {
    elements.systemBanner.hidden = true;
  }

  function extensionPath() {
    if (!cep) {
      return "";
    }
    var raw = cep.getSystemPath("extension");
    var localPath = decodeURI(raw.replace(/^file:\/\//, ""));
    if (window.AEPlatform.windows(node)) { localPath = localPath.replace(/^\/([A-Za-z]:)/, "$1"); }
    return localPath;
  }

  // Opens a page in the default browser. (window.open inside CEP opens nothing.)
  function openExternal(url) {
    if (window.cep && window.cep.util && typeof window.cep.util.openURLInDefaultBrowser === "function") {
      window.cep.util.openURLInDefaultBrowser(url);
      return;
    }
    if (node.childProcess) {
      if (window.AEPlatform.windows(node)) { node.childProcess.spawn("explorer.exe", [url], { detached: true, stdio: "ignore" }).unref(); }
      else { node.childProcess.spawn("open", [url], { detached: true, stdio: "ignore" }).unref(); }
      return;
    }
    window.open(url, "_blank");
  }

  function evalHost(script, withMetadata) {
    return new Promise(function (resolve, reject) {
      if (!cep) {
        reject(new Error("The " + HOST.name + " bridge is only available inside the installed panel."));
        return;
      }
      cep.evalScript(script, function (raw) {
        if (!raw || raw === "EvalScript error.") {
          reject(new Error("" + HOST.name + " could not run the requested action."));
          return;
        }
        try {
          var result = JSON.parse(raw);
          if (!result.ok) {
            reject(new Error(result.error || "" + HOST.name + " reported an unknown error."));
            return;
          }
          resolve(withMetadata ? result : result.data);
        } catch (error) {
          reject(new Error("Unexpected " + HOST.name + " response: " + raw));
        }
      });
    });
  }

  var hostScriptReady = null;

  // Loads jsx/hosts/<id>.jsx into the program's script engine by absolute path
  // (the manifest's startup script stays empty; see jsx/host.jsx). A failed load
  // is reported and retried on the next tool call.
  function ensureHostScript() {
    if (!cep) { return Promise.resolve(); }
    var check = 'typeof AEAgent !== "undefined" && AEAgent.host === "' + HOST.id + '"';
    if (!hostScriptReady) {
      hostScriptReady = new Promise(function (resolve, reject) {
        cep.evalScript(check, function (raw) {
          if (raw === "true") { resolve(); return; }
          var file = (extensionPath() + "/jsx/hosts/" + HOST.id + ".jsx").replace(/\\/g, "/");
          cep.evalScript('$.evalFile(new File("' + file + '")); "loaded"', function (loaded) {
            cep.evalScript(check, function (again) {
              if (again === "true") { resolve(); return; }
              hostScriptReady = null;
              reject(new Error("The " + HOST.name + " bridge could not load (" + String(loaded).slice(0, 200) + "). Close and reopen the Soma panel."));
            });
          });
        });
      });
    }
    return hostScriptReady;
  }

  function callAfterEffects(tool, args, withMetadata) {
    var payload = encodeURIComponent(JSON.stringify({ tool: tool, args: args || {} }));
    var escaped = payload.replace(/\\/g, "\\\\").replace(/\"/g, '\\"');
    return ensureHostScript().then(function () {
      return evalHost('AEAgent.invoke("' + escaped + '")', withMetadata);
    });
  }

  // ---------------------------------------------------------------------------
  // Claude Code backend.
  // The panel hosts a local MCP server (Streamable HTTP, JSON responses) that
  // exposes the after_effects tools, then runs the Claude Code CLI headless for
  // each turn. Conversation continuity uses --resume with the Claude session id.
  // ---------------------------------------------------------------------------

  var MCP_SERVER_NAME = HOST.namespace;
  var MCP_TOOL_PREFIX = "mcp__" + MCP_SERVER_NAME + "__";
  var CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"].map(function (value) { return { reasoningEffort: value }; });
  var CLAUDE_MODELS = [
    { id: "default", model: null, displayName: "Claude (default)", description: "The default model of your Claude account.", isDefault: true, supportedReasoningEfforts: [], defaultReasoningEffort: null },
    { id: "opus", model: "opus", displayName: "Claude Opus", description: "Most capable; best for complex compositions.", supportedReasoningEfforts: CLAUDE_EFFORTS, defaultReasoningEffort: "high" },
    { id: "sonnet", model: "sonnet", displayName: "Claude Sonnet", description: "Fast and capable for everyday edits.", supportedReasoningEfforts: CLAUDE_EFFORTS, defaultReasoningEffort: "medium" },
    { id: "haiku", model: "haiku", displayName: "Claude Haiku", description: "Fastest; for simple changes.", supportedReasoningEfforts: [], defaultReasoningEffort: null }
  ];

  function claudeDataDirectory() {
    var dir = window.AEPlatform.dataDirectory(node);
    node.fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // comp.saveFrameToPng renders asynchronously: the file appears empty when the
  // script returns and is filled in later. Wait until each PNG ends with IEND.
  function pngComplete(filePath) {
    try {
      var size = node.fs.statSync(filePath).size;
      if (size < 20) { return false; }
      var fd = node.fs.openSync(filePath, "r");
      var tail = node.Buffer.alloc(12);
      node.fs.readSync(fd, tail, 0, 12, size - 12);
      node.fs.closeSync(fd);
      return tail.toString("latin1", 4, 8) === "IEND";
    } catch (error) {
      return false;
    }
  }

  function waitForFrames(result) {
    var frames = result && result.ok && result.data && result.data.frames;
    if (!frames || !node.fs) { return Promise.resolve(result); }
    var deadline = Date.now() + 60000;
    return new Promise(function (resolve) {
      (function poll() {
        var ready = frames.every(function (frame) { return pngComplete(frame.path); });
        if (ready || Date.now() > deadline) { resolve(result); return; }
        setTimeout(poll, 150);
      }());
    });
  }

  function buildToolContent(result) {
    var content = [{ type: "text", text: JSON.stringify(result) }];
    var previews = [];
    var frames = result && result.ok && result.data && result.data.frames;
    if (!frames) {
      return { content: content, previews: previews };
    }
    if (!node.fs || !node.Buffer) {
      result.ok = false;
      result.error = "The preview frames were rendered, but the panel could not read them for visual verification.";
      return { content: [{ type: "text", text: JSON.stringify(result) }], previews: previews };
    }
    var failedFrames = [];
    frames.forEach(function (frame) {
      try {
        var data = node.Buffer.from(node.fs.readFileSync(frame.path)).toString("base64");
        content.push({ type: "image", mimeType: "image/png", data: data });
        previews.push({ imageUrl: "data:image/png;base64," + data, time: frame.time, frame: frame.frame });
      } catch (error) {
        failedFrames.push(frame.frame);
      }
      try {
        node.fs.unlinkSync(frame.path);
      } catch (cleanupError) {
        // Temporary previews are also cleaned when the operating system clears its temp folder.
      }
    });
    if (failedFrames.length) {
      result.ok = false;
      result.error = "Visual verification could not read frame" + (failedFrames.length === 1 ? " " : "s ") + failedFrames.join(", ") + ". Render the preview again before declaring success.";
      content[0] = { type: "text", text: JSON.stringify(result) };
    }
    return { content: content, previews: previews };
  }

  // The Claude API rejects anyOf/oneOf/allOf at the top level of a tool schema,
  // so those alternatives are moved into the description instead.
  function mcpToolDefinitions() {
    return dynamicTools[0].tools.map(function (tool) {
      var schema = JSON.parse(JSON.stringify(tool.inputSchema));
      var description = tool.description;
      if (schema.anyOf) {
        description += " Required: " + schema.anyOf.map(function (option) { return (option.required || []).join(" + "); }).join(" OR ") + ".";
        delete schema.anyOf;
      }
      return { name: tool.name, description: description, inputSchema: schema };
    }).concat(extensions ? window.SomaExtensions.Extensions.TOOLS : []);
  }

  // Everything the agent is told, including the current skills and connectors.
  function fullInstructions() {
    return agentInstructions + (extensions ? extensions.instructions() : "") + persistentInstructionBlock();
  }

  // Calls from another agent through the Soma Hub (Antigravity) run outside a
  // panel request: one at a time, shown in the chat, and not tied to activeRun.
  function executeExternalTool(tool, args) {
    var key = "hub:" + Date.now() + ":" + Math.random();
    function mark(state) {
      showToolEvent(key, tool, state, state === "running" ? args : null);
      var event = activeToolEvents[key];
      event.title.textContent = "Antigravity · " + event.title.textContent.replace(/^Antigravity · /, "");
      if (state !== "running" && !isBusy) { elements.progressPanel.hidden = true; }
    }
    mark("running");
    var operation = toolQueue.then(function () {
      return executeHostTool({ namespace: HOST.namespace, tool: tool, arguments: args });
    });
    toolQueue = operation.catch(function () {});
    return operation.then(function (result) { mark("done"); return result; }, function (error) { mark("failed"); throw error; });
  }

  function handleMcpMessage(message, external) {
    if (!message || message.id === undefined || message.id === null) {
      return Promise.resolve(null);
    }
    function reply(result) { return { jsonrpc: "2.0", id: message.id, result: result }; }
    var params = message.params || {};
    if (message.method === "initialize") {
      return Promise.resolve(reply({
        protocolVersion: params.protocolVersion || "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: MCP_SERVER_NAME, title: "Soma Agente", version: "1.7.2" }
      }));
    }
    if (message.method === "ping") {
      return Promise.resolve(reply({}));
    }
    if (message.method === "tools/list") {
      return Promise.resolve(reply({ tools: mcpToolDefinitions() }));
    }
    if (message.method === "tools/call") {
      var tool = params.name;
      if (extensions && /^soma_/.test(tool)) {
        return extensions.call(tool, params.arguments || {}).then(function (result) {
          setTimeout(renderExtensions, 0);
          return reply({ content: [{ type: "text", text: JSON.stringify(result) }], isError: result.ok !== true });
        });
      }
      var call = external ? executeExternalTool(tool, params.arguments || {}) : executeDynamicTool({ namespace: MCP_SERVER_NAME, tool: tool, arguments: params.arguments || {} });
      return call.then(waitForFrames).then(function (result) {
        var output = buildToolContent(result);
        if (output.previews.length) {
          showToolPreviews(null, tool, output.previews);
        }
        return reply({ content: output.content, isError: result.ok !== true });
      }).catch(function (error) {
        return reply({ content: [{ type: "text", text: JSON.stringify({ ok: false, error: error.message }) }], isError: true });
      });
    }
    return Promise.resolve({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not supported: " + message.method } });
  }

  function ClaudeClient() {
    this.proc = null;
    this.pending = {};
    this.threadId = null;
    this.account = null;
    this.requiresOpenaiAuth = true;
    this.ready = false;
    this.models = [];
    this.selectedModel = null;
    this.selectedEffort = null;
    this.binary = null;
    this.version = "";
    this.server = null;
    this.token = null;
    this.mcpConfigPath = null;
    this.loginPoll = null;
  }

  ClaudeClient.prototype.startMcpServer = function () {
    var self = this;
    if (this.server) { return Promise.resolve(); }
    this.token = node.crypto.randomBytes(24).toString("hex");
    return new Promise(function (resolve, reject) {
      var server = node.http.createServer(function (req, res) {
        if (String(req.url || "").split("?")[0] !== "/mcp") { res.writeHead(404); res.end(); return; }
        if (req.headers.authorization !== "Bearer " + self.token) { res.writeHead(401); res.end(); return; }
        if (req.method === "DELETE") { res.writeHead(200); res.end(); return; }
        if (req.method !== "POST") { res.writeHead(405, { Allow: "POST, DELETE" }); res.end(); return; }
        var chunks = [];
        req.on("data", function (chunk) { chunks.push(chunk); });
        req.on("end", function () {
          var body;
          try { body = JSON.parse(node.Buffer.concat(chunks).toString("utf8")); } catch (error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
            return;
          }
          var batch = Array.isArray(body);
          var external = req.headers["x-soma-caller"] === "hub";
          Promise.all((batch ? body : [body]).map(function (message) { return handleMcpMessage(message, external); })).then(function (responses) {
            responses = responses.filter(Boolean);
            if (!responses.length) { res.writeHead(202); res.end(); return; }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(batch ? responses : responses[0]));
          });
        });
      });
      // Preview renders can take a while; never cut a tool call short.
      server.timeout = 0;
      server.requestTimeout = 0;
      server.on("error", reject);
      server.listen(0, "127.0.0.1", function () {
        self.server = server;
        var config = { mcpServers: {} };
        self.mcpUrl = "http://127.0.0.1:" + server.address().port + "/mcp";
        config.mcpServers[MCP_SERVER_NAME] = { type: "http", url: self.mcpUrl, headers: { Authorization: "Bearer " + self.token } };
        self.mcpConfigPath = node.path.join(claudeDataDirectory(), "mcp-config-" + HOST.id + ".json");
        node.fs.writeFileSync(self.mcpConfigPath, JSON.stringify(config), { encoding: "utf8", mode: 384 });
        self.hubBeat = setInterval(function () { hubPost(self, "/hub/register"); }, 30000);
        hubPost(self, "/hub/register");
        resolve();
      });
    });
  };

  // The panel asks the Soma Hub to check GitHub when it opens (and every few
  // hours). A newer version shows a bar with "Update now"; the hub installs it
  // as soon as the Adobe programs are closed.
  var dismissedUpdate = null;
  function showUpdate(update) {
    var bar = document.getElementById("updateBar");
    var statusText = document.getElementById("updateStatus");
    var installButton = document.getElementById("installUpdate");
    if (!update) { return; }
    var available = update.available && update.latest;
    if (update.status === "error") {
      statusText.textContent = L("Could not check for updates: ", "Não deu para verificar atualizações: ") + update.detail;
    } else if (!available) {
      statusText.textContent = L("You have the latest version (" + update.current + ").", "Você está na versão mais recente (" + update.current + ").");
    } else if (update.requested) {
      statusText.textContent = L("Version " + update.latest + " installs as soon as you close the Adobe programs (save your work first). You can reopen them right after.",
        "A versão " + update.latest + " instala assim que você fechar os programas Adobe (salve antes). Pode reabrir logo depois.");
    } else {
      statusText.textContent = L("Version " + update.latest + " is available (you have " + update.current + ").", "A versão " + update.latest + " está disponível (você tem a " + update.current + ").");
    }
    installButton.hidden = !available || update.requested;
    bar.innerHTML = "";
    bar.hidden = !available || dismissedUpdate === update.latest + (update.requested ? "+" : "");
    if (bar.hidden) { return; }
    var text = document.createElement("div");
    text.textContent = statusText.textContent;
    bar.appendChild(text);
    var actions = document.createElement("div");
    actions.className = "ext-actions";
    var buttons = update.requested ? [] : [{ label: L("Update now", "Atualizar agora"), primary: true, run: installUpdate }];
    buttons.push({ label: L("Later", "Depois"), run: function () { dismissedUpdate = update.latest + (update.requested ? "+" : ""); bar.hidden = true; } });
    buttons.forEach(function (b) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = b.label;
      if (b.primary) { button.className = "primary"; }
      button.addEventListener("click", b.run);
      actions.appendChild(button);
    });
    bar.appendChild(actions);
  }

  function checkHubUpdate(force) {
    if (!extensions || (isBusy && !force)) { return; }
    extensions.hubUpdate("check", force === true).then(showUpdate, function (error) {
      if (force === true) { document.getElementById("updateStatus").textContent = error.message; }
    });
  }

  function installUpdate() {
    if (!extensions) { return; }
    extensions.hubUpdate("install").then(showUpdate, function (error) { showBanner(error.message); });
  }

  // Tells the local Soma Hub where this program's tools are, so an outside
  // agent (Antigravity) can drive every open program. Silent when it is off.
  function hubPost(client, path) {
    if (!client.mcpUrl || !node.http) { return; }
    var body = JSON.stringify({ id: HOST.id, name: HOST.name, namespace: HOST.namespace, url: client.mcpUrl, token: client.token });
    try {
      var req = node.http.request({ host: "127.0.0.1", port: 47821, path: path, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": node.Buffer.byteLength(body) }, timeout: 3000 }, function (res) { res.resume(); });
      req.on("error", function () {});
      req.on("timeout", function () { req.destroy(); });
      req.end(body);
    } catch (error) { /* hub not installed */ }
  }

  ClaudeClient.prototype.start = function () {
    var self = this;
    if (!node.childProcess || !node.http || !node.crypto) {
      return Promise.reject(new Error("CEP Node support is unavailable. Reinstall the panel and restart " + HOST.name + "."));
    }
    if (this.ready) { return Promise.resolve(); }
    this.binary = window.AEPlatform.findClaudeBinary(node);
    if (!this.binary) {
      return Promise.reject(new Error("Claude Code was not found. Install the Claude desktop app or the Claude Code CLI, or save the full path of claude.exe in claude-path.txt inside " + claudeDataDirectory() + "."));
    }
    return new Promise(function (resolve, reject) {
      node.childProcess.execFile(self.binary, ["--version"], { timeout: 20000, windowsHide: true, env: window.AEPlatform.environment(node, self.binary) }, function (error, stdout, stderr) {
        if (error) { reject(new Error("Claude Code was found but could not start. " + String(stderr || error.message).trim())); return; }
        self.version = String(stdout || "").trim();
        resolve();
      });
    }).then(function () {
      return self.startMcpServer();
    }).then(function () {
      self.ready = true;
      setConnectionState("ready", "Claude ready");
    });
  };

  ClaudeClient.prototype.refreshAccount = function () {
    var self = this;
    if (!this.ready) { return Promise.resolve(null); }
    return new Promise(function (resolve) {
      node.childProcess.execFile(self.binary, ["auth", "status"], { timeout: 20000, windowsHide: true, env: window.AEPlatform.environment(node, self.binary) }, function (error, stdout) {
        var status = null;
        try { status = JSON.parse(String(stdout || "")); } catch (parseError) { status = null; }
        if (status && status.loggedIn) {
          self.account = { type: status.authMethod || "claude" };
          self.requiresOpenaiAuth = false;
          if (self.loginPoll) { clearInterval(self.loginPoll); self.loginPoll = null; }
        } else {
          self.account = null;
          self.requiresOpenaiAuth = true;
        }
        renderAccount(self.account, self.requiresOpenaiAuth);
        resolve(status);
      });
    });
  };

  ClaudeClient.prototype.login = function () {
    var self = this;
    var binary = this.binary;
    if (window.AEPlatform.windows(node)) {
      node.childProcess.spawn("cmd.exe", ["/d", "/c", 'start "Claude login" "' + binary + '" auth login'], { detached: true, stdio: "ignore", windowsVerbatimArguments: true }).unref();
    } else {
      // Opening a .command file launches Terminal without the Automation
      // permission prompt that scripting Terminal through osascript triggers.
      var script = node.path.join(claudeDataDirectory(), "claude-login.command");
      node.fs.writeFileSync(script, "#!/bin/zsh\n'" + binary.replace(/'/g, "'\\''") + "' auth login\necho\necho 'You can close this window.'\n", { encoding: "utf8", mode: 493 });
      node.fs.chmodSync(script, 493);
      node.childProcess.spawn("open", ["-a", "Terminal", script], { detached: true, stdio: "ignore" }).unref();
    }
    showBanner("A Claude login window opened. Finish signing in to your Claude account in the browser; this panel connects automatically.", "info");
    if (this.loginPoll) { clearInterval(this.loginPoll); }
    var started = Date.now();
    this.loginPoll = setInterval(function () {
      if (Date.now() - started > 300000) { clearInterval(self.loginPoll); self.loginPoll = null; return; }
      self.refreshAccount().then(function () { if (self.account) { hideBanner(); } });
    }, 4000);
    return Promise.resolve();
  };

  ClaudeClient.prototype.loadModels = function () {
    this.models = CLAUDE_MODELS.slice();
    chooseInitialModel();
    renderModelPicker();
    return Promise.resolve(this.models);
  };

  ClaudeClient.prototype.startTurn = function (content) {
    var self = this;
    var run = activeRun;
    return new Promise(function (resolve, reject) {
      if (!run || run !== activeRun || run.stopRequested) { throw new Error("Request stopped before generation started."); }
      var dataDir = claudeDataDirectory();
      var promptPath = node.path.join(dataDir, "system-prompt-" + HOST.id + ".txt");
      node.fs.writeFileSync(promptPath, fullInstructions(), "utf8");
      // The program's tools plus every enabled connector, rewritten each turn.
      var servers = extensions ? extensions.claudeServers() : {};
      servers[MCP_SERVER_NAME] = { type: "http", url: self.mcpUrl, headers: { Authorization: "Bearer " + self.token } };
      node.fs.writeFileSync(self.mcpConfigPath, JSON.stringify({ mcpServers: servers }), { encoding: "utf8", mode: 384 });
      var args = [
        "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
        "--system-prompt-file", promptPath,
        "--mcp-config", self.mcpConfigPath, "--strict-mcp-config",
        "--tools", "",
        "--allowedTools", Object.keys(servers).map(function (name) { return "mcp__" + name; }).join(","),
        "--permission-mode", "dontAsk"
      ];
      if (self.threadId) { args.push("--resume", self.threadId); }
      if (self.selectedModel && self.selectedModel.model) { args.push("--model", self.selectedModel.model); }
      if (self.selectedEffort && modelEfforts(self.selectedModel).length) { args.push("--effort", self.selectedEffort); }

      var proc = node.childProcess.spawn(self.binary, args, { cwd: dataDir, env: window.AEPlatform.environment(node, self.binary), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      self.proc = proc;
      run.proc = proc;
      var stderrText = "";
      var finalResult = null;
      var authFailed = false;
      var toolNames = {};

      proc.on("error", function (error) {
        if (self.proc === proc) { self.proc = null; }
        reject(new Error("Could not start Claude Code: " + error.message));
      });
      proc.stderr.on("data", function (chunk) { stderrText = (stderrText + String(chunk || "")).slice(-3000); });

      node.readline.createInterface({ input: proc.stdout }).on("line", function (line) {
        var message;
        try { message = JSON.parse(line); } catch (error) { return; }
        if (activeRun !== run) { return; }
        if (message.session_id) { self.threadId = message.session_id; run.threadId = message.session_id; }
        if (message.type === "assistant" && message.message && message.message.content) {
          if (message.error === "authentication_failed") { authFailed = true; }
          message.message.content.forEach(function (block, index) {
            if (block.type === "text" && block.text && !message.error) {
              finalizeAssistantItem(message.message.id + ":" + index, block.text);
            } else if (block.type === "tool_use") {
              var tool = String(block.name || "").replace(MCP_TOOL_PREFIX, "");
              toolNames[block.id] = tool;
              showToolEvent(block.id, tool, "running", block.input || {});
            }
          });
        } else if (message.type === "user" && message.message && Array.isArray(message.message.content)) {
          message.message.content.forEach(function (block) {
            if (block.type === "tool_result" && toolNames[block.tool_use_id]) {
              showToolEvent(block.tool_use_id, toolNames[block.tool_use_id], block.is_error ? "failed" : "done", null);
            }
          });
        } else if (message.type === "result") {
          finalResult = message;
        }
      });

      proc.on("close", function (code) {
        if (self.proc === proc) { self.proc = null; }
        if (authFailed) {
          self.account = null;
          self.requiresOpenaiAuth = true;
          renderAccount(null, true);
        }
        if (activeRun !== run) { return; }
        if (run.stopRequested) { finishTurn({ status: "interrupted" }); return; }
        if (finalResult && !finalResult.is_error) { finishTurn({ status: "completed" }); return; }
        var detail = authFailed ? "Claude is not signed in. Open Settings and click Connect Claude." :
          (finalResult && (finalResult.result || (finalResult.errors || []).join(" "))) || stderrText.trim() || ("Claude Code exited with code " + code + ".");
        if (!finalResult) { self.threadId = null; }
        finishTurn({ status: "failed", error: { message: detail } });
      });

      proc.stdin.on("error", function () { /* Reported through close. */ });
      proc.stdin.end(JSON.stringify({ type: "user", message: { role: "user", content: content }, parent_tool_use_id: null, session_id: "" }) + "\n");
      interruptRun(run);
      resolve();
    });
  };

  ClaudeClient.prototype.stop = function () {
    if (this.proc) { try { this.proc.kill(); } catch (error) { /* already exited */ } }
    if (this.server) { try { this.server.close(); } catch (error) { /* already closed */ } this.server = null; }
    if (this.loginPoll) { clearInterval(this.loginPoll); this.loginPoll = null; }
    if (this.hubBeat) { clearInterval(this.hubBeat); this.hubBeat = null; hubPost(this, "/hub/unregister"); }
    this.ready = false;
  };

  // ---------------------------------------------------------------------------
  // ChatGPT backend (Codex CLI).
  // Uses the same local MCP server. Each turn runs `codex exec --json` headless
  // with the after_effects server injected through -c overrides and the user's
  // own Codex config ignored. Continuity uses `exec resume <thread id>`.
  // ---------------------------------------------------------------------------

  var CODEX_TOKEN_ENV = "SOMA_MCP_TOKEN";
  var codexTurnCounter = 0;

  function codexHome() {
    return node.process.env.CODEX_HOME || node.path.join(node.os.homedir(), ".codex");
  }

  // The Codex app caches the models available to the signed-in account.
  function codexModels() {
    var models = [{ id: "default", model: null, displayName: "ChatGPT (default)", description: "The default model of your ChatGPT account.", isDefault: true, supportedReasoningEfforts: [], defaultReasoningEffort: null }];
    try {
      var cache = JSON.parse(node.fs.readFileSync(node.path.join(codexHome(), "models_cache.json"), "utf8"));
      (cache.models || []).filter(function (m) { return m.slug && m.visibility !== "hide"; }).forEach(function (m) {
        models.push({
          id: m.slug, model: m.slug, displayName: m.display_name || m.slug, description: m.description || "",
          supportedReasoningEfforts: (m.supported_reasoning_levels || []).map(function (level) { return { reasoningEffort: level.effort, description: level.description || "" }; }),
          defaultReasoningEffort: m.default_reasoning_level || null
        });
      });
    } catch (error) { /* No cache yet: the account default still works. */ }
    return models;
  }

  // -c values are parsed as TOML; a JSON string is a valid TOML basic string.
  function tomlString(value) { return JSON.stringify(String(value)); }

  // Codex takes images as files next to one text prompt, so image blocks are
  // written to disk and numbered in the text where they appeared.
  function codexInput(content) {
    var dir = node.path.join(claudeDataDirectory(), "codex-input");
    node.fs.mkdirSync(dir, { recursive: true });
    var text = [], images = [];
    content.forEach(function (block) {
      if (block.type === "text") { text.push(block.text); return; }
      if (block.type === "image" && block.source && block.source.data) {
        var ext = /png/.test(block.source.media_type) ? ".png" : /gif/.test(block.source.media_type) ? ".gif" : /webp/.test(block.source.media_type) ? ".webp" : ".jpg";
        var file = node.path.join(dir, Date.now() + "-" + images.length + ext);
        node.fs.writeFileSync(file, node.Buffer.from(block.source.data, "base64"));
        outgoingTempFiles.push(file);
        images.push(file);
        text.push("[Attached image #" + images.length + "]");
        return;
      }
      if (block.type === "document") {
        text.push("[A PDF was attached, but ChatGPT cannot read PDFs in this panel. Ask the user to attach the pages as images or switch to Claude.]");
      }
    });
    return { prompt: text.join("\n\n"), images: images };
  }

  function CodexClient() {
    ClaudeClient.call(this);
  }

  CodexClient.prototype.startMcpServer = ClaudeClient.prototype.startMcpServer;

  CodexClient.prototype.start = function () {
    var self = this;
    if (!node.childProcess || !node.http || !node.crypto) {
      return Promise.reject(new Error("CEP Node support is unavailable. Reinstall the panel and restart " + HOST.name + "."));
    }
    if (this.ready) { return Promise.resolve(); }
    this.binary = window.AEPlatform.findCodexBinary(node);
    if (!this.binary) {
      return Promise.reject(new Error("Codex (ChatGPT) was not found. Install the Codex app (chatgpt.com/codex) or the Codex CLI, or save the full path of codex.exe in codex-path.txt inside " + claudeDataDirectory() + "."));
    }
    return new Promise(function (resolve, reject) {
      node.childProcess.execFile(self.binary, ["--version"], { timeout: 20000, windowsHide: true, env: window.AEPlatform.environment(node, self.binary) }, function (error, stdout, stderr) {
        if (error) { reject(new Error("Codex was found but could not start. " + String(stderr || error.message).trim())); return; }
        self.version = String(stdout || "").trim();
        resolve();
      });
    }).then(function () {
      return self.startMcpServer();
    }).then(function () {
      self.ready = true;
      setConnectionState("ready", "ChatGPT ready");
    });
  };

  CodexClient.prototype.refreshAccount = function () {
    var self = this;
    if (!this.ready) { return Promise.resolve(null); }
    return new Promise(function (resolve) {
      node.childProcess.execFile(self.binary, ["login", "status"], { timeout: 20000, windowsHide: true, env: window.AEPlatform.environment(node, self.binary) }, function (error, stdout, stderr) {
        var text = String(stdout || "") + String(stderr || "");
        if (!error && /logged in/i.test(text)) {
          self.account = { type: /api key/i.test(text) ? "apiKey" : "chatgpt" };
          self.requiresOpenaiAuth = false;
          if (self.loginPoll) { clearInterval(self.loginPoll); self.loginPoll = null; }
        } else {
          self.account = null;
          self.requiresOpenaiAuth = true;
        }
        renderAccount(self.account, self.requiresOpenaiAuth);
        resolve(self.account);
      });
    });
  };

  CodexClient.prototype.login = function () {
    var self = this;
    var binary = this.binary;
    if (window.AEPlatform.windows(node)) {
      node.childProcess.spawn("cmd.exe", ["/d", "/c", 'start "ChatGPT login" "' + binary + '" login'], { detached: true, stdio: "ignore", windowsVerbatimArguments: true }).unref();
    } else {
      var script = node.path.join(claudeDataDirectory(), "codex-login.command");
      node.fs.writeFileSync(script, "#!/bin/zsh\n'" + binary.replace(/'/g, "'\\''") + "' login\necho\necho 'You can close this window.'\n", { encoding: "utf8", mode: 493 });
      node.fs.chmodSync(script, 493);
      node.childProcess.spawn("open", ["-a", "Terminal", script], { detached: true, stdio: "ignore" }).unref();
    }
    showBanner("A ChatGPT login window opened. Finish signing in to your ChatGPT account in the browser; this panel connects automatically.", "info");
    if (this.loginPoll) { clearInterval(this.loginPoll); }
    var started = Date.now();
    this.loginPoll = setInterval(function () {
      if (Date.now() - started > 300000) { clearInterval(self.loginPoll); self.loginPoll = null; return; }
      self.refreshAccount().then(function () { if (self.account) { hideBanner(); } });
    }, 4000);
    return Promise.resolve();
  };

  CodexClient.prototype.loadModels = function () {
    this.models = codexModels();
    chooseInitialModel();
    renderModelPicker();
    return Promise.resolve(this.models);
  };

  CodexClient.prototype.startTurn = function (content) {
    var self = this;
    var run = activeRun;
    return new Promise(function (resolve) {
      if (!run || run !== activeRun || run.stopRequested) { throw new Error("Request stopped before generation started."); }
      var dataDir = claudeDataDirectory();
      var input = codexInput(content);
      var turnKey = "codex" + (codexTurnCounter += 1) + ":";
      var args = [
        "exec", "--json", "--skip-git-repo-check", "--ignore-user-config", "-s", "read-only", "-C", dataDir,
        "-c", "mcp_servers." + MCP_SERVER_NAME + ".url=" + tomlString(self.mcpUrl),
        "-c", "mcp_servers." + MCP_SERVER_NAME + ".bearer_token_env_var=" + tomlString(CODEX_TOKEN_ENV),
        "-c", "mcp_servers." + MCP_SERVER_NAME + ".default_tools_approval_mode=\"approve\"",
        "-c", "mcp_servers." + MCP_SERVER_NAME + ".tool_timeout_sec=3600",
        "-c", "approval_policy=\"never\"",
        "-c", "developer_instructions=" + tomlString(fullInstructions())
      ].concat(extensions ? extensions.codexOverrides() : []);
      if (self.selectedModel && self.selectedModel.model) { args.push("-m", self.selectedModel.model); }
      if (self.selectedEffort && modelEfforts(self.selectedModel).length) { args.push("-c", "model_reasoning_effort=" + tomlString(self.selectedEffort)); }
      if (self.threadId) { args.push("resume"); }
      // --image takes several values; the = form keeps it from swallowing the
      // session id or the stdin marker that follow.
      input.images.forEach(function (file) { args.push("--image=" + file); });
      if (self.threadId) { args.push(self.threadId); }
      args.push("-");

      var env = window.AEPlatform.environment(node, self.binary);
      env[CODEX_TOKEN_ENV] = self.token;
      var proc = node.childProcess.spawn(self.binary, args, { cwd: dataDir, env: env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      self.proc = proc;
      run.proc = proc;
      var stderrText = "";
      var completed = false;
      var failure = null;
      var closed = false;

      proc.on("error", function (error) {
        if (self.proc === proc) { self.proc = null; }
        if (closed || activeRun !== run) { return; }
        closed = true;
        finishTurn({ status: "failed", error: { message: "Could not start Codex: " + error.message } });
      });
      proc.stderr.on("data", function (chunk) { stderrText = (stderrText + String(chunk || "")).slice(-3000); });

      node.readline.createInterface({ input: proc.stdout }).on("line", function (line) {
        var event;
        try { event = JSON.parse(line); } catch (error) { return; }
        if (activeRun !== run) { return; }
        if (event.type === "thread.started" && event.thread_id) {
          self.threadId = event.thread_id;
          run.threadId = event.thread_id;
        } else if ((event.type === "item.started" || event.type === "item.completed") && event.item) {
          var item = event.item;
          if (item.type === "agent_message" && event.type === "item.completed" && item.text) {
            finalizeAssistantItem(turnKey + item.id, item.text);
          } else if (item.type === "mcp_tool_call") {
            var state = event.type === "item.started" ? "running" : (item.status === "completed" && !item.error ? "done" : "failed");
            showToolEvent(turnKey + item.id, item.tool, state, event.type === "item.started" ? (item.arguments || {}) : null);
          }
        } else if (event.type === "turn.completed") {
          completed = true;
        } else if (event.type === "turn.failed") {
          failure = (event.error && event.error.message) || "ChatGPT could not finish the request.";
        } else if (event.type === "error" && event.message) {
          failure = event.message;
        }
      });

      proc.on("close", function (code) {
        if (self.proc === proc) { self.proc = null; }
        if (closed) { return; }
        closed = true;
        var detail = failure || stderrText.trim() || ("Codex exited with code " + code + ".");
        if (/not logged in|login|unauthori[sz]ed|401/i.test(detail) && !completed) {
          self.account = null;
          self.requiresOpenaiAuth = true;
          renderAccount(null, true);
          detail = "ChatGPT is not signed in. Open Settings and click Connect ChatGPT.";
        }
        if (activeRun !== run) { return; }
        if (run.stopRequested) { finishTurn({ status: "interrupted" }); return; }
        if (completed && !failure) { finishTurn({ status: "completed" }); return; }
        finishTurn({ status: "failed", error: { message: detail } });
      });

      proc.stdin.on("error", function () { /* Reported through close. */ });
      proc.stdin.end(input.prompt);
      interruptRun(run);
      resolve();
    });
  };

  CodexClient.prototype.stop = ClaudeClient.prototype.stop;

  // ---------------------------------------------------------------------------
  // Antigravity backend (agy CLI).
  // agy has no per-run MCP option, so it reaches this program through the Soma
  // Hub (server "soma" in Antigravity's MCP config); the panel's own MCP server
  // is registered with the hub, and those calls show up as "Antigravity · …".
  // ---------------------------------------------------------------------------

  var SOMA_TOOL_RULES = ["mcp(soma/*)"];

  function readJson(file) {
    try { var text = node.fs.readFileSync(file, "utf8").trim(); return text ? JSON.parse(text) : {}; } catch (error) { return {}; }
  }

  function writeJson(file, value) {
    node.fs.mkdirSync(node.path.dirname(file), { recursive: true });
    node.fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
  }

  // Adds the Soma Hub to Antigravity's MCP config and lets headless agy use only
  // its three tools. False when the hub has never run (no token yet).
  function ensureAntigravityConfig() {
    var token = "";
    try { token = node.fs.readFileSync(node.path.join(claudeDataDirectory(), "hub-token.txt"), "utf8").trim(); } catch (error) { token = ""; }
    if (!token) { return false; }
    var gemini = node.path.join(node.os.homedir(), ".gemini");
    var entry = { serverUrl: "http://127.0.0.1:47821/mcp", headers: { Authorization: "Bearer " + token }, timeoutSeconds: 3600 };
    [node.path.join(gemini, "config", "mcp_config.json"), node.path.join(gemini, "antigravity", "mcp_config.json")].forEach(function (file) {
      var config = readJson(file);
      config.mcpServers = config.mcpServers || {};
      if (JSON.stringify(config.mcpServers.soma) !== JSON.stringify(entry)) { config.mcpServers.soma = entry; writeJson(file, config); }
    });
    var settingsFile = node.path.join(gemini, "antigravity-cli", "settings.json");
    var settings = readJson(settingsFile);
    settings.permissions = settings.permissions || {};
    var allow = settings.permissions.allow = settings.permissions.allow || [];
    var missing = SOMA_TOOL_RULES.filter(function (rule) { return allow.indexOf(rule) < 0; });
    if (missing.length) { Array.prototype.push.apply(allow, missing); writeJson(settingsFile, settings); }
    return true;
  }

  function AntigravityClient() {
    ClaudeClient.call(this);
    this.agyModels = [];
  }

  AntigravityClient.prototype.startMcpServer = ClaudeClient.prototype.startMcpServer;
  AntigravityClient.prototype.stop = ClaudeClient.prototype.stop;

  AntigravityClient.prototype.start = function () {
    var self = this;
    if (!node.childProcess || !node.http || !node.crypto) {
      return Promise.reject(new Error("CEP Node support is unavailable. Reinstall the panel and restart " + HOST.name + "."));
    }
    if (this.ready) { return Promise.resolve(); }
    this.binary = window.AEPlatform.findAgyBinary(node);
    if (!this.binary) {
      return Promise.reject(new Error("The Antigravity CLI (agy) was not found. Install it from antigravity.google (Getting started > CLI), or save the full path of agy.exe in agy-path.txt inside " + claudeDataDirectory() + "."));
    }
    return new Promise(function (resolve) {
      node.childProcess.execFile(self.binary, ["--version"], { timeout: 20000, windowsHide: true, env: window.AEPlatform.environment(node, self.binary) }, function (error, stdout) {
        self.version = "agy " + String(stdout || "").trim();
        resolve();
      });
    }).then(function () {
      return self.startMcpServer();
    }).then(function () {
      self.ready = true;
      setConnectionState("ready", "Antigravity ready");
    });
  };

  // `agy models` only works when signed in, so it is also the sign-in check.
  AntigravityClient.prototype.refreshAccount = function () {
    var self = this;
    if (!this.ready) { return Promise.resolve(null); }
    return new Promise(function (resolve) {
      var child = node.childProcess.execFile(self.binary, ["models"], { timeout: 45000, windowsHide: true, env: window.AEPlatform.environment(node, self.binary) }, function (error, stdout) {
        var models = [];
        String(stdout || "").split(/\r?\n/).forEach(function (line) {
          var parts = line.split("\t");
          if (parts.length === 2 && parts[0].trim() && parts[0].trim().indexOf(" ") < 0) {
            models.push({ id: parts[0].trim(), model: parts[0].trim(), displayName: parts[1].trim(), description: "", supportedReasoningEfforts: [], defaultReasoningEffort: null });
          }
        });
        self.agyModels = models;
        if (!error && models.length) {
          self.account = { type: "antigravity" };
          self.requiresOpenaiAuth = false;
          if (self.loginPoll) { clearInterval(self.loginPoll); self.loginPoll = null; }
          if (!ensureAntigravityConfig()) { showBanner("Antigravity is signed in, but the Soma Hub is not running. Reinstall Soma Agente (it starts the hub) or open “Soma Hub” from the Start menu.", "info"); }
        } else {
          self.account = null;
          self.requiresOpenaiAuth = true;
        }
        renderAccount(self.account, self.requiresOpenaiAuth);
        self.loadModels();
        resolve(self.account);
      });
      if (child.stdin) { child.stdin.end(); }
    });
  };

  AntigravityClient.prototype.login = function () {
    var self = this;
    if (window.AEPlatform.windows(node)) {
      node.childProcess.spawn("cmd.exe", ["/d", "/c", 'start "Antigravity login" "' + this.binary + '"'], { detached: true, stdio: "ignore", windowsVerbatimArguments: true }).unref();
    } else {
      var script = node.path.join(claudeDataDirectory(), "agy-login.command");
      node.fs.writeFileSync(script, "#!/bin/zsh\n'" + this.binary.replace(/'/g, "'\\''") + "'\n", { encoding: "utf8", mode: 493 });
      node.fs.chmodSync(script, 493);
      node.childProcess.spawn("open", ["-a", "Terminal", script], { detached: true, stdio: "ignore" }).unref();
    }
    showBanner("An Antigravity window opened. Sign in there, then close it; this panel connects automatically.", "info");
    if (this.loginPoll) { clearInterval(this.loginPoll); }
    var started = Date.now();
    this.loginPoll = setInterval(function () {
      if (Date.now() - started > 300000) { clearInterval(self.loginPoll); self.loginPoll = null; return; }
      self.refreshAccount();
    }, 8000);
    return Promise.resolve();
  };

  AntigravityClient.prototype.loadModels = function () {
    this.models = [{ id: "default", model: null, displayName: "Antigravity (default)", description: "The model selected in Antigravity.", isDefault: true, supportedReasoningEfforts: [], defaultReasoningEffort: null }].concat(this.agyModels);
    chooseInitialModel();
    renderModelPicker();
    return Promise.resolve(this.models);
  };

  AntigravityClient.prototype.startTurn = function (content) {
    var self = this;
    var run = activeRun;
    return new Promise(function (resolve) {
      if (!run || run !== activeRun || run.stopRequested) { throw new Error("Request stopped before generation started."); }
      if (extensions) { extensions.syncAntigravity(); }
      if (!ensureAntigravityConfig()) { throw new Error("The Soma Hub is not running, so Antigravity cannot reach " + HOST.name + ". Reinstall Soma Agente or open “Soma Hub” from the Start menu."); }
      hubPost(self, "/hub/register");
      var workspace = node.path.join(claudeDataDirectory(), "antigravity-workspace");
      node.fs.mkdirSync(workspace, { recursive: true });
      var input = codexInput(content);
      var prompt = [];
      if (!self.threadId) {
        prompt.push("<soma_instructions>\n" + fullInstructions() + "\nYou reach " + HOST.name + " through the soma MCP server: call get_app_tools with app=\"" + HOST.id + "\" once, then call_app_tool with app=\"" + HOST.id + "\" for every action. Skills and connectors are managed with the soma_* tools of the same soma server. Other open programs are listed by list_apps if the user asks to combine programs. Do not use the terminal, browser or file-editing tools for work in " + HOST.name + ".\n</soma_instructions>");
      }
      input.images.forEach(function (file, i) { prompt.push("[Attached image #" + (i + 1) + ", file path: " + file + "]"); });
      prompt.push(input.prompt);
      var args = ["-p", prompt.join("\n\n"), "--output-format", "stream-json"];
      if (self.selectedModel && self.selectedModel.model) { args.push("--model", self.selectedModel.model); }
      if (self.threadId) { args.push("--conversation", self.threadId); }
      var proc = node.childProcess.spawn(self.binary, args, { cwd: workspace, env: window.AEPlatform.environment(node, self.binary), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
      self.proc = proc;
      run.proc = proc;
      var stderrText = "";
      var texts = {};
      var result = null;
      var closed = false;
      var turnKey = "agy" + (codexTurnCounter += 1) + ":";

      proc.on("error", function (error) {
        if (self.proc === proc) { self.proc = null; }
        if (closed || activeRun !== run) { return; }
        closed = true;
        finishTurn({ status: "failed", error: { message: "Could not start Antigravity: " + error.message } });
      });
      proc.stderr.on("data", function (chunk) { stderrText = (stderrText + String(chunk || "")).slice(-3000); });
      node.readline.createInterface({ input: proc.stdout }).on("line", function (line) {
        var event;
        try { event = JSON.parse(line); } catch (error) { return; }
        if (activeRun !== run) { return; }
        var id = event.conversation_id || (event.step_update && event.step_update.conversation_id) || (event.result && event.result.conversation_id);
        if (id) { self.threadId = id; run.threadId = id; }
        if (event.event === "step_update" && event.step_update.step_type === "agent_response") {
          var index = event.step_update.step_index;
          texts[index] = (texts[index] || "") + (event.step_update.text_delta || "");
          if (texts[index].trim()) { finalizeAssistantItem(turnKey + index, texts[index].trim()); }
        } else if (event.event === "result") {
          result = event.result || {};
        }
      });
      proc.on("close", function (code) {
        if (self.proc === proc) { self.proc = null; }
        if (closed) { return; }
        closed = true;
        if (activeRun !== run) { return; }
        if (run.stopRequested) { finishTurn({ status: "interrupted" }); return; }
        if (result && result.status === "SUCCESS") {
          if (!Object.keys(texts).length && result.response) { finalizeAssistantItem(turnKey + "final", String(result.response).trim()); }
          finishTurn({ status: "completed" });
          return;
        }
        var detail = (result && (result.error || result.status)) || stderrText.trim() || ("Antigravity exited with code " + code + ".");
        finishTurn({ status: "failed", error: { message: detail } });
      });
      interruptRun(run);
      resolve();
    });
  };

  var PROVIDERS = {
    claude: { label: "Claude", mark: "C", download: "https://claude.ai/download", Client: ClaudeClient },
    chatgpt: { label: "ChatGPT", mark: "G", download: "https://chatgpt.com/codex", Client: CodexClient },
    antigravity: { label: "Antigravity", mark: "A", download: "https://antigravity.google/docs/getting-started", Client: AntigravityClient }
  };
  var provider = PROVIDERS[readPreference("aeAgent.provider", "claude")] ? readPreference("aeAgent.provider", "claude") : "claude";
  var client = new PROVIDERS[provider].Client();

  function providerLabel() { return PROVIDERS[provider].label; }

  // Preferences stay per provider so each keeps its own model and effort.
  function providerKey(name) { return provider === "claude" ? name : name + "." + provider; }

  function switchProvider(id) {
    if (!PROVIDERS[id] || id === provider) { return; }
    if (isBusy) { showBanner("Wait for the current request to finish before switching the AI.", "info"); return; }
    client.stop();
    provider = id;
    savePreference("aeAgent.provider", id);
    // The chat stays: the new AI starts its own session and receives the
    // conversation so far with the next message (see conversationHistory).
    client = new PROVIDERS[id].Client();
    if (conversationHistory()) { showBanner(L("Switched to " + providerLabel() + " — the conversation continues. Use New chat to start over.", "Trocado para o " + providerLabel() + " — a conversa continua. Use Nova conversa para começar do zero."), "info"); }
    renderProvider();
    elements.modelLabel.textContent = "Loading models…";
    bootstrap();
  }

  function renderProvider() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-provider-choice]"), function (button) {
      button.setAttribute("aria-pressed", String(button.getAttribute("data-provider-choice") === provider));
    });
    var card = document.getElementById("providerName");
    if (card) { card.textContent = providerLabel(); }
    var mark = document.getElementById("providerMark");
    if (mark) { mark.textContent = PROVIDERS[provider].mark; mark.className = "provider-mark " + provider + "-mark"; }
    elements.accountButton.title = "Connect your " + providerLabel() + " account or check connection status";
    elements.promptInput.placeholder = "Message Soma Agente · " + providerLabel();
  }

  function renderDiagnosticReport() {
    elements.diagnosticMessage.textContent = providerLabel() + ": " + connectionDiagnostics.claude;
    elements.diagnosticTimestamp.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // Shows that something happened even when the result is the same as before.
  function runConnectionDiagnostics() {
    elements.runDiagnostics.disabled = true;
    elements.diagnosticMessage.textContent = L("Checking ", "Verificando o ") + providerLabel() + "…";
    var check = client.ready ? client.refreshAccount() : bootstrap();
    function done() {
      elements.runDiagnostics.disabled = false;
      renderDiagnosticReport();
    }
    return Promise.resolve(check).then(done, done);
  }

  function copyDiagnosticReport() {
    var report = "Soma Agente connection report\nProgram: " + HOST.name + "\nAI: " + providerLabel() + "\nBinary: " + (client.binary || "not found") + (client.version ? " (" + client.version + ")" : "") +
      "\nClaude app: " + window.AEPlatform.hasClaudeApp(node) + "\nAntigravity app: " + window.AEPlatform.hasAntigravityApp(node) + "\nStatus: " + connectionDiagnostics.claude;
    function copied() { elements.copyDiagnostics.textContent = L("Copied", "Copiado"); setTimeout(function () { elements.copyDiagnostics.textContent = L("Copy report", "Copiar relatório"); }, 1600); }
    // CEP may refuse the async clipboard; the selection copy works there.
    function fallback() {
      var area = document.createElement("textarea"); area.value = report; document.body.appendChild(area); area.select();
      var ok = false; try { ok = document.execCommand("copy"); } catch (error) { ok = false; }
      document.body.removeChild(area);
      if (ok) { copied(); } else { showBanner(report, "info"); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(report).then(copied, fallback); return; }
    fallback();
  }

  var agentInstructions = HOST.instructions.join(" ");

  var dynamicTools = [{ type: "namespace", name: HOST.namespace, description: HOST.description, tools: HOST.tools }];


  function persistentInstructionBlock() {
    var instructions = readPreference("aeAgent.persistentInstructions", "").trim();
    return instructions ? " Persistent user instructions for every request: " + instructions : "";
  }

  var mutatingTools = HOST.mutating || {};

  function executeDynamicTool(params) {
    var run = activeRun;
    pendingToolCalls += 1;
    var operation = toolQueue.then(function () {
      if (!run || run !== activeRun || run.stopRequested || pendingCompletion) { throw new Error("Request stopped; this tool was not executed."); }
      if (params.threadId && params.threadId !== run.threadId) { throw new Error("Tool belongs to a different request."); }
      if (params.namespace === "tool_library") {
        throw new Error("Reusable tools are disabled in this chat-only build.");
      }
      return executeHostTool(params);
    });
    toolQueue = operation.catch(function () {});
    return operation.then(function (result) { settleTool(); return result; }, function (error) { settleTool(); throw error; });
  }

  function settleTool() {
    pendingToolCalls -= 1;
    if (pendingToolCalls === 0 && pendingCompletion) {
      var completion = pendingCompletion; pendingCompletion = null; finishTurn(completion);
    }
  }

  function executeHostTool(params) {
    var tool = params.tool;
    var args = params.arguments || {};
    if (params.namespace !== HOST.namespace) {
      return Promise.resolve({ ok: false, error: "Unknown tool namespace." });
    }
    if (activeRun && activeRun.kind === "chat" && activeRun.mode === "tools" && activeRun.phase === "plan") {
      return Promise.reject(new Error("Plan phase cannot inspect or modify the " + HOST.name + " project. Switch to Build to test the tool."));
    }

    if (tool === "apply_ease_curve") {
      try { args = resolveEaseArgs(args); } catch (error) { return Promise.reject(error); }
    }
    return callAfterEffects(tool, args, true).then(function (result) {
      if (mutatingTools[tool] && result.undoable) {
        currentTurnMutations += 1;
      } else if (tool === "undo_last_action" && currentTurnMutations > 0) {
        currentTurnMutations -= 1;
      }
      return { ok: true, data: result.data };
    });
  }

  // Presets are named in js/eases.js; After Effects only receives the bezier.
  function resolveEaseArgs(args) {
    var copy = JSON.parse(JSON.stringify(args || {}));
    if (copy.preset) {
      var preset = window.AEEases.find(copy.preset);
      if (!preset) { throw new Error("Unknown ease preset “" + copy.preset + "”. Use one of: " + window.AEEases.ids.join(", ") + ", or pass a bezier."); }
      if (!copy.bezier) { copy.bezier = preset.bezier.slice(); }
    }
    delete copy.preset;
    if (!copy.bezier || !window.AEEases.parseBezier(copy.bezier)) { throw new Error("Pass a preset or a cubic-bezier [x1, y1, x2, y2] with x1 and x2 between 0 and 1."); }
    if (!copy.useSelectedKeys && !copy.propertyPath) { throw new Error("Pass useSelectedKeys: true or a layer with propertyPath."); }
    return copy;
  }

  function setConnectionState(state, label) {
    elements.connectionLabel.textContent = label;
    if (state === "ready") {
      elements.connectionLabel.style.color = "#52d98b";
    } else if (state === "error") {
      elements.connectionLabel.style.color = "#ff626d";
    } else {
      elements.connectionLabel.style.color = "";
    }
  }

  // Why the AI cannot start, in plain words. The chat apps alone are not enough:
  // Soma runs the command-line agents (Claude Code, Codex, agy).
  function missingMessage() {
    var win = window.AEPlatform.windows(node);
    if (provider === "claude") {
      return (window.AEPlatform.hasClaudeApp(node)
        ? L("The Claude app is installed, but Soma needs Claude Code, which the chat app does not include. ", "O app do Claude está instalado, mas o Soma precisa do Claude Code, que não vem com o app de chat. ")
        : L("Claude Code was not found on this computer. ", "O Claude Code não foi encontrado neste computador. ")) +
        (win ? L("Click Install Claude Code to install it, then sign in. ", "Clique em Instalar Claude Code para instalar e depois faça o login. ") : L("Install it from code.claude.com, then click Check again. ", "Instale pelo code.claude.com e clique em Verificar de novo. ")) +
        L("Claude Code needs a paid Claude plan (Pro or Max); the free plan does not include it.", "O Claude Code precisa de um plano pago do Claude (Pro ou Max); o plano gratuito não inclui.");
    }
    if (provider === "antigravity") {
      return (window.AEPlatform.hasAntigravityApp(node)
        ? L("The Antigravity app is installed, but Soma needs the Antigravity CLI (agy), which is installed separately. ", "O app do Antigravity está instalado, mas o Soma precisa da CLI do Antigravity (agy), que é instalada à parte. ")
        : L("The Antigravity CLI (agy) was not found on this computer. ", "A CLI do Antigravity (agy) não foi encontrada neste computador. ")) +
        (win ? L("Click Install Antigravity CLI; it uses the same Google login as the app.", "Clique em Instalar CLI do Antigravity; ela usa o mesmo login Google do app.") : L("Install it from antigravity.google, then click Check again.", "Instale pelo antigravity.google e clique em Verificar de novo."));
    }
    return L("Codex was not found on this computer. Install the Codex app (chatgpt.com/codex) or the Codex CLI, then click Check again.", "O Codex não foi encontrado neste computador. Instale o app Codex (chatgpt.com/codex) ou a CLI do Codex e clique em Verificar de novo.");
  }

  // Runs the official installer of Claude Code or the Antigravity CLI in a
  // visible PowerShell window, then checks again when it closes.
  function installAgentCli() {
    var scripts = { claude: "https://claude.ai/install.ps1", antigravity: "https://antigravity.google/cli/install.ps1" };
    if (!window.AEPlatform.windows(node) || !scripts[provider] || !node.childProcess) { openExternal(PROVIDERS[provider].download); return; }
    var name = provider === "claude" ? "Claude Code" : "Antigravity CLI";
    var command = "Write-Host '" + L("Installing ", "Instalando o ") + name + "...'; irm " + scripts[provider] + " | iex; Write-Host ''; Write-Host '" +
      L("Done. This window closes in a few seconds; Soma checks again by itself.", "Pronto. Esta janela fecha em alguns segundos; o Soma verifica de novo sozinho.") + "'; Start-Sleep -Seconds 6";
    // start /wait opens a real console window and returns when it closes.
    var child = node.childProcess.spawn("cmd.exe", ["/d", "/c", 'start "Soma Agente" /wait powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "' + command + '"'],
      { stdio: "ignore", windowsHide: true, windowsVerbatimArguments: true });
    showBanner(L("Installing " + name + " in the window that opened. Soma checks again when it finishes.", "Instalando o " + name + " na janela que abriu. O Soma verifica de novo quando terminar."), "info");
    child.on("exit", function () { bootstrap(); });
    child.on("error", function (error) { showBanner(error.message); });
  }

  function renderAccount(account, requiresAuth) {
    elements.accountButton.disabled = false;
    elements.accountButton.classList.toggle("connected", Boolean(account) && !requiresAuth);
    if (!client.binary) {
      elements.accountLabel.textContent = { claude: L("Install Claude Code", "Instalar Claude Code"), chatgpt: L("Install Codex", "Instalar Codex"), antigravity: L("Install Antigravity CLI", "Instalar CLI do Antigravity") }[provider];
      elements.openaiDiagnosticSummary.textContent = "Not found";
      connectionDiagnostics.claude = missingMessage();
      renderDiagnosticReport();
      return;
    }
    if (!account) {
      elements.accountLabel.textContent = "Connect " + providerLabel();
      elements.openaiDiagnosticSummary.textContent = "Login required";
      connectionDiagnostics.claude = ({ claude: "Claude Code", chatgpt: "Codex", antigravity: "The Antigravity CLI" })[provider] + " is available (" + (client.version || client.binary) + "), but it is not signed in. Click Connect " + providerLabel() + " and finish the login in your browser.";
      renderDiagnosticReport();
      return;
    }
    elements.accountLabel.textContent = account.type === "apiKey" || account.type === "api_key" ? "API key connected" : providerLabel() + " connected";
    elements.openaiDiagnosticSummary.textContent = "Connected";
    connectionDiagnostics.claude = "Connected and ready (" + (client.version || providerLabel()) + ").";
    renderDiagnosticReport();
    hideBanner();
  }

  function readPreference(key, fallback) {
    try {
      return window.localStorage.getItem(key) || fallback;
    } catch (error) {
      return fallback;
    }
  }

  function savePreference(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      // Preferences remain active for this session when storage is unavailable.
    }
  }

  function modelEfforts(model) {
    return model && model.supportedReasoningEfforts ? model.supportedReasoningEfforts : [];
  }

  function effortName(option) {
    return option && (option.reasoningEffort || option.effort || option.value);
  }

  function chooseInitialModel() {
    var savedId = readPreference(providerKey("aeAgent.model"), "");
    var selected = null;
    var i;
    for (i = 0; i < client.models.length; i += 1) {
      if (client.models[i].id === savedId || client.models[i].model === savedId) {
        selected = client.models[i];
        break;
      }
    }
    if (!selected) {
      for (i = 0; i < client.models.length; i += 1) {
        if (client.models[i].isDefault) {
          selected = client.models[i];
          break;
        }
      }
    }
    client.selectedModel = selected || client.models[0] || null;
    chooseEffort(readPreference(providerKey("aeAgent.effort"), ""));
  }

  function chooseEffort(preferred) {
    var model = client.selectedModel;
    var efforts = modelEfforts(model);
    var chosen = "";
    for (var i = 0; i < efforts.length; i += 1) {
      if (effortName(efforts[i]) === preferred) {
        chosen = preferred;
        break;
      }
    }
    client.selectedEffort = chosen || (model ? model.defaultReasoningEffort : null) || (efforts[0] ? effortName(efforts[0]) : null);
    if (client.selectedEffort) {
      savePreference(providerKey("aeAgent.effort"), client.selectedEffort);
    }
  }

  function selectModel(model) {
    client.selectedModel = model;
    savePreference(providerKey("aeAgent.model"), model.id || model.model);
    chooseEffort(readPreference(providerKey("aeAgent.effort"), ""));
    renderModelPicker();
  }

  function selectEffort(effort) {
    client.selectedEffort = effort;
    savePreference(providerKey("aeAgent.effort"), effort);
    renderModelPicker();
  }

  function renderModelPicker() {
    var model = client.selectedModel;
    elements.modelButton.disabled = client.models.length === 0;
    elements.modelLabel.textContent = model ? (model.displayName || model.model) : "Default model";
    elements.effortLabel.textContent = client.selectedEffort ? "· " + client.selectedEffort : "";
    elements.modelList.innerHTML = "";

    client.models.forEach(function (candidate) {
      var button = document.createElement("button");
      button.className = "model-option" + (candidate === model ? " selected" : "");
      button.type = "button";
      var name = document.createElement("span");
      name.className = "model-option-name";
      name.textContent = candidate.displayName || candidate.model;
      button.appendChild(name);
      var check = document.createElement("span");
      check.className = "model-option-check";
      check.textContent = candidate === model ? "✓" : "";
      button.appendChild(check);
      if (candidate.description) {
        var description = document.createElement("span");
        description.className = "model-option-description";
        description.textContent = candidate.description;
        button.appendChild(description);
      }
      button.addEventListener("click", function () { selectModel(candidate); });
      elements.modelList.appendChild(button);
    });

    var efforts = modelEfforts(model);
    elements.effortSection.hidden = efforts.length === 0;
    elements.effortList.innerHTML = "";
    efforts.forEach(function (option) {
      var value = effortName(option);
      if (!value) {
        return;
      }
      var button = document.createElement("button");
      button.className = "effort-option" + (value === client.selectedEffort ? " selected" : "");
      button.type = "button";
      button.textContent = value;
      button.title = option.description || "";
      button.addEventListener("click", function () {
        selectEffort(value);
        closePopovers();
      });
      elements.effortList.appendChild(button);
    });
  }

  function normalizeHex(value) {
    var hex = String(value || "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      return hex.toLowerCase();
    }
    return null;
  }

  function applyAccent(value) {
    var hex = normalizeHex(value);
    if (!hex) { return false; }
    var rgb = [parseInt(hex.substr(1, 2), 16), parseInt(hex.substr(3, 2), 16), parseInt(hex.substr(5, 2), 16)];
    var strong = rgb.map(function (channel) { return Math.max(0, Math.round(channel * 0.86)); });
    var strongHex = "#" + strong.map(function (channel) { return ("0" + channel.toString(16)).slice(-2); }).join("");
    document.documentElement.style.setProperty("--accent", hex);
    document.documentElement.style.setProperty("--accent-strong", strongHex);
    document.documentElement.style.setProperty("--accent-rgb", rgb.join(", "));
    elements.accentInput.value = hex;
    Array.prototype.forEach.call(document.querySelectorAll(".color-swatch"), function (swatch) {
      swatch.classList.toggle("selected", swatch.getAttribute("data-color").toLowerCase() === hex);
    });
    savePreference("aeAgent.accent", hex);
    return true;
  }

  function safeToolFilename(name) {
    var value = String(name || "Soma Agente Tool").replace(/[\\\/:*?"<>|]/g, "-").replace(/^\.+|\.+$/g, "").trim();
    return value || "Soma Agente Tool";
  }

  function nextExportPath(base, extension) {
    var candidate = node.path.join(exportDirectory, base + extension);
    var index = 2;
    while (node.fs.existsSync(candidate)) { candidate = node.path.join(exportDirectory, base + " " + index + extension); index += 1; }
    return candidate;
  }

  function exportNativeTool(tool) {
    try {
      if (!node.fs || !node.path || !exportDirectory) { throw new Error("Local export is unavailable in this panel."); }
      node.fs.mkdirSync(exportDirectory, { recursive: true });
      var base = safeToolFilename(tool.name);
      var jsxPath = nextExportPath(base, ".jsx");
      var jsonPath = jsxPath.replace(/\.jsx$/, ".json");
      node.fs.writeFileSync(jsxPath, window.AENativeTool.generate(tool), "utf8");
      node.fs.writeFileSync(jsonPath, JSON.stringify({ format: "ae-agent-tool", version: 1, tool: tool }, null, 2), "utf8");
      showBanner("Exported “" + tool.name + "” to " + jsxPath + ". The JSX is a standalone ScriptUI panel; the JSON is editable source for Soma Agente.", "info");
      renderSettingsTools();
    } catch (error) { showBanner("Tool export failed: " + error.message); }
  }

  function launchNativeTool(tool) {
    if (!cep) { showBanner("Open native tools inside " + HOST.name + "."); return; }
    var source;
    try { source = window.AENativeTool.generate(tool); } catch (error) { showBanner("Could not build the native tool window: " + error.message); return; }
    cep.evalScript(source, function (result) {
      if (result === "EvalScript error.") { showBanner("" + HOST.name + " could not open the native tool window. Export it and install the JSX as a ScriptUI Panel for a dockable version."); }
    });
  }

  function openLocalFolder(folderPath) {
    if (!folderPath || !node.fs || !node.childProcess) { showBanner("This folder is only available inside the installed panel."); return; }
    try { node.fs.mkdirSync(folderPath, { recursive: true }); window.AEPlatform.openFolder(node, folderPath); }
    catch (error) { showBanner("Could not open the folder: " + error.message); }
  }

  function renderSettingsTools() {
    if (!elements.settingsToolList || !library) { return; }
    elements.settingsToolList.innerHTML = "";
    if (!library.items.length) { elements.settingsToolList.textContent = "No saved tools yet."; return; }
    library.items.forEach(function (tool) {
      var row = document.createElement("div"); row.className = "settings-tool-row";
      var name = document.createElement("button"); name.type = "button"; name.className = "settings-tool-name";
      name.textContent = window.AEToolLibrary.icons[tool.icon] + "  " + tool.name; name.title = tool.description || "Preview and customize";
      name.addEventListener("click", function () { closePopovers(); dock.open(tool); });
      var launch = document.createElement("button"); launch.type = "button"; launch.textContent = "Open"; launch.title = "Open as a floating " + HOST.name + " tool";
      launch.addEventListener("click", function () { launchNativeTool(tool); });
      var exportButton = document.createElement("button"); exportButton.type = "button"; exportButton.textContent = "Export"; exportButton.title = "Export standalone JSX and editable JSON";
      exportButton.addEventListener("click", function () { exportNativeTool(tool); });
      row.appendChild(name); row.appendChild(launch); row.appendChild(exportButton); elements.settingsToolList.appendChild(row);
    });
  }

  function selectSettingsTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll("[data-settings-tab]"), function (button) { button.setAttribute("aria-pressed", button.getAttribute("data-settings-tab") === name ? "true" : "false"); });
    Array.prototype.forEach.call(document.querySelectorAll("[data-settings-page]"), function (page) { page.hidden = page.getAttribute("data-settings-page") !== name; });
  }

  function applyDockPreferences() {
    var position = readPreference("aeAgent.dockPosition", "left");
    var size = readPreference("aeAgent.dockSize", "compact");
    var labels = readPreference("aeAgent.dockLabels", "false") === "true";
    elements.dockPosition.value = position; elements.dockSize.value = size; elements.dockLabels.checked = labels;
    document.getElementById("appShell").classList.toggle("dock-right", position === "right");
    document.getElementById("appShell").classList.toggle("dock-comfortable", size === "comfortable");
    document.getElementById("appShell").classList.toggle("dock-with-labels", labels);
  }

  function closePopovers() {
    elements.modelPopover.hidden = true;
    elements.settingsPopover.hidden = true;
    elements.referencesPopover.hidden = true;
    document.getElementById("easePopover").hidden = true;
    document.getElementById("easeButton").setAttribute("aria-expanded", "false");
    elements.modelButton.setAttribute("aria-expanded", "false");
    elements.referencesButton.setAttribute("aria-expanded", "false");
  }

  function togglePopover(popover) {
    var shouldOpen = popover.hidden;
    closePopovers();
    popover.hidden = !shouldOpen;
    if (popover === elements.modelPopover) {
      elements.modelButton.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    }
    if (popover === elements.referencesPopover) {
      elements.referencesButton.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
      if (shouldOpen) { renderReferences(); }
    }
    if (popover === elements.settingsPopover && shouldOpen) { refreshMediaSettings(); }
    if (popover.id === "easePopover") { document.getElementById("easeButton").setAttribute("aria-expanded", shouldOpen ? "true" : "false"); }
  }

  function rejectAllPending(error) {
    Object.keys(client.pending).forEach(function (id) {
      clearTimeout(client.pending[id].timer);
      client.pending[id].reject(error);
      delete client.pending[id];
    });
  }

  function addMessage(role, text) {
    var article = document.createElement("article");
    article.className = "message " + (role === "user" ? "user-message" : "assistant-message");
    if (role !== "user") {
      var label = document.createElement("div");
      label.className = "message-label";
      label.textContent = "Soma Agente";
      article.appendChild(label);
    }
    var body = document.createElement("div");
    body.className = "message-body";
    body.textContent = text || "";
    article.appendChild(body);
    elements.conversation.appendChild(article);
    scrollConversation();
    return { article: article, body: body };
  }

  function appendAssistantDelta(itemId, delta) {
    if (!activeAssistantMessages[itemId]) {
      activeAssistantMessages[itemId] = addMessage("assistant", "");
      activeAssistantMessages[itemId].article.classList.add("streaming");
    }
    activeAssistantMessages[itemId].body.textContent += delta;
    scrollConversation();
  }

  function finalizeAssistantItem(itemId, text) {
    if (!activeAssistantMessages[itemId]) {
      activeAssistantMessages[itemId] = addMessage("assistant", text);
    } else if (!activeAssistantMessages[itemId].body.textContent) {
      activeAssistantMessages[itemId].body.textContent = text;
    }
    activeAssistantMessages[itemId].article.classList.remove("streaming");
  }

  function toolPresentation(tool, args) {
    var value = (HOST.presentation && HOST.presentation(tool, args)) || ["Working in " + HOST.name, tool.replace(/_/g, " ")];
    return { title: value[0], detail: value[1] };
  }

  function setProgress(title, detail, state) {
    if (progressResetTimer) {
      clearTimeout(progressResetTimer);
      progressResetTimer = null;
    }
    elements.progressPanel.hidden = false;
    elements.progressTitle.textContent = title;
    elements.progressDetail.textContent = detail || "";
    elements.progressBar.className = "progress-bar" + (state ? " " + state : "");
    if (state === "complete" || state === "failed") {
      progressResetTimer = setTimeout(function () {
        elements.progressPanel.hidden = true;
        elements.progressBar.className = "progress-bar";
      }, 1400);
    }
  }

  function showToolEvent(itemId, tool, state, args) {
    if (!activeToolEvents[itemId]) {
      var item = document.createElement("div");
      item.className = "tool-event";
      var indicator = document.createElement("span");
      indicator.className = "tool-indicator";
      var copy = document.createElement("span");
      copy.className = "tool-copy";
      var title = document.createElement("strong");
      title.className = "tool-title";
      var detail = document.createElement("span");
      detail.className = "tool-detail";
      var status = document.createElement("span");
      status.className = "tool-status";
      copy.appendChild(title);
      copy.appendChild(detail);
      item.appendChild(indicator);
      item.appendChild(copy);
      item.appendChild(status);
      elements.conversation.appendChild(item);
      activeToolEvents[itemId] = { element: item, title: title, detail: detail, status: status, tool: tool, args: args || {}, previews: null };
    }
    var event = activeToolEvents[itemId];
    if (args && Object.keys(args).length) {
      event.args = args;
    }
    var presentation = toolPresentation(tool, event.args || {});
    event.title.textContent = presentation.title;
    event.detail.textContent = presentation.detail;
    event.element.classList.toggle("done", state === "done");
    event.element.classList.toggle("failed", state === "failed");
    event.status.textContent = state === "done" ? "Done" : (state === "failed" ? "Failed" : "Working");
    if (state === "running") {
      setProgress(presentation.title, presentation.detail, "running");
    } else if (state === "done") {
      completedToolCount += 1;
      setProgress("Step " + completedToolCount + " complete", presentation.title + ". Continuing with verification.", "running");
    } else if (state === "failed") {
      setProgress("A step needs correction", presentation.title + " failed. The agent is inspecting the result and choosing another approach.", "running");
    }
    scrollConversation();
  }

  function showToolPreviews(itemId, tool, previews) {
    var event = activeToolEvents[itemId];
    if (!event) {
      var ids = Object.keys(activeToolEvents);
      for (var i = ids.length - 1; i >= 0; i -= 1) {
        if (activeToolEvents[ids[i]].tool === tool) {
          event = activeToolEvents[ids[i]];
          break;
        }
      }
    }
    if (!event || !previews.length) {
      return;
    }
    if (!event.previews) {
      event.previews = document.createElement("div");
      event.previews.className = "tool-preview-grid";
      event.element.appendChild(event.previews);
    }
    previews.forEach(function (preview) {
      var figure = document.createElement("figure");
      var image = document.createElement("img");
      image.src = preview.imageUrl;
      image.alt = "Preview frame " + preview.frame + " at " + Number(preview.time).toFixed(2) + " seconds";
      var caption = document.createElement("figcaption");
      caption.textContent = "f" + preview.frame + " · " + Number(preview.time).toFixed(2) + "s";
      figure.appendChild(image);
      figure.appendChild(caption);
      event.previews.appendChild(figure);
    });
    scrollConversation();
  }

  function finishTurn(turn) {
    if (!activeRun) { return; }
    if (pendingToolCalls > 0) { pendingCompletion = turn || { status: "completed" }; return; }
    var stopped = activeRun.stopRequested || (turn && turn.status === "interrupted");
    activeRun = null;
    isBusy = false;
    updateRunControls();
    lastTurnMutations = currentTurnMutations;
    elements.undoButton.disabled = lastTurnMutations < 1;
    Object.keys(activeAssistantMessages).forEach(function (id) {
      activeAssistantMessages[id].article.classList.remove("streaming");
    });
    activeAssistantMessages = {};
    activeToolEvents = {};
    if (stopped) {
      addMessage("assistant", L("Request stopped. Changes already applied remain in the project; you can use Revert last run to undo them.", "Pedido interrompido. O que já foi aplicado continua no projeto; use Desfazer a última execução para voltar."));
      setProgress("Request stopped", "No further agent actions will run.", "complete");
    } else if (turn && turn.status === "failed") {
      var message = turn.error && turn.error.message ? turn.error.message : L("The agent turn failed.", "A execução do agente falhou.");
      addMessage("assistant", L("I couldn’t complete that: ", "Não consegui concluir: ") + message);
      setProgress("The run stopped", message, "failed");
    } else {
      setProgress("Run complete", "See the result above for completed work and any verification limits.", "complete");
    }
    cleanupOutgoingTemps();
  }

  function scrollConversation() {
    elements.conversation.scrollTop = elements.conversation.scrollHeight;
  }

  function attachmentSummary(items) {
    var names = items.map(function (item) { return item.name + (item.type === "video" && item.frames ? " (" + item.frames.length + " frames)" : ""); });
    return names.length ? "\n\nAttached: " + names.join(", ") : "";
  }

  function addUserMessage(text, items) {
    var message = addMessage("user", text + attachmentSummary(items));
    var thumbs = items.map(function (item) { return item.type === "video" ? item.posterUrl : (item.type === "image" ? item.previewUrl : null); }).filter(Boolean);
    if (thumbs.length) {
      var strip = document.createElement("div");
      strip.className = "message-attachments";
      thumbs.forEach(function (url) { var image = document.createElement("img"); image.src = url; image.alt = ""; strip.appendChild(image); });
      message.article.appendChild(strip);
      scrollConversation();
    }
  }

  // Pinned references join the first message of every new Claude session.
  function addPinnedReferences() {
    if (client.threadId || !referenceStore) { return; }
    referenceStore.pinned().forEach(function (reference) {
      if (skippedPins[reference.id] || attachments.some(function (item) { return item.referenceId === reference.id; })) { return; }
      var item = attachReference(reference, true);
      if (item) { item.autoPinned = true; }
    });
  }

  function sendMessage() {
    if (isBusy) {
      stopRequest();
      return;
    }
    if (waitingForAttachments) { return; }
    var text = elements.promptInput.value.trim();
    if (!text && attachments.length === 0) {
      return;
    }
    if (!client.ready || (client.requiresOpenaiAuth && !client.account)) {
      showBanner("Connect your " + providerLabel() + " account before sending the first request.", "info");
      selectSettingsTab("agent");
      elements.settingsPopover.hidden = false;
      elements.accountButton.focus();
      return;
    }
    if (transcribing) {
      showBanner("Wait for the voice transcription to finish.", "info");
      return;
    }
    addPinnedReferences();
    var preparing = attachments.filter(function (item) { return item.status === "preparing"; });
    if (preparing.length) {
      // Videos and audio are still being converted; send once they are ready.
      waitingForAttachments = true;
      elements.sendButton.disabled = true;
      setProgress("Preparing attachments", "Extracting video frames and transcribing audio before sending.", "running");
      Promise.all(preparing.map(function (item) { return item.ready; })).then(function () {
        waitingForAttachments = false;
        elements.sendButton.disabled = false;
        elements.progressPanel.hidden = true;
        sendMessage();
      });
      return;
    }
    var failed = attachments.filter(function (item) { return item.status === "failed"; });
    if (failed.length) {
      showBanner("“" + failed[0].name + "” could not be prepared: " + failed[0].error + " Remove it to send the message.");
      return;
    }

    var sentAttachments = attachments.slice();
    sentAttachments.forEach(function (item) {
      // Keep pasted files until the chat ends so the agent can still import them.
      if (item.temp) { chatTempFiles.push(item.path); }
    });
    // A new session (first message, or after switching the AI) gets the chat so far.
    var history = client.threadId ? "" : conversationHistory();
    addUserMessage(text || L("Attached reference", "Referência anexada"), sentAttachments);

    attachments = [];
    renderAttachments();
    elements.promptInput.value = "";
    resizePrompt();
    isBusy = true;
    activeRun = { kind: "chat", mode: "edit", stopRequested: false, turnId: null, threadId: null };
    var run = activeRun;
    completedToolCount = 0;
    currentTurnMutations = 0;
    updateRunControls();
    elements.undoButton.disabled = true;
    hideBanner();
    setProgress(sentAttachments.length ? "Reading the attachments" : "Analyzing the request", sentAttachments.length ? "Packaging images, video frames, and transcripts for " + providerLabel() + "." : "Building an inspection and verification plan for the active composition.", "running");

    buildAttachmentBlocks(sentAttachments).then(function (input) {
      input.push({ type: "text", text: "[Panel mode: Chat only. Perform the requested work directly in " + HOST.name + ". Reusable tool creation is disabled.]" });
      if (history) { input.push({ type: "text", text: "<previous_conversation>\nThe conversation so far in this panel (possibly with another AI). Continue from it; the work it describes is already in the document.\n\n" + history + "\n</previous_conversation>" }); }
      input.push({ type: "text", text: text || "Use the attached references. Describe what you infer and help me reproduce or adapt it in the active composition." });
      if (sentAttachments.length) { setProgress("Analyzing the request", "Building an inspection and verification plan for the active composition.", "running"); }
      return client.startTurn(input);
    }).catch(function (error) {
      if (activeRun !== run) { return; }
      if (run.turnId) {
        showBanner("The request started, but its acknowledgement failed: " + error.message + " Use Stop before trying again.");
        return;
      }
      finishTurn({ status: run.stopRequested ? "interrupted" : "failed", error: { message: error.message } });
    });
  }

  function runSavedTool(tool, values) {
    if (isBusy) { return; }
    if (!cep) { showBanner("Run saved tools inside " + HOST.name + "."); return; }
    isBusy = true;
    activeRun = { kind: "local", stopRequested: false };
    currentTurnMutations = 0; completedToolCount = 0;
    elements.undoButton.disabled = true; updateRunControls();
    var run = activeRun;
    addMessage("user", "Run tool: " + tool.name);
    showToolEvent("local-tool", "execute_script", "running", { summary: tool.description || tool.name });
    var code;
    try { code = window.AEToolLibrary.script(tool, values); } catch (error) { finishTurn({ status: "failed", error: error }); return; }
    executeDynamicTool({ namespace: HOST.namespace, tool: "execute_script", arguments: { code: code, summary: tool.name } }).then(function (result) {
      showToolEvent("local-tool", "execute_script", "done", { summary: tool.name });
      if (!run.stopRequested) { addMessage("assistant", "“" + tool.name + "” ran locally. Result: " + JSON.stringify(result.data) + "\nNo model request was used; this run has not been visually reviewed by the agent."); }
      // The model's previous project context is stale after a local operation.
      client.threadId = null;
      finishTurn({ status: run.stopRequested ? "interrupted" : "completed" });
    }).catch(function (error) { finishTurn({ status: "failed", error: error }); });
  }

  function revertLastRun() {
    if (isBusy || lastTurnMutations < 1) {
      return;
    }
    var total = lastTurnMutations;
    var remaining = total;
    isBusy = true;
    updateRunControls();
    elements.sendButton.disabled = true;
    elements.undoButton.disabled = true;
    setProgress("Reverting the last run", "Restoring " + total + " " + HOST.name + " undo step" + (total === 1 ? "." : "s."), "running");

    function undoNext() {
      if (remaining < 1) {
        isBusy = false;
        lastTurnMutations = 0;
        currentTurnMutations = 0;
        elements.sendButton.disabled = false;
        updateRunControls();
        client.threadId = null;
        elements.undoButton.disabled = true;
        addMessage("assistant", L("Reverted the last Soma Agente run (" + total + " undo step" + (total === 1 ? "" : "s") + ").", "Última execução do Soma Agente desfeita (" + total + " passo(s) de desfazer)."));
        setProgress("Last run reverted", "The composition is back to the state before that agent run.", "complete");
        return;
      }
      callAfterEffects("undo_last_action", {}).then(function () {
        remaining -= 1;
        elements.progressDetail.textContent = (total - remaining) + " of " + total + " undo steps restored.";
        undoNext();
      }).catch(function (error) {
        isBusy = false;
        lastTurnMutations = remaining;
        elements.sendButton.disabled = false;
        updateRunControls();
        elements.undoButton.disabled = remaining < 1;
        showBanner("The last run could not be fully reverted: " + error.message);
        setProgress("Revert stopped", error.message, "failed");
      });
    }

    undoNext();
  }

  function resizePrompt() {
    elements.promptInput.style.height = "auto";
    elements.promptInput.style.height = Math.min(elements.promptInput.scrollHeight, 138) + "px";
  }

  // ---------------------------------------------------------------------------
  // Attachments: images, videos, audio, and documents.
  // Claude reads images and PDFs natively. Videos become timestamped frames plus
  // a transcript of their soundtrack; audio files become transcripts.
  // ---------------------------------------------------------------------------

  var IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
  var MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;
  var MAX_IMAGE_EDGE = 1568;
  var MAX_TEXT_CHARS = 150000;
  var ICONS = {
    video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>',
    audio: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>',
    document: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
    image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z"/></svg>'
  };

  function fileUrl(filePath) {
    var value = String(filePath).replace(/\\/g, "/");
    if (value.charAt(0) !== "/") { value = "/" + value; }
    return "file://" + encodeURI(value).replace(/#/g, "%23").replace(/\?/g, "%3F");
  }

  // Blob URLs keep canvas drawing same-origin (file:// images would taint it).
  function blobUrlForFile(filePath, mime) {
    return URL.createObjectURL(new Blob([node.fs.readFileSync(filePath)], { type: mime || "application/octet-stream" }));
  }

  function tempPath(extension) {
    return node.path.join(node.os.tmpdir(), "ae-agent-" + Date.now() + "-" + Math.random().toString(16).slice(2) + "." + extension);
  }

  function extensionForFile(file, kind) {
    var match = /\.([a-z0-9]{1,5})$/i.exec(file.name || "");
    if (match) { return match[1].toLowerCase(); }
    var mime = file.type || "";
    if (/webm/i.test(mime)) { return "webm"; }
    if (/ogg/i.test(mime)) { return "ogg"; }
    if (/quicktime/i.test(mime)) { return "mov"; }
    if (/mp4/i.test(mime)) { return kind === "audio" ? "m4a" : "mp4"; }
    if (/jpe?g/i.test(mime)) { return "jpg"; }
    if (/png/i.test(mime)) { return "png"; }
    if (/pdf/i.test(mime)) { return "pdf"; }
    return kind === "image" ? "png" : "bin";
  }

  // Writes a blob in slices so large videos never sit in memory at once.
  function persistBlob(blob, extension) {
    if (!node.fs || !node.os || !node.path) {
      return Promise.reject(new Error("Local file support is unavailable in this panel."));
    }
    var filePath = tempPath(extension);
    var fd = node.fs.openSync(filePath, "w");
    var size = blob.size, offset = 0, step = 8 * 1024 * 1024;
    function readSlice(slice) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { reject(reader.error || new Error("Could not read the attachment.")); };
        reader.readAsArrayBuffer(slice);
      });
    }
    function next() {
      if (offset >= size) { node.fs.closeSync(fd); return Promise.resolve(filePath); }
      return readSlice(blob.slice(offset, offset + step)).then(function (buffer) {
        node.fs.writeSync(fd, node.Buffer.from(buffer));
        offset += step;
        return next();
      });
    }
    return next().catch(function (error) {
      try { node.fs.closeSync(fd); } catch (closeError) { /* already closed */ }
      safeRemove(filePath);
      throw error;
    });
  }

  function addFile(file) {
    if (!file) { return Promise.resolve(); }
    var kind = window.AEReferences.kindForName(file.name || "", file.type);
    if (!kind) {
      showBanner("“" + (file.name || "This file") + "” is not supported. Attach images, videos, audio, PDFs, or text documents.");
      return Promise.resolve();
    }
    if (!node.fs) { showBanner("Attachments work inside the installed " + HOST.name + " panel."); return Promise.resolve(); }
    var source = file.path ? Promise.resolve({ path: file.path, temp: false }) : persistBlob(file, extensionForFile(file, kind)).then(function (path) { return { path: path, temp: true }; });
    return source.then(function (info) {
      addAttachmentFromPath(info.path, { kind: kind, name: file.name || ("Pasted " + kind), temp: info.temp });
    }).catch(function (error) {
      showBanner("Could not attach “" + (file.name || kind) + "”: " + error.message);
    });
  }

  function addAttachmentFromPath(filePath, options) {
    var item = {
      id: "a" + (attachmentCounter += 1),
      type: options.kind,
      name: options.name || node.path.basename(filePath),
      path: filePath,
      temp: Boolean(options.temp),
      referenceId: options.referenceId || null,
      note: options.note || "",
      previewUrl: "",
      posterUrl: options.posterPath ? fileUrl(options.posterPath) : "",
      status: "ready",
      badge: "",
      error: "",
      ready: Promise.resolve()
    };
    if (item.type === "image") { item.previewUrl = fileUrl(filePath); }
    if (item.type === "video") { item.ready = prepareVideo(item); }
    if (item.type === "audio") { item.ready = prepareAudio(item); }
    attachments.push(item);
    renderAttachments();
    return item;
  }

  function updateAttachment(item, status, badge, error) {
    item.status = status;
    item.badge = badge || "";
    if (error !== undefined) { item.error = error; }
    renderAttachments();
  }

  function renderAttachments() {
    elements.attachmentTray.innerHTML = "";
    elements.attachmentTray.hidden = attachments.length === 0;
    attachments.forEach(function (item) {
      var card = document.createElement("div");
      card.className = "attachment" + (item.type === "image" ? "" : (item.type === "video" && item.posterUrl ? " media-attachment" : " file-attachment")) + (item.status === "preparing" ? " preparing" : "") + (item.status === "failed" ? " failed" : "");
      card.title = item.name + (item.note ? "\nNote: " + item.note : "") + (item.error ? "\n" + item.error : "");
      var thumb = item.type === "image" ? item.previewUrl : (item.type === "video" ? item.posterUrl : "");
      if (thumb) {
        var image = document.createElement("img");
        image.src = thumb;
        image.alt = item.name;
        image.addEventListener("error", function () { image.remove(); card.classList.add("file-attachment"); card.insertAdjacentHTML("afterbegin", ICONS.image); });
        card.appendChild(image);
      } else {
        card.innerHTML = ICONS[item.type] || ICONS.document;
        var label = document.createElement("span");
        label.textContent = item.name;
        card.appendChild(label);
      }
      var badgeText = item.status === "failed" ? "Failed" : (item.badge || (item.type === "video" && item.frames ? item.frames.length + " frames" : ""));
      if (badgeText) {
        var badge = document.createElement("span");
        badge.className = "attachment-badge";
        badge.textContent = badgeText;
        card.appendChild(badge);
      }
      if (referenceStore) {
        var save = document.createElement("button");
        save.className = "attachment-save" + (item.referenceId ? " saved" : "");
        save.type = "button";
        save.innerHTML = ICONS.bookmark;
        save.title = item.referenceId ? "Saved in References" : "Save to References";
        save.setAttribute("aria-label", save.title);
        save.addEventListener("click", function () { saveAttachmentAsReference(item); });
        card.appendChild(save);
      }
      var remove = document.createElement("button");
      remove.className = "attachment-remove";
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Remove " + item.name);
      remove.addEventListener("click", function () { removeAttachment(item); });
      card.appendChild(remove);
      elements.attachmentTray.appendChild(card);
    });
  }

  function removeAttachment(target) {
    attachments = attachments.filter(function (item) { return item !== target; });
    if (target.autoPinned && target.referenceId) { skippedPins[target.referenceId] = true; }
    target.cancelled = true;
    if (target.temp) { safeRemove(target.path); }
    renderAttachments();
  }

  function transcriptionSettings() {
    var engine = readPreference("aeAgent.stt.engine", "local");
    return {
      engine: engine,
      language: readPreference("aeAgent.stt.language", "auto"),
      model: readPreference("aeAgent.stt.model", "small"),
      apiKey: readPreference("aeAgent.stt.key." + engine, "")
    };
  }

  // Decodes any audio the browser understands into 16 kHz mono WAV.
  function decodeToWav(arrayBuffer) {
    var AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !window.OfflineAudioContext) { return Promise.reject(new Error("This panel cannot decode audio.")); }
    var context = new AudioContextClass();
    return new Promise(function (resolve, reject) {
      context.decodeAudioData(arrayBuffer, resolve, function (error) { reject(error || new Error("The audio format could not be decoded.")); });
    }).then(function (decoded) {
      try { context.close(); } catch (error) { /* already closed */ }
      var offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * 16000)), 16000);
      var source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start(0);
      return offline.startRendering();
    }, function (error) {
      try { context.close(); } catch (closeError) { /* already closed */ }
      throw error;
    }).then(function (rendered) {
      return window.AEMedia.encodeWav(rendered.getChannelData(0), 16000);
    });
  }

  function writeWav(arrayBuffer) {
    var filePath = tempPath("wav");
    node.fs.writeFileSync(filePath, node.Buffer.from(arrayBuffer));
    return filePath;
  }

  var API_AUDIO = /\.(mp3|mp4|m4a|wav|webm|ogg|oga|flac|mpeg|mpga)$/i;

  // Produces a file the chosen engine accepts: the original for APIs when it
  // is small enough, otherwise 16 kHz WAV via FFmpeg or the browser decoder.
  function transcribableFile(sourcePath, settings) {
    if (settings.engine !== "local" && API_AUDIO.test(sourcePath) && node.fs.statSync(sourcePath).size <= 24 * 1024 * 1024) {
      return Promise.resolve({ path: sourcePath, temp: false });
    }
    var output = tempPath("wav");
    if (media.findFfmpeg()) {
      return media.extractAudio(sourcePath, output).then(function () { return { path: output, temp: true }; });
    }
    var bytes = node.fs.readFileSync(sourcePath);
    return decodeToWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).then(function (wav) {
      return { path: writeWav(wav), temp: true };
    }, function () {
      throw new Error("This audio format needs FFmpeg. Install it in Settings → Voice & video.");
    });
  }

  function transcribeFile(sourcePath, alreadyWav) {
    if (!media) { return Promise.reject(new Error("Transcription works inside the installed " + HOST.name + " panel.")); }
    var settings = transcriptionSettings();
    var problem = media.transcriptionProblem(settings);
    if (problem) { return Promise.reject(new Error(problem + " Open Settings → Voice & video.")); }
    var prepared = alreadyWav ? Promise.resolve({ path: sourcePath, temp: false }) : transcribableFile(sourcePath, settings);
    return prepared.then(function (file) {
      return media.transcribe(file.path, settings).then(function (result) {
        if (file.temp) { safeRemove(file.path); }
        return result;
      }, function (error) {
        if (file.temp) { safeRemove(file.path); }
        throw error;
      });
    });
  }

  function prepareAudio(item) {
    updateAttachment(item, "preparing", "Transcribing…");
    return transcribeFile(item.path, false).then(function (result) {
      if (item.cancelled) { return; }
      item.transcript = window.AEMedia.formatTranscript(result) || "(No speech was recognized.)";
      updateAttachment(item, "ready", "Transcribed");
    }).catch(function (error) {
      if (item.cancelled) { return; }
      updateAttachment(item, "failed", "", error.message);
    });
  }

  // Frames through the panel's own video decoder, for when FFmpeg is missing.
  function browserVideoFrames(filePath, count) {
    if (node.fs.statSync(filePath).size > 1024 * 1024 * 1024) {
      return Promise.reject(new Error("Videos over 1 GB need FFmpeg. Install it in Settings → Voice & video."));
    }
    return new Promise(function (resolve, reject) {
      var video = document.createElement("video");
      var url = blobUrlForFile(filePath, "video/mp4");
      var canvas = document.createElement("canvas");
      var frames = [];
      var timer = null;
      function finish(error, result) {
        clearTimeout(timer);
        video.removeAttribute("src");
        URL.revokeObjectURL(url);
        if (error) { reject(error); } else { resolve(result); }
      }
      function arm() {
        clearTimeout(timer);
        timer = setTimeout(function () { finish(new Error("The panel could not decode this video. Install FFmpeg in Settings → Voice & video.")); }, 20000);
      }
      video.muted = true;
      video.preload = "auto";
      video.addEventListener("error", function () { finish(new Error("The panel cannot decode this video format. Install FFmpeg in Settings → Voice & video.")); });
      video.addEventListener("loadeddata", function () {
        var duration = video.duration;
        if (!isFinite(duration) || !video.videoWidth) { finish(new Error("The panel cannot read this video. Install FFmpeg in Settings → Voice & video.")); return; }
        var scale = Math.min(1, 768 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        var times = window.AEMedia.sampleTimes(duration, count);
        (function next(index) {
          if (index >= times.length) {
            finish(null, { frames: frames, info: { duration: duration, width: video.videoWidth, height: video.videoHeight, fps: 0, hasAudio: null } });
            return;
          }
          arm();
          video.onseeked = function () {
            canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
            frames.push({ time: times[index], data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1] });
            next(index + 1);
          };
          video.currentTime = Math.min(times[index], Math.max(0, duration - 0.05));
        }(0));
      });
      arm();
      video.src = url;
    });
  }

  function ffmpegVideoFrames(item, count) {
    return media.probe(item.path).then(function (info) {
      if (!info.hasVideo) { throw new Error("This file has no video track."); }
      var times = window.AEMedia.sampleTimes(info.duration || 1, count);
      var frames = [];
      function next(index) {
        if (index >= times.length || item.cancelled) { return Promise.resolve({ frames: frames, info: info }); }
        updateAttachment(item, "preparing", "Frame " + (index + 1) + "/" + times.length);
        var output = tempPath("jpg");
        return media.extractFrame(item.path, times[index], output, 768).then(function () {
          frames.push({ time: times[index], data: node.fs.readFileSync(output).toString("base64") });
          safeRemove(output);
          return next(index + 1);
        });
      }
      return next(0);
    });
  }

  function prepareVideo(item) {
    var count = parseInt(readPreference("aeAgent.video.frames", "12"), 10) || 12;
    var ffmpeg = media && media.findFfmpeg();
    updateAttachment(item, "preparing", "Reading…");
    var extract = ffmpeg ? ffmpegVideoFrames(item, count) : browserVideoFrames(item.path, count);
    return extract.then(function (result) {
      if (item.cancelled) { return; }
      if (!result.frames.length) { throw new Error("No frames could be read from this video."); }
      item.frames = result.frames;
      item.info = result.info;
      item.posterData = result.frames[0].data;
      if (!item.posterUrl) { item.posterUrl = "data:image/jpeg;base64," + item.posterData; }
      storeReferencePoster(item);
      var wantTranscript = readPreference("aeAgent.video.transcribe", "true") === "true" && result.info.hasAudio !== false;
      if (!wantTranscript || media.transcriptionProblem(transcriptionSettings())) {
        if (wantTranscript) { item.transcriptNote = "Audio was not transcribed because voice transcription is not set up."; }
        updateAttachment(item, "ready", "");
        return;
      }
      updateAttachment(item, "preparing", "Transcribing…");
      return transcribeFile(item.path, false).then(function (transcript) {
        item.transcript = window.AEMedia.formatTranscript(transcript);
        if (!item.transcript) { item.transcriptNote = "No speech was recognized in the soundtrack."; }
      }, function (error) {
        item.transcriptNote = "The soundtrack could not be transcribed (" + error.message + ").";
      }).then(function () {
        if (!item.cancelled) { updateAttachment(item, "ready", ""); }
      });
    }).catch(function (error) {
      if (item.cancelled) { return; }
      updateAttachment(item, "failed", "", error.message);
    });
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error("decode failed")); };
      image.src = url;
    });
  }

  // Claude accepts PNG, JPEG, GIF, and WebP up to about 5 MB. Anything larger,
  // bigger than needed, or in another format is re-encoded first.
  function claudeImage(item) {
    var ext = node.path.extname(item.path).toLowerCase();
    var mediaType = IMAGE_TYPES[ext];
    var bytes = node.fs.readFileSync(item.path);
    var url = URL.createObjectURL(new Blob([bytes], { type: mediaType || "application/octet-stream" }));
    return loadImage(url).then(function (image) {
      URL.revokeObjectURL(url);
      var longEdge = Math.max(image.naturalWidth, image.naturalHeight);
      if (mediaType && bytes.length <= MAX_IMAGE_BYTES && longEdge <= 2000) {
        return { mediaType: mediaType, data: bytes.toString("base64"), width: image.naturalWidth, height: image.naturalHeight };
      }
      var scale = Math.min(1, MAX_IMAGE_EDGE / longEdge);
      var canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      var data = canvas.toDataURL("image/png").split(",")[1];
      var type = "image/png";
      if (data.length * 0.75 > MAX_IMAGE_BYTES) { data = canvas.toDataURL("image/jpeg", 0.9).split(",")[1]; type = "image/jpeg"; }
      return { mediaType: type, data: data, width: image.naturalWidth, height: image.naturalHeight };
    }, function () {
      URL.revokeObjectURL(url);
      // TIFF, PSD, EXR, HEIC and similar: let FFmpeg convert them.
      if (!media || !media.findFfmpeg()) { throw new Error("“" + item.name + "” cannot be read by the panel. Save it as PNG or JPEG, or install FFmpeg in Settings → Voice & video."); }
      var output = tempPath("jpg");
      return media.extractFrame(item.path, 0, output, MAX_IMAGE_EDGE).then(function () {
        var data = node.fs.readFileSync(output).toString("base64");
        safeRemove(output);
        return { mediaType: "image/jpeg", data: data, width: 0, height: 0 };
      });
    });
  }

  function attachmentHeading(item, number, kind) {
    return "Attachment " + number + " — " + kind + " “" + item.name + "”" + (item.referenceId ? " (saved reference)" : "") +
      (item.note ? ". The user's note about it: " + item.note : "") + ". File: " + item.path;
  }

  function buildAttachmentBlocks(items) {
    var blocks = [];
    var chain = Promise.resolve();
    items.forEach(function (item, index) {
      var number = index + 1;
      chain = chain.then(function () {
        if (item.type === "image") {
          return claudeImage(item).then(function (image) {
            blocks.push({ type: "text", text: attachmentHeading(item, number, "image") + (image.width ? " (" + image.width + "×" + image.height + " px)." : ".") });
            blocks.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } });
          });
        }
        if (item.type === "video") {
          var info = item.info || {};
          var details = [info.duration ? info.duration.toFixed(2) + " s" : null, info.width ? info.width + "×" + info.height + " px" : null, info.fps ? info.fps + " fps" : null].filter(Boolean).join(", ");
          var text = attachmentHeading(item, number, "video") + (details ? " (" + details + ")" : "") + ". " + item.frames.length + " frames sampled evenly across the clip follow, each labeled with its timestamp (mm:ss.s).";
          if (item.transcript) { text += "\nTranscript of the video's audio:\n" + item.transcript; } else if (item.transcriptNote) { text += "\n" + item.transcriptNote; }
          blocks.push({ type: "text", text: text });
          item.frames.forEach(function (frame, frameIndex) {
            blocks.push({ type: "text", text: "Attachment " + number + " frame " + (frameIndex + 1) + "/" + item.frames.length + " at " + window.AEMedia.formatTime(frame.time) });
            blocks.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: frame.data } });
          });
          return;
        }
        if (item.type === "audio") {
          blocks.push({ type: "text", text: attachmentHeading(item, number, "audio file") + ". Transcript:\n" + item.transcript });
          return;
        }
        if (/\.pdf$/i.test(item.path)) {
          blocks.push({ type: "text", text: attachmentHeading(item, number, "PDF document") + "." });
          blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: node.fs.readFileSync(item.path).toString("base64") } });
          return;
        }
        var content = node.fs.readFileSync(item.path, "utf8");
        var truncated = content.length > MAX_TEXT_CHARS;
        blocks.push({ type: "text", text: attachmentHeading(item, number, "document") + (truncated ? " (first " + MAX_TEXT_CHARS + " characters)" : "") + ":\n" + content.slice(0, MAX_TEXT_CHARS) });
      }).catch(function (error) {
        throw new Error("Could not read “" + item.name + "”: " + error.message);
      });
    });
    return chain.then(function () { return blocks; });
  }

  // ---------------------------------------------------------------------------
  // Saved references.
  // ---------------------------------------------------------------------------

  function attachReference(reference, silent) {
    if (attachments.some(function (item) { return item.referenceId === reference.id; })) {
      if (!silent) { showBanner("“" + reference.name + "” is already attached.", "info"); }
      return null;
    }
    var filePath = referenceStore.path(reference);
    if (!node.fs.existsSync(filePath)) {
      if (!silent) { showBanner("The file for “" + reference.name + "” is missing from the References folder."); }
      return null;
    }
    return addAttachmentFromPath(filePath, { kind: reference.kind, name: reference.name, temp: false, referenceId: reference.id, note: reference.note, posterPath: reference.poster ? referenceStore.path(reference, "poster") : null });
  }

  function storeReferencePoster(item) {
    var reference = item.referenceId && referenceStore && referenceStore.get(item.referenceId);
    if (reference && !reference.poster && item.posterData) {
      try { referenceStore.setPoster(reference.id, item.posterData); } catch (error) { /* the thumbnail is optional */ }
    }
  }

  function saveAttachmentAsReference(item) {
    if (item.referenceId) { showBanner("“" + item.name + "” is already in References.", "info"); return; }
    try {
      var reference = referenceStore.add(item.path, { name: item.name, kind: item.type, note: item.note, posterData: item.posterData });
      item.referenceId = reference.id;
      if (item.temp) {
        // The library keeps its own copy; point the attachment at it.
        safeRemove(item.path);
        item.path = referenceStore.path(reference);
        item.temp = false;
      }
      renderAttachments();
      renderReferences();
      showBanner("Saved “" + item.name + "” to References. Open the bookmark button to add a note or pin it to every new chat.", "info");
    } catch (error) {
      showBanner("Could not save the reference: " + error.message);
    }
  }

  function addReferenceFiles(files) {
    var chain = Promise.resolve();
    Array.prototype.forEach.call(files || [], function (file) {
      chain = chain.then(function () {
        var kind = window.AEReferences.kindForName(file.name || "", file.type);
        if (!kind) { showBanner("“" + file.name + "” is not a supported reference type."); return; }
        var source = file.path ? Promise.resolve(file.path) : persistBlob(file, extensionForFile(file, kind));
        return source.then(function (filePath) {
          referenceStore.add(filePath, { name: file.name, kind: kind });
          if (!file.path) { safeRemove(filePath); }
        });
      });
    });
    return chain.then(renderReferences).catch(function (error) { showBanner("Could not add the reference: " + error.message); });
  }

  // ---------------------------------------------------------------------------
  // Skills & connectors UI: settings tab plus an approval bar in the chat for
  // connectors the agent added and skills downloaded from a URL.
  // ---------------------------------------------------------------------------

  function extRow(title, detail, state, buttons) {
    var row = document.createElement("div");
    row.className = "ext-row";
    var text = document.createElement("div");
    var name = document.createElement("strong");
    name.textContent = title;
    if (state) { var tag = document.createElement("span"); tag.className = "ext-state"; tag.textContent = state; name.appendChild(tag); }
    var small = document.createElement("small");
    small.textContent = detail || "";
    small.title = detail || "";
    text.appendChild(name);
    text.appendChild(small);
    var actions = document.createElement("div");
    actions.className = "ext-actions";
    buttons.forEach(function (b) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = b.label;
      if (b.primary) { button.className = "primary"; }
      button.addEventListener("click", function (event) { event.stopPropagation(); try { b.action(); } catch (error) { showBanner(error.message); } renderExtensions(); });
      actions.appendChild(button);
    });
    row.appendChild(text);
    row.appendChild(actions);
    return row;
  }

  function renderExtensions() {
    var bar = document.getElementById("approvalBar");
    var skillList = document.getElementById("skillList");
    var connectorList = document.getElementById("connectorList");
    if (!extensions) {
      skillList.innerHTML = '<div class="ext-empty">Available inside the installed ' + HOST.name + ' panel.</div>';
      return;
    }
    var pending;
    try { pending = extensions.pending(); } catch (error) { pending = []; }
    bar.innerHTML = "";
    bar.hidden = pending.length === 0;
    if (pending.length) {
      var intro = document.createElement("div");
      intro.textContent = "The agent wants to add " + (pending.length === 1 ? "this" : "these") + ". Approve only what you trust: connectors run programs on this computer.";
      bar.appendChild(intro);
      pending.forEach(function (item) {
        bar.appendChild(extRow((item.kind === "connector" ? "Connector: " : "Skill: ") + item.name, item.detail || item.description, "", [
          { label: "Approve", primary: true, action: function () { extensions.approve(item.kind, item.name, true); } },
          { label: "Reject", action: function () { extensions.approve(item.kind, item.name, false); } }
        ]));
      });
    }
    skillList.innerHTML = "";
    var skills = extensions.listSkills();
    if (!skills.length) { skillList.innerHTML = '<div class="ext-empty">No skills yet. Try: “create a skill with my naming conventions”.</div>'; }
    skills.forEach(function (skill) {
      var buttons = skill.state === "pending" ? [{ label: "Approve", primary: true, action: function () { extensions.approve("skill", skill.name, true); } }] :
        [{ label: skill.state === "enabled" ? "Turn off" : "Turn on", action: function () { extensions.setSkillState(skill.name, skill.state === "enabled" ? "disabled" : "enabled"); } }];
      buttons.push({ label: "Delete", action: function () { extensions.deleteSkill(skill.name); } });
      skillList.appendChild(extRow(skill.title, skill.description, skill.state === "enabled" ? "" : skill.state, buttons));
    });
    connectorList.innerHTML = "";
    var connectors = extensions.loadConnectors();
    var names = Object.keys(connectors);
    if (!names.length) { connectorList.innerHTML = '<div class="ext-empty">No connectors yet.</div>'; }
    names.forEach(function (name) {
      var c = connectors[name];
      var buttons = c.state === "pending" ? [{ label: "Approve", primary: true, action: function () { extensions.approve("connector", name, true); } }] :
        [{ label: c.state === "enabled" ? "Turn off" : "Turn on", action: function () { extensions.setConnectorState(name, c.state === "enabled" ? "disabled" : "enabled"); } }];
      buttons.push({ label: "Remove", action: function () { extensions.removeConnector(name); } });
      connectorList.appendChild(extRow(name, (c.description ? c.description + " · " : "") + (c.url || [c.command].concat(c.args || []).join(" ")), c.state === "enabled" ? "" : c.state, buttons));
    });
  }

  function wireExtensions() {
    var status = document.getElementById("extStatus");
    function say(text) { status.textContent = text; }
    document.getElementById("importSkill").addEventListener("click", function () { document.getElementById("skillFile").click(); });
    document.getElementById("skillFile").addEventListener("change", function () {
      var file = this.files && this.files[0];
      this.value = "";
      if (!file || !extensions) { return; }
      try { say("Imported skill “" + extensions.importSkillFile(file.path) + "”."); } catch (error) { say(error.message); }
      renderExtensions();
    });
    document.getElementById("installSkill").addEventListener("click", function () {
      var url = document.getElementById("skillUrl").value.trim();
      if (!url || !extensions) { return; }
      say("Downloading…");
      extensions.installSkillFromUrl(url).then(function (result) {
        // The user typed this URL themselves, so it does not need a second approval.
        extensions.setSkillState(result.name, "enabled");
        say("Installed skill “" + result.name + "”.");
        document.getElementById("skillUrl").value = "";
        renderExtensions();
      }, function (error) { say(error.message); });
    });
    document.getElementById("addConnector").addEventListener("click", function () {
      if (!extensions) { return; }
      try {
        var spec = JSON.parse(document.getElementById("connectorJson").value);
        var added = extensions.addConnector(spec, "user");
        say("Connector “" + added.name + "” added. It is available from the next message.");
        document.getElementById("connectorJson").value = "";
      } catch (error) { say("Could not add it: " + error.message); }
      renderExtensions();
    });
    renderExtensions();
    // Other Soma programs share these files; pick up their changes.
    setInterval(renderExtensions, 15000);
  }

  function renderReferences() {
    var list = elements.referenceList;
    list.innerHTML = "";
    if (!referenceStore) { list.innerHTML = '<div class="reference-empty">References are available inside the installed ' + HOST.name + ' panel.</div>'; return; }
    if (!referenceStore.items.length) {
      list.innerHTML = '<div class="reference-empty">No references yet. Click + Add, or use the bookmark on an attached file.</div>';
      return;
    }
    referenceStore.items.forEach(function (reference) {
      var row = document.createElement("div");
      row.className = "reference-row" + (reference.pinned ? " pinned" : "");
      var thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = "reference-thumb";
      thumb.title = "Attach to the message";
      var preview = reference.kind === "image" ? referenceStore.path(reference) : (reference.poster ? referenceStore.path(reference, "poster") : null);
      if (preview) {
        var image = document.createElement("img");
        image.src = fileUrl(preview);
        image.alt = "";
        image.addEventListener("error", function () { thumb.innerHTML = ICONS[reference.kind] || ICONS.document; });
        thumb.appendChild(image);
      } else {
        thumb.innerHTML = ICONS[reference.kind] || ICONS.document;
      }
      thumb.addEventListener("click", function () { if (attachReference(reference)) { closePopovers(); elements.promptInput.focus(); } });
      var fields = document.createElement("div");
      fields.className = "reference-fields";
      var name = document.createElement("input");
      name.className = "reference-name";
      name.value = reference.name;
      name.maxLength = 120;
      name.setAttribute("aria-label", "Reference name");
      name.addEventListener("change", function () { referenceStore.update(reference.id, { name: name.value }); });
      var note = document.createElement("input");
      note.className = "reference-note";
      note.value = reference.note || "";
      note.maxLength = 2000;
      note.placeholder = "Note for the agent (e.g. match this typography)";
      note.setAttribute("aria-label", "Note for the agent");
      note.addEventListener("change", function () { referenceStore.update(reference.id, { note: note.value }); });
      fields.appendChild(name);
      fields.appendChild(note);
      var actions = document.createElement("div");
      actions.className = "reference-actions";
      var use = document.createElement("button");
      use.type = "button";
      use.textContent = "Use";
      use.title = "Attach to the message";
      use.addEventListener("click", function () { if (attachReference(reference)) { closePopovers(); elements.promptInput.focus(); } });
      var pin = document.createElement("button");
      pin.type = "button";
      pin.textContent = reference.pinned ? "Pinned" : "Pin";
      pin.title = "Send automatically at the start of every new chat";
      pin.setAttribute("aria-pressed", reference.pinned ? "true" : "false");
      pin.addEventListener("click", function () { referenceStore.update(reference.id, { pinned: !reference.pinned }); delete skippedPins[reference.id]; renderReferences(); });
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger";
      remove.textContent = "Delete";
      remove.title = "Delete this reference and its saved copy";
      remove.addEventListener("click", function () {
        if (remove.textContent !== "Sure?") { remove.textContent = "Sure?"; return; }
        referenceStore.remove(reference.id);
        renderReferences();
      });
      actions.appendChild(use);
      actions.appendChild(pin);
      actions.appendChild(remove);
      row.appendChild(thumb);
      row.appendChild(fields);
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  // ---------------------------------------------------------------------------
  // Ease curves: pick a preset or type a cubic-bezier, then apply it directly
  // to the selected keyframes or hand it to the agent.
  // ---------------------------------------------------------------------------

  var easeState = { name: "Easy Ease", bezier: [0.333, 0, 0.667, 1] };

  function easePath(bezier, size, top) {
    function y(value) { return top + size - value * size; }
    return "M0 " + y(0) + " C" + bezier[0] * size + " " + y(bezier[1]) + " " + bezier[2] * size + " " + y(bezier[3]) + " " + size + " " + y(1);
  }

  function renderEaseGraph() {
    var b = easeState.bezier;
    function y(value) { return 100 - value * 100; }
    document.getElementById("easeGraph").innerHTML =
      '<rect class="grid" x="0" y="0" width="100" height="100"/>' +
      '<line class="handle" x1="0" y1="100" x2="' + b[0] * 100 + '" y2="' + y(b[1]) + '"/>' +
      '<line class="handle" x1="100" y1="0" x2="' + b[2] * 100 + '" y2="' + y(b[3]) + '"/>' +
      '<circle class="dot" cx="' + b[0] * 100 + '" cy="' + y(b[1]) + '" r="3"/>' +
      '<circle class="dot" cx="' + b[2] * 100 + '" cy="' + y(b[3]) + '" r="3"/>' +
      '<path class="curve" d="' + easePath(b, 100, 0) + '"/>';
    document.getElementById("easeName").textContent = easeState.name;
    var input = document.getElementById("easeBezier");
    if (document.activeElement !== input) { input.value = b.map(function (n) { return +Number(n).toFixed(3); }).join(", "); }
    input.classList.remove("invalid");
    Array.prototype.forEach.call(document.querySelectorAll(".ease-chip"), function (chip) {
      chip.setAttribute("aria-pressed", chip.getAttribute("data-ease") === easeState.id ? "true" : "false");
    });
  }

  function selectEase(preset) {
    easeState = { id: preset.id, name: preset.name, bezier: preset.bezier.slice() };
    savePreference("aeAgent.ease", JSON.stringify(easeState));
    renderEaseGraph();
  }

  function renderEasePresets() {
    var container = document.getElementById("easePresets");
    container.innerHTML = "";
    window.AEEases.GROUPS.forEach(function (group) {
      var row = document.createElement("div");
      row.className = "ease-group";
      var title = document.createElement("span");
      title.textContent = group.name;
      var chips = document.createElement("div");
      group.presets.forEach(function (preset) {
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "ease-chip";
        chip.setAttribute("data-ease", preset.id);
        chip.title = preset.id + "  " + window.AEEases.format(preset.bezier);
        chip.innerHTML = '<svg viewBox="-8 -38 116 176" aria-hidden="true"><path d="' + easePath(preset.bezier, 100, 0) + '"/></svg>';
        chip.appendChild(document.createTextNode(preset.label));
        chip.addEventListener("click", function () { selectEase(preset); });
        chips.appendChild(chip);
      });
      row.appendChild(title);
      row.appendChild(chips);
      container.appendChild(row);
    });
    try {
      var saved = JSON.parse(readPreference("aeAgent.ease", "null"));
      if (saved && window.AEEases.parseBezier(saved.bezier)) { easeState = saved; }
    } catch (error) { /* keep the default */ }
    renderEaseGraph();
  }

  function applyEaseNow() {
    if (isBusy) { showBanner("Wait for the current request to finish.", "info"); return; }
    if (!cep) { showBanner("Open the panel inside " + HOST.name + " to apply eases."); return; }
    var bezier = easeState.bezier.slice();
    callAfterEffects("apply_ease_curve", { useSelectedKeys: true, bezier: bezier }, true).then(function (result) {
      var properties = result.data.properties || [];
      var segments = properties.reduce(function (total, property) { return total + property.segments.length; }, 0);
      var notes = [];
      if (properties.some(function (property) { return property.overshootClampedForSpatial; })) { notes.push("Position paths cannot overshoot through speed, so the overshoot was flattened there"); }
      if (properties.some(function (property) { return property.approximate; })) { notes.push("shape or custom properties get an approximate curve"); }
      if (result.undoable) { lastTurnMutations = 1; elements.undoButton.disabled = false; }
      showBanner("Applied " + easeState.name + " to " + segments + " segment" + (segments === 1 ? "" : "s") + " on " + properties.length + " propert" + (properties.length === 1 ? "y" : "ies") + "." + (notes.length ? " " + notes.join("; ") + "." : "") + " Undo with the revert arrow or Ctrl+Z in " + HOST.name + ".", "info");
    }).catch(function (error) {
      showBanner(error.message, /No keyframes are selected/.test(error.message) ? "info" : undefined);
    });
  }

  function askAgentForEase() {
    var text = L("Apply the ease ", "Aplique o ease ") + easeState.name + " — " + window.AEEases.format(easeState.bezier) + L(" — to the selected keyframes.", " — nos keyframes selecionados.");
    var current = elements.promptInput.value.replace(/\s+$/, "");
    elements.promptInput.value = current ? current + " " + text : text;
    closePopovers();
    resizePrompt();
    elements.promptInput.focus();
  }

  // ---------------------------------------------------------------------------
  // Settings → Voice & video.
  // ---------------------------------------------------------------------------

  function setMediaStatus(element, text, ok) {
    element.textContent = text;
    element.classList.toggle("ok", Boolean(ok));
  }

  function refreshMediaSettings() {
    var settings = transcriptionSettings();
    elements.sttEngine.value = settings.engine;
    elements.sttLanguage.value = settings.language;
    elements.sttModel.value = settings.model;
    elements.sttApiKey.value = settings.apiKey;
    elements.sttLocalSection.hidden = settings.engine !== "local";
    elements.sttApiSection.hidden = settings.engine === "local";
    elements.voiceAutoSend.checked = readPreference("aeAgent.voice.autoSend", "false") === "true";
    elements.videoFrames.value = readPreference("aeAgent.video.frames", "12");
    elements.videoTranscribe.checked = readPreference("aeAgent.video.transcribe", "true") === "true";
    if (!media) {
      [elements.whisperStatus, elements.modelStatus, elements.ffmpegStatus].forEach(function (element) { setMediaStatus(element, "Available inside the installed " + HOST.name + " panel.", false); });
      [elements.installWhisper, elements.downloadModel, elements.installFfmpeg].forEach(function (button) { button.disabled = true; });
      return;
    }
    var windows = window.AEPlatform.windows(node);
    var whisper = media.findWhisper();
    setMediaStatus(elements.whisperStatus, whisper ? "Installed" : (windows ? "Not installed (9 MB download)" : "Not found. In Terminal run: brew install whisper-cpp"), whisper);
    elements.installWhisper.textContent = whisper ? "Reinstall" : (windows ? "Install" : "How to");
    elements.installWhisper.disabled = mediaBusy || (Boolean(whisper) && !windows);
    var model = window.AEMedia.MODELS[settings.model] || window.AEMedia.MODELS.small;
    var modelFile = media.modelPath(settings.model);
    setMediaStatus(elements.modelStatus, modelFile ? model.label.split(" (")[0] + " downloaded" : "Not downloaded (" + model.megabytes + " MB)", modelFile);
    elements.downloadModel.textContent = modelFile ? "Downloaded" : "Download";
    elements.downloadModel.disabled = mediaBusy || Boolean(modelFile);
    var ffmpeg = media.findFfmpeg();
    setMediaStatus(elements.ffmpegStatus, ffmpeg ? "Installed" : "Not installed (about 25 MB). Needed for most video formats and for video audio.", ffmpeg);
    elements.installFfmpeg.textContent = ffmpeg ? "Installed" : "Install";
    elements.installFfmpeg.disabled = mediaBusy || Boolean(ffmpeg);
  }

  function runMediaDownload(label, task, doneMessage) {
    if (mediaBusy) { return; }
    mediaBusy = true;
    refreshMediaSettings();
    elements.mediaProgress.hidden = false;
    elements.mediaProgressLabel.textContent = label;
    elements.mediaProgressPercent.textContent = "";
    elements.mediaProgressBar.style.width = "0%";
    var lastUpdate = 0;
    task(function (received, total) {
      var now = Date.now();
      if (now - lastUpdate < 200 && received !== total) { return; }
      lastUpdate = now;
      var megabytes = (received / 1048576).toFixed(0) + (total ? " of " + (total / 1048576).toFixed(0) : "") + " MB";
      elements.mediaProgressPercent.textContent = megabytes;
      elements.mediaProgressBar.style.width = total ? Math.round(received / total * 100) + "%" : "40%";
    }).then(function () {
      elements.mediaProgressLabel.textContent = label.replace(/…$/, "") + " — done";
      elements.mediaProgressBar.style.width = "100%";
      if (doneMessage) { showBanner(doneMessage, "info"); }
      setTimeout(function () { elements.mediaProgress.hidden = true; }, 2500);
    }, function (error) {
      elements.mediaProgress.hidden = true;
      showBanner(error.message, /brew/.test(error.message) ? "info" : undefined);
    }).then(function () {
      mediaBusy = false;
      refreshMediaSettings();
    });
  }

  // One click on the microphone installs whatever local transcription still
  // needs (whisper.cpp on Windows, then the chosen model).
  function setupLocalVoice() {
    var settings = transcriptionSettings();
    var model = window.AEMedia.MODELS[settings.model] || window.AEMedia.MODELS.small;
    var steps = [];
    if (!media.findWhisper()) { steps.push({ label: "Installing whisper.cpp", run: function (progress) { return media.installWhisper(progress); } }); }
    if (!media.modelPath(settings.model)) { steps.push({ label: "Downloading the " + model.label.split(" (")[0] + " model", run: function (progress) { return media.installModel(settings.model, progress); } }); }
    if (!steps.length) { return; }
    openMediaSettings("Setting up voice transcription on this computer (one time, about " + (model.megabytes + (media.findWhisper() ? 0 : 9)) + " MB). Click the microphone again when it finishes.");
    runMediaDownload("Setting up voice…", function (progress) {
      return steps.reduce(function (chain, step, index) {
        return chain.then(function () {
          elements.mediaProgressLabel.textContent = step.label + " (" + (index + 1) + " of " + steps.length + ")…";
          return step.run(progress);
        });
      }, Promise.resolve());
    }, "Voice transcription is ready. Click the microphone to record.");
  }

  function openMediaSettings(message) {
    if (message) { showBanner(message, "info"); }
    selectSettingsTab("media");
    closePopovers();
    elements.settingsPopover.hidden = false;
    refreshMediaSettings();
  }

  function chooseRecorderMime() {
    var options = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
    for (var i = 0; i < options.length; i += 1) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(options[i])) {
        return options[i];
      }
    }
    return "";
  }

  function toggleRecording() {
    if (transcribing) { return; }
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      return;
    }
    startRecording();
  }

  function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      showBanner("This " + HOST.name + " panel cannot access the microphone. You can still use macOS Dictation in the message box (press the Dictation key twice).", "info");
      return;
    }
    var settings = transcriptionSettings();
    var problem = media ? media.transcriptionProblem(settings) : "Voice transcription needs the installed panel.";
    if (problem) {
      if (mediaBusy) {
        openMediaSettings("Voice transcription is still being set up. Click the microphone again when the download finishes.");
      } else if (media && settings.engine === "local" && (window.AEPlatform.windows(node) || media.findWhisper())) {
        setupLocalVoice();
      } else {
        openMediaSettings("Set up voice transcription first: " + problem);
      }
      return;
    }
    hideBanner();
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      mediaStream = stream;
      recordedChunks = [];
      var mime = chooseRecorderMime();
      mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      mediaRecorder.ondataavailable = function (event) {
        if (event.data && event.data.size > 0) {
          recordedChunks.push(event.data);
        }
      };
      mediaRecorder.onerror = function (event) {
        showBanner("Microphone recording failed: " + (event.error ? event.error.message : "unknown error"));
        stopMediaStream();
      };
      mediaRecorder.onstop = finishRecording;
      mediaRecorder.start(250);
      recordingStartedAt = Date.now();
      elements.micButton.classList.add("mic-recording");
      elements.micButton.title = "Stop recording";
      elements.recordingTimer.hidden = false;
      updateRecordingTimer();
      recordingTicker = setInterval(updateRecordingTimer, 250);
    }).catch(function (error) {
      showBanner("Microphone access was not granted. " + (window.AEPlatform.windows(node) ? "In Windows Settings → Privacy & security → Microphone, turn on access for desktop apps" : "Allow " + HOST.name + " under System Settings → Privacy & Security → Microphone") + ", then try again. " + error.message);
    });
  }

  function updateRecordingTimer() {
    var seconds = Math.floor((Date.now() - recordingStartedAt) / 1000);
    elements.recordingTimer.textContent = Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
    if (seconds >= 300 && mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
  }

  function setTranscribing(active) {
    transcribing = active;
    elements.micButton.disabled = active;
    elements.recordingTimer.hidden = !active;
    elements.recordingTimer.classList.toggle("transcribing", active);
    elements.recordingTimer.textContent = active ? "Transcribing…" : "0:00";
  }

  // The recording is converted to 16 kHz WAV, transcribed, and placed in the
  // message box so the user can review the text before it is sent.
  function finishRecording() {
    clearInterval(recordingTicker);
    recordingTicker = null;
    elements.micButton.classList.remove("mic-recording");
    elements.micButton.title = "Record a voice instruction (transcribed into the message box)";
    elements.recordingTimer.hidden = true;
    var mime = mediaRecorder.mimeType || "audio/webm";
    var blob = new Blob(recordedChunks, { type: mime });
    stopMediaStream();
    if (blob.size < 1000 || Date.now() - recordingStartedAt < 600) {
      showBanner("The recording was too short. Click the microphone, speak, then click it again to stop.", "info");
      return;
    }
    setTranscribing(true);
    var wavPath = null;
    new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error("Could not read the recording.")); };
      reader.readAsArrayBuffer(blob);
    }).then(decodeToWav).then(function (wav) {
      wavPath = writeWav(wav);
      return transcribeFile(wavPath, true);
    }).then(function (result) {
      safeRemove(wavPath);
      setTranscribing(false);
      var text = String(result.text || "").trim();
      if (!text) { showBanner("No speech was recognized. Check the microphone and the language in Settings → Voice & video.", "info"); return; }
      var current = elements.promptInput.value.replace(/\s+$/, "");
      elements.promptInput.value = current ? current + " " + text : text;
      resizePrompt();
      elements.promptInput.focus();
      if (readPreference("aeAgent.voice.autoSend", "false") === "true" && !isBusy) { sendMessage(); }
    }).catch(function (error) {
      if (wavPath) { safeRemove(wavPath); }
      setTranscribing(false);
      showBanner("Voice transcription failed: " + error.message);
    });
  }

  function stopMediaStream() {
    if (mediaStream) {
      mediaStream.getTracks().forEach(function (track) { track.stop(); });
      mediaStream = null;
    }
    mediaRecorder = null;
    recordedChunks = [];
  }

  function safeRemove(filePath) {
    if (!filePath || !node.fs) {
      return;
    }
    node.fs.unlink(filePath, function () {});
  }

  function cleanupOutgoingTemps() {
    outgoingTempFiles.forEach(safeRemove);
    outgoingTempFiles = [];
  }

  // The visible chat as plain text ("User: …" / "Assistant: …"), newest last, capped.
  function conversationHistory() {
    var lines = [];
    Array.prototype.forEach.call(elements.conversation.querySelectorAll("article.message"), function (article) {
      var body = article.querySelector(".message-body");
      var text = body ? body.textContent.trim() : "";
      if (text) { lines.push((article.classList.contains("user-message") ? "User: " : "Assistant: ") + text); }
    });
    return lines.join("\n\n").slice(-12000);
  }

  function resetChat() {
    if (isBusy) {
      showBanner("Wait for the current request to finish before starting a new chat.", "info");
      return;
    }
    client.threadId = null;
    activeAssistantMessages = {};
    activeToolEvents = {};
    skippedPins = {};
    chatTempFiles.forEach(safeRemove);
    chatTempFiles = [];
    elements.conversation.innerHTML = welcomeMarkup;
    wireSuggestionButtons();
    hideBanner();
  }

  function wireSuggestionButtons() {
    var suggestions = document.querySelectorAll(".suggestion");
    Array.prototype.forEach.call(suggestions, function (button) {
      button.addEventListener("click", function () {
        elements.promptInput.value = button.textContent;
        resizePrompt();
        elements.promptInput.focus();
      });
    });
  }

  function bootstrap() {
    if (!nodeRequire || !cep) {
      setConnectionState("error", "Open inside " + HOST.name + "");
      renderAccount(null, true);
      showBanner("Install this folder as a CEP extension, restart " + HOST.name + ", then open Window → Extensions → Soma Agente.", "info");
      return Promise.resolve();
    }
    setConnectionState("starting", "Starting " + providerLabel() + "…");
    return client.start().then(function () {
      return Promise.all([client.refreshAccount(), client.loadModels()]);
    }).catch(function (error) {
      setConnectionState("error", providerLabel() + " unavailable");
      renderAccount(null, true);
      connectionDiagnostics.claude = client.binary ? error.message : missingMessage();
      elements.openaiDiagnosticSummary.textContent = client.binary ? "Could not start" : "Not found";
      renderDiagnosticReport();
      showBanner(connectionDiagnostics.claude, client.binary ? undefined : "info");
    });
  }

  elements.accountButton.addEventListener("click", function () {
    if (!client.ready) {
      var finders = { claude: "findClaudeBinary", chatgpt: "findCodexBinary", antigravity: "findAgyBinary" };
      if (!window.AEPlatform[finders[provider]](node)) { installAgentCli(); return; }
      bootstrap();
      return;
    }
    if (client.account) {
      showBanner("Your " + providerLabel() + " account is connected. Account details are hidden.", "info");
      return;
    }
    client.login().catch(function (error) {
      showBanner("Sign-in could not start: " + error.message);
    });
  });
  elements.runDiagnostics.addEventListener("click", runConnectionDiagnostics);
  elements.copyDiagnostics.addEventListener("click", copyDiagnosticReport);

  elements.editModeButton.addEventListener("click", function () { setChatMode("edit"); });
  elements.toolModeButton.addEventListener("click", function () { setChatMode("tools"); setToolPhase(toolPhase); });
  elements.planToolButton.addEventListener("click", function () { setToolPhase("plan"); });
  elements.buildToolButton.addEventListener("click", function () { setToolPhase("build"); });
  elements.showDraftButton.addEventListener("click", function () { if (latestToolDraft) { dock.open(latestToolDraft, true); } });
  elements.createToolButton.addEventListener("click", function () { setChatMode("tools"); setToolPhase("plan"); elements.promptInput.focus(); });
  elements.undoButton.addEventListener("click", revertLastRun);
  document.getElementById("newChatButton").addEventListener("click", resetChat);
  elements.modelButton.addEventListener("click", function (event) {
    event.stopPropagation();
    togglePopover(elements.modelPopover);
  });
  elements.settingsButton.addEventListener("click", function (event) {
    event.stopPropagation();
    togglePopover(elements.settingsPopover);
  });
  elements.closeSettings.addEventListener("click", closePopovers);
  elements.modelPopover.addEventListener("click", function (event) { event.stopPropagation(); });
  elements.settingsPopover.addEventListener("click", function (event) { event.stopPropagation(); });
  Array.prototype.forEach.call(document.querySelectorAll(".color-swatch"), function (swatch) {
    swatch.addEventListener("click", function () {
      applyAccent(swatch.getAttribute("data-color"));
    });
  });
  var uiLanguage = document.getElementById("uiLanguage");
  uiLanguage.value = window.SomaI18n.choice;
  uiLanguage.addEventListener("change", function () {
    window.SomaI18n.setChoice(uiLanguage.value);
    window.location.reload();
  });
  elements.accentInput.addEventListener("change", function () { if (!applyAccent(elements.accentInput.value)) { showBanner("Enter a color as six hex digits, for example #ef4444."); } });
  elements.accentInput.addEventListener("keydown", function (event) { if (event.key === "Enter") { event.preventDefault(); elements.accentInput.blur(); } });
  elements.resetAccentButton.addEventListener("click", function () { applyAccent(defaultAccent); });
  Array.prototype.forEach.call(document.querySelectorAll("[data-settings-tab]"), function (button) {
    button.addEventListener("click", function () { selectSettingsTab(button.getAttribute("data-settings-tab")); });
  });
  elements.persistentInstructions.value = readPreference("aeAgent.persistentInstructions", "");
  elements.saveInstructions.addEventListener("click", function () {
    savePreference("aeAgent.persistentInstructions", elements.persistentInstructions.value.trim());
    client.threadId = null;
    elements.instructionsStatus.textContent = "Saved. New requests will use these instructions.";
  });
  elements.openToolsFolder.addEventListener("click", function () { openLocalFolder(libraryDirectory); });
  elements.openExportsFolder.addEventListener("click", function () { openLocalFolder(exportDirectory); });
  elements.dockPosition.addEventListener("change", function () { savePreference("aeAgent.dockPosition", elements.dockPosition.value); applyDockPreferences(); });
  elements.dockSize.addEventListener("change", function () { savePreference("aeAgent.dockSize", elements.dockSize.value); applyDockPreferences(); });
  elements.dockLabels.addEventListener("change", function () { savePreference("aeAgent.dockLabels", String(elements.dockLabels.checked)); applyDockPreferences(); });
  document.addEventListener("click", closePopovers);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closePopovers();
    }
  });
  elements.attachButton.addEventListener("click", function () { elements.imageInput.click(); });
  elements.imageInput.addEventListener("change", function () {
    Array.prototype.forEach.call(elements.imageInput.files || [], addFile);
    elements.imageInput.value = "";
  });
  elements.referencesButton.addEventListener("click", function (event) {
    event.stopPropagation();
    togglePopover(elements.referencesPopover);
  });
  elements.referencesPopover.addEventListener("click", function (event) { event.stopPropagation(); });
  elements.addReferenceButton.addEventListener("click", function () {
    if (!referenceStore) { showBanner("References are available inside the installed " + HOST.name + " panel."); return; }
    elements.referenceInput.click();
  });
  elements.referenceInput.addEventListener("change", function () {
    var files = Array.prototype.slice.call(elements.referenceInput.files || []);
    elements.referenceInput.value = "";
    addReferenceFiles(files);
  });
  elements.sttEngine.addEventListener("change", function () { savePreference("aeAgent.stt.engine", elements.sttEngine.value); refreshMediaSettings(); });
  elements.sttLanguage.addEventListener("change", function () { savePreference("aeAgent.stt.language", elements.sttLanguage.value); });
  elements.sttModel.addEventListener("change", function () { savePreference("aeAgent.stt.model", elements.sttModel.value); refreshMediaSettings(); });
  elements.sttApiKey.addEventListener("change", function () { savePreference("aeAgent.stt.key." + elements.sttEngine.value, elements.sttApiKey.value.trim()); });
  elements.voiceAutoSend.addEventListener("change", function () { savePreference("aeAgent.voice.autoSend", String(elements.voiceAutoSend.checked)); });
  elements.videoFrames.addEventListener("change", function () { savePreference("aeAgent.video.frames", elements.videoFrames.value); });
  elements.videoTranscribe.addEventListener("change", function () { savePreference("aeAgent.video.transcribe", String(elements.videoTranscribe.checked)); });
  elements.installWhisper.addEventListener("click", function () {
    if (!media) { return; }
    if (!window.AEPlatform.windows(node)) {
      showBanner("On macOS, open Terminal and run:  brew install whisper-cpp  (needs Homebrew from brew.sh). Then click Check again.", "info");
      return;
    }
    runMediaDownload("Installing whisper.cpp…", function (progress) { return media.installWhisper(progress); });
  });
  elements.downloadModel.addEventListener("click", function () {
    if (!media) { return; }
    var name = elements.sttModel.value;
    runMediaDownload("Downloading the " + window.AEMedia.MODELS[name].label.split(" (")[0] + " model…", function (progress) { return media.installModel(name, progress); });
  });
  elements.installFfmpeg.addEventListener("click", function () {
    if (!media) { return; }
    runMediaDownload("Installing FFmpeg…", function (progress) { return media.installFfmpeg(progress); });
  });
  elements.checkMedia.addEventListener("click", refreshMediaSettings);
  elements.openMediaFolder.addEventListener("click", function () { if (media) { node.fs.mkdirSync(media.dataDirectory, { recursive: true }); openLocalFolder(media.dataDirectory); } });
  Object.keys(window.AEMedia.MODELS).forEach(function (name) {
    var option = document.createElement("option");
    option.value = name;
    option.textContent = window.AEMedia.MODELS[name].label;
    elements.sttModel.appendChild(option);
  });
  var easePopover = document.getElementById("easePopover");
  document.getElementById("easeButton").addEventListener("click", function (event) {
    event.stopPropagation();
    togglePopover(easePopover);
  });
  easePopover.addEventListener("click", function (event) { event.stopPropagation(); });
  document.getElementById("easeApply").addEventListener("click", applyEaseNow);
  document.getElementById("easeAsk").addEventListener("click", askAgentForEase);
  document.getElementById("easeBezier").addEventListener("input", function (event) {
    var bezier = window.AEEases.parseBezier(event.target.value);
    event.target.classList.toggle("invalid", !bezier);
    if (!bezier) { return; }
    var preset = window.AEEases.match(bezier);
    easeState = { id: preset ? preset.id : null, name: preset ? preset.name : "Custom", bezier: bezier };
    savePreference("aeAgent.ease", JSON.stringify(easeState));
    renderEaseGraph();
  });
  renderEasePresets();
  elements.micButton.addEventListener("click", toggleRecording);
  elements.sendButton.addEventListener("click", sendMessage);
  elements.promptInput.addEventListener("input", resizePrompt);
  elements.promptInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!isBusy) { sendMessage(); }
    }
  });
  // Files can be dropped anywhere on the panel.
  document.addEventListener("dragover", function (event) { event.preventDefault(); });
  document.addEventListener("drop", function (event) {
    event.preventDefault();
    Array.prototype.forEach.call(event.dataTransfer.files || [], addFile);
  });
  document.addEventListener("paste", function (event) {
    var files = (event.clipboardData && event.clipboardData.files) || [];
    if (files.length) { event.preventDefault(); }
    Array.prototype.forEach.call(files, addFile);
  });
  window.addEventListener("beforeunload", function () {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
    attachments.filter(function (item) { return item.temp; }).forEach(function (item) { safeRemove(item.path); });
    chatTempFiles.forEach(safeRemove);
    cleanupOutgoingTemps();
    client.stop();
  });

  wireSuggestionButtons();
  Array.prototype.forEach.call(document.querySelectorAll("[data-provider-choice]"), function (button) {
    button.addEventListener("click", function (event) { event.stopPropagation(); switchProvider(button.getAttribute("data-provider-choice")); });
  });
  renderProvider();
  // The pre-Soma default orange is replaced by the brand pink.
  var savedAccent = readPreference("aeAgent.accent", defaultAccent);
  applyAccent(savedAccent === "#d97757" ? defaultAccent : savedAccent) || applyAccent(defaultAccent);
  resizePrompt();
  wireExtensions();
  bootstrap();
  document.getElementById("checkUpdates").addEventListener("click", function () {
    document.getElementById("updateStatus").textContent = L("Checking GitHub…", "Verificando no GitHub…");
    checkHubUpdate(true);
  });
  document.getElementById("installUpdate").addEventListener("click", installUpdate);
  setTimeout(checkHubUpdate, 3000);
  setInterval(checkHubUpdate, 3 * 60 * 60 * 1000);
}());
