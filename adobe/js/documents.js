(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  root.SomaDocuments = api;
}(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  // Text of attached documents without third-party libraries (mirrors
  // python/soma_core/attachments.py): Word, PowerPoint and Excel (.docx/.pptx/.xlsx),
  // OpenDocument (.odt/.odp/.ods), RTF, HTML, plain text, and the text of PDFs for
  // the AIs that cannot read PDF files (Claude reads them whole).

  var OFFICE = /\.(docx|pptx|xlsx|odt|odp|ods)$/i;

  function entities(text) {
    return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (m, d) { return String.fromCodePoint(parseInt(d, 10)); })
      .replace(/&#x([0-9a-f]+);/gi, function (m, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&amp;/g, "&");
  }

  // A minimal zip reader: the central directory, then stored or deflated entries.
  function unzip(n, file) {
    var buf = n.fs.readFileSync(file), eocd = -1, entries = {};
    for (var i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
      if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) { throw new Error("not a valid Office file"); }
    var count = buf.readUInt16LE(eocd + 10), offset = buf.readUInt32LE(eocd + 16);
    for (var k = 0; k < count && buf.readUInt32LE(offset) === 0x02014b50; k += 1) {
      var nameLength = buf.readUInt16LE(offset + 28);
      entries[buf.toString("utf8", offset + 46, offset + 46 + nameLength)] = {
        method: buf.readUInt16LE(offset + 10), size: buf.readUInt32LE(offset + 20), local: buf.readUInt32LE(offset + 42)
      };
      offset += 46 + nameLength + buf.readUInt16LE(offset + 30) + buf.readUInt16LE(offset + 32);
    }
    return {
      names: Object.keys(entries),
      read: function (name) {
        var entry = entries[name];
        if (!entry) { return ""; }
        var start = entry.local + 30 + buf.readUInt16LE(entry.local + 26) + buf.readUInt16LE(entry.local + 28);
        var data = buf.slice(start, start + entry.size);
        return (entry.method === 8 ? n.zlib.inflateRawSync(data) : data).toString("utf8");
      }
    };
  }

  function number(name) { var found = String(name).match(/\d+/g); return found ? parseInt(found[found.length - 1], 10) : 0; }

  // One line per paragraph: the text runs inside each paragraph element.
  function paragraphs(xml, paragraph, run) {
    var lines = [];
    xml.split(new RegExp("</" + paragraph + ">")).forEach(function (chunk) {
      var text = "", re = new RegExp("<" + run + "(?:\\s[^>]*)?>([^<]*)</" + run + ">", "g"), m;
      while ((m = re.exec(chunk))) { text += m[1]; }
      text = entities(text).trim();
      if (text) { lines.push(text); }
    });
    return lines.join("\n");
  }

  function xlsx(zip) {
    var shared = [], out = [];
    zip.read("xl/sharedStrings.xml").split("</si>").forEach(function (item) {
      var text = "", re = /<t(?:\s[^>]*)?>([^<]*)<\/t>/g, m;
      while ((m = re.exec(item))) { text += m[1]; }
      shared.push(entities(text));
    });
    zip.names.filter(function (name) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(name); }).sort(function (a, b) { return number(a) - number(b); }).forEach(function (name) {
      out.push("## Sheet " + number(name));
      zip.read(name).split("</row>").forEach(function (row) {
        var cells = [], re = /<c\b([^>]*)>([\s\S]*?)<\/c>/g, m;
        while ((m = re.exec(row))) {
          var value = (/<v>([^<]*)<\/v>/.exec(m[2]) || [])[1] || "";
          if (/t="s"/.test(m[1]) && shared[parseInt(value, 10)] !== undefined) { value = shared[parseInt(value, 10)]; }
          else if (/t="inlineStr"/.test(m[1])) { value = m[2].replace(/<[^>]+>/g, ""); }
          cells.push(entities(value));
        }
        if (cells.some(Boolean)) { out.push(cells.join("\t")); }
      });
    });
    return out.join("\n");
  }

  function officeText(n, file) {
    var zip = unzip(n, file), ext = file.toLowerCase().split(".").pop();
    if (ext === "docx") { return paragraphs(zip.read("word/document.xml"), "w:p", "w:t"); }
    if (ext === "pptx") {
      return zip.names.filter(function (name) { return /^ppt\/slides\/slide\d+\.xml$/.test(name); }).sort(function (a, b) { return number(a) - number(b); })
        .map(function (name) { return "## Slide " + number(name) + "\n" + paragraphs(zip.read(name), "a:p", "a:t"); }).join("\n\n");
    }
    if (ext === "xlsx") { return xlsx(zip); }
    return zip.read("content.xml").replace(/<\/text:(p|h)>|<\/table:table-row>/g, "\n").replace(/<text:tab\/>/g, "\t").replace(/<[^>]+>/g, "")
      .split("\n").map(function (line) { return entities(line).trim(); }).filter(Boolean).join("\n");
  }

  // ------------------------------------------------------------------ PDF
  function pdfString(token, cmap) {
    var bytes = [];
    if (token.charAt(0) === "<") {
      var digits = token.slice(1, -1).replace(/[^0-9a-f]/gi, "");
      if (digits.length % 2) { digits += "0"; }
      for (var h = 0; h < digits.length; h += 2) { bytes.push(parseInt(digits.substr(h, 2), 16)); }
    } else {
      var body = token.slice(1, -1), escapes = { n: 10, r: 13, t: 9, b: 8, f: 12 };
      for (var i = 0; i < body.length; i += 1) {
        var c = body.charAt(i);
        if (c === "\\" && i + 1 < body.length) {
          var next = body.charAt(i + 1);
          if (escapes[next] !== undefined) { bytes.push(escapes[next]); i += 1; }
          else if (/[0-7]/.test(next)) { var octal = /^[0-7]{1,3}/.exec(body.slice(i + 1))[0]; bytes.push(parseInt(octal, 8) & 255); i += octal.length; }
          else if (next === "\n" || next === "\r") { i += 1; }
          else { bytes.push(next.charCodeAt(0) & 255); i += 1; }
        } else { bytes.push(c.charCodeAt(0) & 255); }
      }
    }
    var codes = Object.keys(cmap);
    if (codes.length) {
      var width = codes.some(function (code) { return Number(code) > 255; }) ? 2 : 1;
      if (bytes.length % width === 0) {
        var values = [];
        for (var j = 0; j < bytes.length; j += width) { values.push(width === 2 ? bytes[j] * 256 + bytes[j + 1] : bytes[j]); }
        if (values.filter(function (v) { return cmap[v] !== undefined; }).length >= values.length / 2) {
          return values.map(function (v) { return cmap[v] || ""; }).join("");
        }
      }
    }
    if (bytes[0] === 254 && bytes[1] === 255) {
      var utf16 = "";
      for (var u = 2; u + 1 < bytes.length; u += 2) { utf16 += String.fromCharCode(bytes[u] * 256 + bytes[u + 1]); }
      return utf16;
    }
    return String.fromCharCode.apply(null, bytes);
  }

  function hexText(hex) {
    var text = "";
    for (var i = 0; i + 3 < hex.length + 1; i += 4) { text += String.fromCharCode(parseInt(hex.substr(i, 4), 16) || 0); }
    return text;
  }

  function readCmap(data, cmap) {
    var block, m, re;
    var chars = /beginbfchar([\s\S]*?)endbfchar/g;
    while ((block = chars.exec(data))) {
      re = /<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi;
      while ((m = re.exec(block[1]))) { cmap[parseInt(m[1], 16)] = hexText(m[2]); }
    }
    var ranges = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((block = ranges.exec(data))) {
      re = /<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(<[0-9a-f]*>|\[[^\]]*\])/gi;
      while ((m = re.exec(block[1]))) {
        var low = parseInt(m[1], 16), high = parseInt(m[2], 16);
        if (m[3].charAt(0) === "[") {
          (m[3].match(/<[0-9a-f]*>/gi) || []).forEach(function (item, offset) { cmap[low + offset] = hexText(item.slice(1, -1)); });
        } else if (high - low < 65536) {
          var start = parseInt(m[3].slice(1, -1) || "0", 16);
          for (var k = 0; k <= high - low; k += 1) { cmap[low + k] = start + k < 0x110000 ? String.fromCodePoint(start + k) : ""; }
        }
      }
    }
  }

  var TOKEN = /\((?:\\[\s\S]|[^\\)])*\)|<[0-9a-fA-F\s]*>|\[|\]|-?\d*\.?\d+|\/[^\s\/<>\[\]()]+|[A-Za-z'"*]+/g;

  // Best-effort text of a PDF: page content streams plus the fonts' ToUnicode maps,
  // with spaces and line breaks where the text position jumps. Scanned PDFs have none.
  function pdfText(n, file, limit) {
    var buf = n.fs.readFileSync(file), raw = buf.toString("latin1"), streams = [], match, cmap = {};
    var re = /stream\r?\n/g;
    while ((match = re.exec(raw))) {
      var start = match.index + match[0].length, end = raw.indexOf("endstream", start);
      if (end < 0) { continue; }
      var head = raw.slice(Math.max(0, raw.lastIndexOf("obj", match.index)), match.index);
      if (/\/Subtype\s*\/Image|\/FontFile|\/Length1|\/Subtype\s*\/(Type1C|CIDFontType0C|OpenType)/.test(head)) { continue; }
      var chunk = buf.slice(start, end);
      if (/FlateDecode/.test(head)) {
        try { chunk = n.zlib.inflateSync(chunk, { finishFlush: n.zlib.constants.Z_SYNC_FLUSH }); } catch (error) { continue; }
      } else if (/\/Filter/.test(head)) { continue; }
      var sample = chunk.slice(0, 4000), printable = 0;
      for (var s = 0; s < sample.length; s += 1) { var b = sample[s]; if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) { printable += 1; } }
      if (sample.length && printable < 0.9 * sample.length) { continue; }
      streams.push(chunk.toString("latin1"));
      re.lastIndex = end;
    }
    streams.forEach(function (text) { if (text.indexOf("begincmap") >= 0) { readCmap(text, cmap); } });
    var out = [], total = 0;
    streams.some(function (text) {
      if (text.indexOf("BT") < 0 || (text.indexOf("Tj") < 0 && text.indexOf("TJ") < 0)) { return false; }
      var line = [], stack = [], pos = { x: 0, y: 0, lx: 0, ly: 0, size: 10, scale: 1, lead: 0, end: 0, lastY: null };
      function emit(value) {
        var size = pos.size * pos.scale || 10;
        if (pos.lastY !== null) {
          if (Math.abs(pos.y - pos.lastY) > 0.5 * size) { line.push("\n"); }
          else if (pos.x - pos.end > 0.2 * size && line.length && !/[ \n]$/.test(line[line.length - 1])) { line.push(" "); }
        }
        line.push(value);
        pos.end = pos.x + 0.5 * size * value.length;
        pos.x = pos.end; pos.lastY = pos.y;
      }
      (text.match(TOKEN) || []).forEach(function (token) {
        var numbers = stack.filter(function (v) { return typeof v === "number"; });
        var strings = function () { return stack.filter(function (v) { return typeof v === "string"; }); };
        if (token === "Tj" || token === "'" || token === "\"") {
          if (token !== "Tj") { pos.ly -= pos.lead || pos.size * 1.2; pos.x = pos.lx; pos.y = pos.ly; }
          if (typeof stack[stack.length - 1] === "string") { emit(stack[stack.length - 1]); }
          stack = [];
        } else if (token === "TJ") {
          var joined = strings().join("");
          if (joined) { emit(joined); }
          stack = [];
        } else if (token === "[") { stack = []; }
        else if (token === "]") { stack = strings(); }
        else if (token.charAt(0) === "(" || token.charAt(0) === "<") { stack.push(pdfString(token, cmap)); }
        else if (/^-?\d*\.?\d+$/.test(token)) {
          if (typeof stack[stack.length - 1] === "string" && parseFloat(token) < -180) { stack.push(" "); } else { stack.push(parseFloat(token)); }
        } else if (token === "Tf" && numbers.length) { pos.size = Math.abs(numbers[numbers.length - 1]) || 10; stack = []; }
        else if (token === "TL" && numbers.length) { pos.lead = numbers[numbers.length - 1]; stack = []; }
        else if (token === "Tm" && numbers.length >= 6) {
          var m6 = numbers.slice(-6);
          pos.scale = Math.max(Math.abs(m6[0]), Math.abs(m6[1])) || 1;
          pos.x = pos.lx = m6[4]; pos.y = pos.ly = m6[5]; stack = [];
        } else if ((token === "Td" || token === "TD") && numbers.length >= 2) {
          var d = numbers.slice(-2);
          if (token === "TD") { pos.lead = -d[1]; }
          pos.lx += d[0] * pos.scale; pos.ly += d[1] * pos.scale; pos.x = pos.lx; pos.y = pos.ly; stack = [];
        } else if (token === "T*") { pos.ly -= (pos.lead || pos.size * 1.2) * pos.scale; pos.x = pos.lx; pos.y = pos.ly; stack = []; }
        else if (/^[A-Za-z]+$/.test(token)) { stack = []; }
      });
      var page = line.join("").replace(/\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n");
      out.push(page);
      total += page.length;
      return total > limit;
    });
    return out.join("\n").replace(/[^\S\n]+/g, " ").trim().slice(0, limit);
  }

  // Text of any supported document (plain text read as UTF-8, else Windows-1252).
  function documentText(n, file) {
    if (OFFICE.test(file)) { return officeText(n, file); }
    var buf = n.fs.readFileSync(file), text = buf.toString("utf8");
    if (text.indexOf("�") >= 0) { text = buf.toString("latin1"); }
    if (/\.rtf$/i.test(file)) {
      text = text.replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|\*)(?:[^{}]|\{[^{}]*\})*\}/g, "").replace(/\\par[d]?\b ?/g, "\n")
        .replace(/\\'([0-9a-f]{2})/gi, function (m, h) { return String.fromCharCode(parseInt(h, 16)); }).replace(/\\[a-z]+-?\d* ?|[{}]/g, "");
    } else if (/\.html?$/i.test(file)) {
      text = entities(text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/(p|div|h\d|li)>/gi, "\n").replace(/<[^>]+>/g, ""));
    }
    return text;
  }

  return { isOffice: function (file) { return OFFICE.test(file); }, documentText: documentText, pdfText: pdfText };
}));
