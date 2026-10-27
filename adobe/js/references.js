(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.AEReferences = api;
}(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  // Saved references: images, videos, audio, and documents copied into the
  // panel's data folder so they survive moving or deleting the originals.
  // Pinned references are attached automatically at the start of every chat.

  var TYPES = {
    image: /\.(png|jpe?g|gif|webp|bmp|tiff?|avif|heic|psd|exr|tga)$/i,
    video: /\.(mp4|mov|m4v|webm|mkv|avi|mxf|wmv|mpe?g|gif)$/i,
    audio: /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|aiff?|wma)$/i,
    document: /\.(pdf|txt|md|markdown|json|csv|tsv|srt|vtt|xml|html?|css|jsx?|tsx?|py|jsxbin|ass|rtf)$/i
  };

  function kindForName(name, mime) {
    mime = String(mime || "");
    if (/^image\/gif$/i.test(mime) || /\.gif$/i.test(name)) { return "image"; }
    if (/^image\//i.test(mime) || TYPES.image.test(name)) { return "image"; }
    if (/^video\//i.test(mime) || TYPES.video.test(name)) { return "video"; }
    if (/^audio\//i.test(mime) || TYPES.audio.test(name)) { return "audio"; }
    if (/^text\/|application\/(pdf|json|xml)/i.test(mime) || TYPES.document.test(name)) { return "document"; }
    return null;
  }

  function Store(n, directory) {
    this.n = n;
    this.directory = directory;
    this.file = n.path.join(directory, "references.json");
    this.items = [];
  }

  Store.prototype.load = function () {
    var n = this.n;
    try {
      var data = JSON.parse(n.fs.readFileSync(this.file, "utf8"));
      this.items = (data.items || []).filter(function (item) { return item && item.id && item.file; });
    } catch (error) {
      this.items = [];
      if (error.code !== "ENOENT") { throw error; }
    }
    return this.items;
  };

  Store.prototype.save = function () {
    var n = this.n;
    n.fs.mkdirSync(this.directory, { recursive: true });
    var temp = this.file + ".tmp";
    n.fs.writeFileSync(temp, JSON.stringify({ version: 1, items: this.items }, null, 2), "utf8");
    n.fs.renameSync(temp, this.file);
  };

  Store.prototype.path = function (item, key) {
    return item && item[key || "file"] ? this.n.path.join(this.directory, item[key || "file"]) : null;
  };

  Store.prototype.get = function (id) {
    for (var i = 0; i < this.items.length; i += 1) { if (this.items[i].id === id) { return this.items[i]; } }
    return null;
  };

  // source: absolute path of the file to copy. extra: { name, kind, note, posterData (base64 JPEG) }
  Store.prototype.add = function (source, extra) {
    var n = this.n;
    extra = extra || {};
    var id = Date.now().toString(36) + n.crypto.randomBytes(4).toString("hex");
    var ext = n.path.extname(source).toLowerCase() || "";
    var file = id + ext;
    n.fs.mkdirSync(this.directory, { recursive: true });
    n.fs.copyFileSync(source, n.path.join(this.directory, file));
    var item = {
      id: id,
      name: String(extra.name || n.path.basename(source)).slice(0, 120),
      kind: extra.kind || kindForName(source) || "document",
      file: file,
      note: String(extra.note || "").slice(0, 2000),
      pinned: false,
      addedAt: new Date().toISOString()
    };
    if (extra.posterData) {
      item.poster = id + "-poster.jpg";
      n.fs.writeFileSync(n.path.join(this.directory, item.poster), n.Buffer.from(extra.posterData, "base64"));
    }
    this.items.unshift(item);
    this.save();
    return item;
  };

  Store.prototype.update = function (id, patch) {
    var item = this.get(id);
    if (!item) { return null; }
    if (patch.name !== undefined) { item.name = String(patch.name).trim().slice(0, 120) || item.name; }
    if (patch.note !== undefined) { item.note = String(patch.note).slice(0, 2000); }
    if (patch.pinned !== undefined) { item.pinned = Boolean(patch.pinned); }
    this.save();
    return item;
  };

  Store.prototype.setPoster = function (id, posterData) {
    var item = this.get(id);
    if (!item) { return null; }
    item.poster = id + "-poster.jpg";
    this.n.fs.writeFileSync(this.n.path.join(this.directory, item.poster), this.n.Buffer.from(posterData, "base64"));
    this.save();
    return item;
  };

  Store.prototype.remove = function (id) {
    var n = this.n, self = this, item = this.get(id);
    if (!item) { return; }
    this.items = this.items.filter(function (entry) { return entry.id !== id; });
    this.save();
    ["file", "poster"].forEach(function (key) {
      var file = self.path(item, key);
      if (file) { try { n.fs.unlinkSync(file); } catch (error) { /* already gone */ } }
    });
  };

  Store.prototype.pinned = function () {
    return this.items.filter(function (item) { return item.pinned; });
  };

  return { Store: Store, kindForName: kindForName };
}));
