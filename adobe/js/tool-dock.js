(function (root) {
  "use strict";
  root.AEToolDock = function (store, services) {
    var selectedId = null;
    var inputs = {};
    var busy = false;
    var lastFocus = null;
    var draft = null;
    var draggedId = null;
    var suppressClickUntil = 0;
    function el(id) { return document.getElementById(id); }
    function selected() { return draft || store.items.find(function (tool) { return tool.id === selectedId; }); }
    function attempt(action) { try { action(); } catch (error) { services.error(error.message); } }
    function close() { el("toolDrawer").hidden = true; if (lastFocus) { lastFocus.focus(); } }
    function readValues() {
      var values = {};
      selected().options.forEach(function (field) { values[field.key] = field.type === "boolean" ? inputs[field.key].checked : inputs[field.key].value; });
      return root.AEToolLibrary.values(selected(), values);
    }
    function syncAppearanceChoices(tool) {
      Array.prototype.forEach.call(el("toolIconGrid").querySelectorAll(".icon-choice"), function (button) {
        button.classList.toggle("selected", button.getAttribute("data-icon") === tool.icon);
        button.setAttribute("aria-pressed", button.getAttribute("data-icon") === tool.icon ? "true" : "false");
      });
      Array.prototype.forEach.call(el("toolDrawer").querySelectorAll(".tool-color-swatch"), function (button) {
        button.classList.toggle("selected", button.getAttribute("data-tool-color").toLowerCase() === tool.color.toLowerCase());
      });
    }
    function open(tool, previewOnly) {
      draft = previewOnly ? tool : null;
      selectedId = tool.id;
      lastFocus = document.activeElement;
      inputs = {};
      el("toolDrawerTitle").textContent = previewOnly ? tool.name + " — interface preview" : "Customize “" + tool.name + "”";
      el("toolDescription").textContent = previewOnly ? (tool.description || "Non-executable tool preview.") : "Change how this tool appears in the dock and choose its default values. Left-click its dock icon to use the native tool.";
      el("toolRunStatus").textContent = "";
      el("toolName").value = tool.name;
      el("toolIcon").value = tool.icon;
      el("toolColor").value = tool.color;
      syncAppearanceChoices(tool);
      el("toolSource").textContent = tool.code || "";
      el("toolDrawer").classList.toggle("draft-preview", !!previewOnly);
      el("toolDrawer").classList.toggle("customize-view", !previewOnly);
      el("toolOptionsHeading").textContent = previewOnly ? "Interface preview" : "Default options";
      el("runSavedTool").textContent = previewOnly ? "Layout preview — no action runs" : (tool.actionLabel || "Run tool");
      el("runSavedTool").hidden = !previewOnly;
      el("openNativeTool").hidden = !!previewOnly;
      el("exportTool").hidden = !!previewOnly;
      el("toolDrawer").querySelector(".tool-customize").hidden = !!previewOnly;
      el("toolDrawer").querySelector(".tool-source").hidden = true;
      el("toolOptionFields").innerHTML = "";
      tool.options.forEach(function (field) {
        if (field.group && !el("toolOptionFields").querySelector('[data-option-group="' + field.key + '"]') && (!tool.options[tool.options.indexOf(field) - 1] || tool.options[tool.options.indexOf(field) - 1].group !== field.group)) {
          var heading = document.createElement("h3"); heading.textContent = field.group; el("toolOptionFields").appendChild(heading);
        }
        var label = document.createElement("label");
        label.textContent = field.label;
        var input = document.createElement(field.type === "select" ? "select" : "input");
        if (field.type === "select") {
          field.choices.forEach(function (choice) { var option = document.createElement("option"); option.value = choice; option.textContent = choice; input.appendChild(option); });
        } else {
          input.type = field.type === "boolean" ? "checkbox" : field.type;
        }
        input.value = field.defaultValue;
        if (field.type === "boolean") { input.checked = field.defaultValue; }
        if (field.type === "number") {
          input.step = field.step || "any";
          if (field.min !== undefined) { input.min = field.min; }
          if (field.max !== undefined) { input.max = field.max; }
          input.required = true;
        }
        input.setAttribute("aria-label", field.label);
        input.title = field.help || field.label;
        label.appendChild(input); el("toolOptionFields").appendChild(label); inputs[field.key] = input;
      });
      el("toolDrawer").hidden = false;
      setBusy(busy);
      el("closeToolDrawer").focus();
    }
    function render() {
      var list = el("toolDockList"); list.innerHTML = "";
      store.items.forEach(function (tool) {
        var button = document.createElement("button");
        button.type = "button"; button.className = "dock-button";
        button.style.setProperty("--tool-color", tool.color);
        button.dataset.toolId = tool.id;
        var symbol = document.createElement("span"); symbol.textContent = root.AEToolLibrary.icons[tool.icon]; button.appendChild(symbol);
        var label = document.createElement("span"); label.className = "dock-tool-name"; label.textContent = tool.name; button.appendChild(label);
        button.title = tool.name + " — " + (tool.description || "Open in After Effects") + "\nRight-click to customize. Drag to reorder.";
        button.setAttribute("aria-label", tool.name + " — open in After Effects");
        button.draggable = true;
        button.addEventListener("click", function (event) { if (busy || draggedId || Date.now() < suppressClickUntil) { return; } if (event.shiftKey) { open(tool); } else { services.launch(tool); } });
        button.addEventListener("contextmenu", function (event) { event.preventDefault(); open(tool); });
        button.addEventListener("keydown", function (event) {
          if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown") && !busy) {
            event.preventDefault(); attempt(function () { store.move(tool.id, event.key === "ArrowUp" ? -1 : 1); render(); if (services.changed) { services.changed(); } });
          }
        });
        button.addEventListener("dragstart", function (event) {
          if (busy) { event.preventDefault(); return; }
          draggedId = tool.id; event.dataTransfer.setData("application/x-ae-tool-id", tool.id); event.dataTransfer.effectAllowed = "move"; button.classList.add("dragging");
        });
        button.addEventListener("dragover", function (event) {
          if (!busy && draggedId && draggedId !== tool.id) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; button.classList.add("drop-target"); }
        });
        button.addEventListener("dragleave", function () { button.classList.remove("drop-target"); });
        button.addEventListener("drop", function (event) {
          event.preventDefault(); button.classList.remove("drop-target");
          if (!busy && draggedId) { var id = draggedId; draggedId = null; attempt(function () { store.moveTo(id, tool.id); render(); if (services.changed) { services.changed(); } }); }
        });
        button.addEventListener("dragend", function () { draggedId = null; suppressClickUntil = Date.now() + 250; render(); });
        list.appendChild(button);
      });
    }
    function setBusy(value) {
      busy = value;
      ["runSavedTool", "saveToolAppearance", "editToolInChat", "removeTool", "openNativeTool", "exportTool"].forEach(function (id) { el(id).disabled = value || !!draft; });
    }
    Object.keys(root.AEToolLibrary.icons).forEach(function (icon) {
      var option = document.createElement("option"); option.value = icon; option.textContent = root.AEToolLibrary.icons[icon] + " " + icon; el("toolIcon").appendChild(option);
      var button = document.createElement("button"); button.type = "button"; button.className = "icon-choice"; button.textContent = root.AEToolLibrary.icons[icon]; button.title = icon; button.setAttribute("data-icon", icon); button.setAttribute("aria-label", icon + " icon");
      button.addEventListener("click", function () { el("toolIcon").value = icon; syncAppearanceChoices(Object.assign({}, selected(), { icon: icon, color: el("toolColor").value })); });
      el("toolIconGrid").appendChild(button);
    });
    Array.prototype.forEach.call(el("toolDrawer").querySelectorAll(".tool-color-swatch"), function (button) {
      button.addEventListener("click", function () { el("toolColor").value = button.getAttribute("data-tool-color"); syncAppearanceChoices(Object.assign({}, selected(), { icon: el("toolIcon").value, color: el("toolColor").value })); });
    });
    el("toolColor").addEventListener("input", function () { syncAppearanceChoices(Object.assign({}, selected(), { icon: el("toolIcon").value, color: el("toolColor").value })); });
    el("closeToolDrawer").addEventListener("click", close);
    el("toolDrawer").addEventListener("keydown", function (event) {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      // Keep ordinary keyboard navigation inside the full-panel drawer, but never
      // swallow macOS/system shortcuts such as Command+Tab or Option+Tab.
      if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        var nodes = Array.prototype.filter.call(el("toolDrawer").querySelectorAll("button, input, select, summary"), function (node) { return !node.disabled && node.getClientRects().length; });
        var first = nodes[0]; var last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    el("toolForm").addEventListener("submit", function (event) {
      event.preventDefault(); if (busy || draft) { return; }
      attempt(function () {
        var tool = selected(); var values = readValues();
        close(); services.run(tool, values);
      });
    });
    el("saveToolAppearance").addEventListener("click", function () {
      if (busy) { return; }
      attempt(function () {
        var tool = selected(); var values = readValues();
        var definition = Object.assign({}, tool, { name: el("toolName").value, icon: el("toolIcon").value, color: el("toolColor").value });
        definition.options = tool.options.map(function (field) { return Object.assign({}, field, { defaultValue: values[field.key] }); });
        var saved = store.save(definition); render(); if (services.changed) { services.changed(); } open(saved); el("toolRunStatus").textContent = "Appearance and defaults saved.";
      });
    });
    el("editToolInChat").addEventListener("click", function () { if (!busy) { var tool = selected(); close(); services.edit(tool); } });
    el("removeTool").addEventListener("click", function () {
      if (busy) { return; }
      attempt(function () { store.remove(selectedId); close(); render(); if (services.changed) { services.changed(); } services.removed(); });
    });
    el("openNativeTool").addEventListener("click", function () { if (!busy && !draft) { var tool = selected(); close(); services.launch(tool); } });
    el("exportTool").addEventListener("click", function () { if (!busy && !draft) { services.export(selected()); } });
    render();
    return { render: render, open: open, close: close, setBusy: setBusy };
  };
}(window));
