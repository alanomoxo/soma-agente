(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.AEEases = api;
}(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  // Ease presets as CSS cubic-bezier(x1, y1, x2, y2) curves, the notation used
  // by easings.net, Flow, and the CSS spec. host.jsx converts them into After
  // Effects speed and influence for each keyframe segment.
  var GROUPS = [
    { name: "After Effects", presets: [
      { id: "easyEase", label: "Easy Ease", bezier: [0.333, 0, 0.667, 1] },
      { id: "easyEaseOut", label: "Easy Ease Out", bezier: [0.333, 0, 1, 1] },
      { id: "easyEaseIn", label: "Easy Ease In", bezier: [0, 0, 0.667, 1] },
      { id: "linear", label: "Linear", bezier: [0, 0, 1, 1] }
    ] },
    { name: "Motion design", presets: [
      { id: "smooth", label: "Smooth", bezier: [0.45, 0, 0.15, 1] },
      { id: "snappy", label: "Snappy", bezier: [0.2, 0.9, 0.1, 1] },
      { id: "punchy", label: "Punchy (strong out)", bezier: [0.05, 0.7, 0.1, 1] },
      { id: "anticipate", label: "Anticipate", bezier: [0.6, -0.28, 0.735, 0.045] },
      { id: "overshoot", label: "Overshoot", bezier: [0.34, 1.56, 0.64, 1] }
    ] },
    { name: "Sine", presets: [
      { id: "easeInSine", label: "In", bezier: [0.12, 0, 0.39, 0] },
      { id: "easeOutSine", label: "Out", bezier: [0.61, 1, 0.88, 1] },
      { id: "easeInOutSine", label: "In Out", bezier: [0.37, 0, 0.63, 1] }
    ] },
    { name: "Quad", presets: [
      { id: "easeInQuad", label: "In", bezier: [0.11, 0, 0.5, 0] },
      { id: "easeOutQuad", label: "Out", bezier: [0.5, 1, 0.89, 1] },
      { id: "easeInOutQuad", label: "In Out", bezier: [0.45, 0, 0.55, 1] }
    ] },
    { name: "Cubic", presets: [
      { id: "easeInCubic", label: "In", bezier: [0.32, 0, 0.67, 0] },
      { id: "easeOutCubic", label: "Out", bezier: [0.33, 1, 0.68, 1] },
      { id: "easeInOutCubic", label: "In Out", bezier: [0.65, 0, 0.35, 1] }
    ] },
    { name: "Quart", presets: [
      { id: "easeInQuart", label: "In", bezier: [0.5, 0, 0.75, 0] },
      { id: "easeOutQuart", label: "Out", bezier: [0.25, 1, 0.5, 1] },
      { id: "easeInOutQuart", label: "In Out", bezier: [0.76, 0, 0.24, 1] }
    ] },
    { name: "Quint", presets: [
      { id: "easeInQuint", label: "In", bezier: [0.64, 0, 0.78, 0] },
      { id: "easeOutQuint", label: "Out", bezier: [0.22, 1, 0.36, 1] },
      { id: "easeInOutQuint", label: "In Out", bezier: [0.83, 0, 0.17, 1] }
    ] },
    { name: "Expo", presets: [
      { id: "easeInExpo", label: "In", bezier: [0.7, 0, 0.84, 0] },
      { id: "easeOutExpo", label: "Out", bezier: [0.16, 1, 0.3, 1] },
      { id: "easeInOutExpo", label: "In Out", bezier: [0.87, 0, 0.13, 1] }
    ] },
    { name: "Circ", presets: [
      { id: "easeInCirc", label: "In", bezier: [0.55, 0, 1, 0.45] },
      { id: "easeOutCirc", label: "Out", bezier: [0, 0.55, 0.45, 1] },
      { id: "easeInOutCirc", label: "In Out", bezier: [0.85, 0, 0.15, 1] }
    ] },
    { name: "Back", presets: [
      { id: "easeInBack", label: "In", bezier: [0.36, 0, 0.66, -0.56] },
      { id: "easeOutBack", label: "Out", bezier: [0.34, 1.56, 0.64, 1] },
      { id: "easeInOutBack", label: "In Out", bezier: [0.68, -0.6, 0.32, 1.6] }
    ] }
  ];

  var BY_ID = {};
  GROUPS.forEach(function (group) {
    group.presets.forEach(function (preset) {
      // "In" / "Out" chips read as "Expo Out" outside their row.
      preset.name = /^(In|Out|In Out)$/.test(preset.label) ? group.name + " " + preset.label : preset.label;
      BY_ID[preset.id.toLowerCase()] = preset;
    });
  });

  function find(id) {
    return BY_ID[String(id || "").replace(/[\s_-]/g, "").toLowerCase()] || null;
  }

  function match(bezier) {
    var key = bezier.join();
    for (var id in BY_ID) { if (BY_ID[id].bezier.join() === key) { return BY_ID[id]; } }
    return null;
  }

  // Accepts "cubic-bezier(.17,.67,.83,.67)", ".17, .67, .83, .67" or an array.
  function parseBezier(value) {
    var numbers = value instanceof Array ? value : String(value || "").replace(/cubic-bezier/i, "").match(/-?\d*\.?\d+(?:e-?\d+)?/gi);
    if (!numbers || numbers.length !== 4) { return null; }
    var bezier = numbers.map(Number);
    if (bezier.some(isNaN) || bezier[0] < 0 || bezier[0] > 1 || bezier[2] < 0 || bezier[2] > 1) { return null; }
    return bezier;
  }

  function format(bezier) {
    return "cubic-bezier(" + bezier.map(function (n) { return +Number(n).toFixed(3); }).join(", ") + ")";
  }

  return { GROUPS: GROUPS, find: find, match: match, parseBezier: parseBezier, format: format, ids: Object.keys(BY_ID).map(function (key) { return BY_ID[key].id; }) };
}));
