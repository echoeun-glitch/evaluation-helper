/* 한글(.hwp) 평가 계획서에서 과목별 평가 영역·주요 활동·평가 기준을 뽑아냅니다.
 * 파일은 브라우저 안에서만 읽고 어디로도 보내지 않습니다.
 *
 *   const plan = await HwpImport.readPlan(arrayBuffer);
 *   // {grade:"3학년", subjects:[{subject:"국어", areas:[{name, activity, criteria}]}]}
 */
(function (root) {
  "use strict";

  /* ---------- 1. 복합 문서(CFB) 읽기: .hwp 파일은 여러 스트림을 담은 OLE 컨테이너 ---------- */
  function readCfb(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    if (u8.length < 512 || sig.some((b, i) => u8[i] !== b)) throw new HwpError("not-hwp");
    const secSize = 1 << dv.getUint16(30, true), miniSize = 1 << dv.getUint16(32, true);
    const nFat = dv.getUint32(44, true), dirStart = dv.getUint32(48, true);
    const miniCutoff = dv.getUint32(56, true), miniFatStart = dv.getUint32(60, true);
    let difatNext = dv.getUint32(68, true);
    const secOff = (s) => (s + 1) * secSize;
    const fatSecs = [];
    for (let i = 0; i < 109 && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(76 + i * 4, true));
    for (let guard = 0; fatSecs.length < nFat && difatNext < 0xfffffffa && guard < 1e5; guard++) {
      const o = secOff(difatNext), per = secSize / 4 - 1;
      for (let i = 0; i < per && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(o + i * 4, true));
      difatNext = dv.getUint32(o + per * 4, true);
    }
    const fat = [];
    for (const s of fatSecs) { const o = secOff(s); for (let i = 0; i < secSize / 4; i++) fat.push(dv.getUint32(o + i * 4, true)); }
    const chain = (start, table) => {
      const out = [];
      for (let s = start, g = 0; s < 0xfffffffa && g < table.length + 1; s = table[s], g++) out.push(s);
      return out;
    };
    const readChain = (start, size) => {
      const out = new Uint8Array(chain(start, fat).length * secSize);
      chain(start, fat).forEach((s, i) => out.set(u8.subarray(secOff(s), secOff(s) + secSize), i * secSize));
      return size == null ? out : out.subarray(0, size);
    };
    const dir = readChain(dirStart), ddv = new DataView(dir.buffer);
    const entries = [];
    for (let o = 0; o + 128 <= dir.length; o += 128) {
      const nameLen = ddv.getUint16(o + 64, true);
      let name = "";
      for (let i = 0; i < Math.max(0, nameLen / 2 - 1); i++) name += String.fromCharCode(ddv.getUint16(o + i * 2, true));
      entries.push({
        name, type: dir[o + 66], left: ddv.getUint32(o + 68, true), right: ddv.getUint32(o + 72, true),
        child: ddv.getUint32(o + 76, true), start: ddv.getUint32(o + 116, true), size: ddv.getUint32(o + 120, true),
      });
    }
    const rootEntry = entries[0];
    const ministream = rootEntry ? readChain(rootEntry.start, rootEntry.size) : new Uint8Array(0);
    const minifat = [];
    if (miniFatStart < 0xfffffffa) { const m = readChain(miniFatStart), mdv = new DataView(m.buffer); for (let i = 0; i < m.length / 4; i++) minifat.push(mdv.getUint32(i * 4, true)); }
    const readEntry = (e) => {
      if (e.size >= miniCutoff) return readChain(e.start, e.size);
      const ss = chain(e.start, minifat), out = new Uint8Array(ss.length * miniSize);
      ss.forEach((s, i) => out.set(ministream.subarray(s * miniSize, (s + 1) * miniSize), i * miniSize));
      return out.subarray(0, e.size);
    };
    /* 저장소 안의 자식들을 이름으로 찾기 (레드-블랙 트리를 그냥 전부 훑음) */
    const children = (idx) => {
      const out = [], stack = [entries[idx].child], seen = new Set();
      while (stack.length) {
        const i = stack.pop();
        if (i >= entries.length || seen.has(i)) continue;
        seen.add(i); out.push(entries[i]); stack.push(entries[i].left, entries[i].right);
      }
      return out;
    };
    const find = (path) => {
      let idx = 0;
      for (const part of path.split("/")) {
        const e = children(idx).find((x) => x.name === part);
        if (!e) return null;
        idx = entries.indexOf(e);
      }
      return entries[idx];
    };
    return { find, read: readEntry, children: (path) => { const e = find(path); return e ? children(entries.indexOf(e)) : []; } };
  }

  class HwpError extends Error { constructor(code) { super(code); this.code = code; } }

  /* 압축 풀기 기능(DecompressionStream)이 없는 오래된 브라우저용: pako를 그때만 불러옴 */
  let pakoP = null;
  function loadPako() {
    if (root.pako) return Promise.resolve(root.pako);
    if (typeof document === "undefined") return Promise.reject(new HwpError("old-browser"));
    pakoP ||= new Promise((ok, no) => {
      const sc = document.createElement("script");
      sc.src = "https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako_inflate.min.js";
      sc.onload = () => (root.pako ? ok(root.pako) : no(new HwpError("old-browser")));
      sc.onerror = () => { pakoP = null; no(new HwpError("old-browser")); };
      document.head.appendChild(sc);
    });
    return pakoP;
  }
  async function inflateRaw(u8) {
    if (typeof DecompressionStream === "undefined") {
      const pako = await loadPako();
      const inf = new pako.Inflate({ raw: true });
      inf.push(u8, true);
      if (inf.result && inf.result.length) return inf.result;
      throw new HwpError("not-hwp");
    }
    /* 한글 파일은 압축 데이터 뒤에 여분 바이트가 붙는 경우가 있어, 브라우저가 끝에서
       오류를 내도 그때까지 풀린 내용을 씁니다. */
    const reader = new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); total += value.length; }
    } catch (e) {
      if (!total) throw e;
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  /* ---------- 2. 본문 레코드에서 표(행·열·병합)와 칸 글자 뽑기 ---------- */
  const TAG_PARA_TEXT = 67, TAG_LIST_HEADER = 72, TAG_TABLE = 77;

  function paraText(u8, off, size) {
    const dv = new DataView(u8.buffer, u8.byteOffset + off, size);
    let s = "";
    for (let j = 0; j + 1 < size;) {
      const c = dv.getUint16(j, true);
      if (c >= 32) { s += String.fromCharCode(c); j += 2; }
      else if (c === 0 || c === 10 || c === 13 || (c >= 24 && c <= 31)) { s += c === 10 || c === 13 ? "\n" : c === 24 || c === 30 || c === 31 ? " " : ""; j += 2; }
      else { if (c === 9) s += " "; j += 16; } // 인라인·확장 컨트롤(탭, 표, 그림 등)은 8글자 크기
    }
    return s;
  }

  function parseTables(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const tables = [], stack = []; // stack: {table, level, cell}
    for (let i = 0; i + 4 <= u8.length;) {
      const h = dv.getUint32(i, true); i += 4;
      const tag = h & 0x3ff, level = (h >>> 10) & 0x3ff;
      let size = h >>> 20;
      if (size === 0xfff) { size = dv.getUint32(i, true); i += 4; }
      const off = i; i += size;
      while (stack.length && level < stack[stack.length - 1].level) stack.pop();
      const top = stack[stack.length - 1];
      if (tag === TAG_TABLE && size >= 8) {
        const t = { rows: dv.getUint16(off + 4, true), cols: dv.getUint16(off + 6, true), cells: [] };
        tables.push(t); stack.push({ table: t, level, cell: null });
      } else if (tag === TAG_LIST_HEADER && top && level === top.level && size >= 16) {
        const cell = { c: dv.getUint16(off + 8, true), r: dv.getUint16(off + 10, true), cs: dv.getUint16(off + 12, true) || 1, rs: dv.getUint16(off + 14, true) || 1, lines: [] };
        top.table.cells.push(cell); top.cell = cell;
      } else if (tag === TAG_PARA_TEXT && top && top.cell && level === top.level + 1) {
        top.cell.lines.push(paraText(u8, off, size));
      }
    }
    for (const t of tables) for (const c of t.cells) c.text = c.lines.join("\n").replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").trim();
    return tables;
  }

  /* ---------- 2-1. HWPX: zip 안의 Contents/section*.xml 에서 표 읽기 ---------- */
  async function readZip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new HwpError("not-hwp");
    const n = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = new Map(), dec = new TextDecoder();
    for (let k = 0; k < n && p + 46 <= u8.length && dv.getUint32(p, true) === 0x02014b50; k++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true), name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
      files.set(name, { method, csize, local });
      p += 46 + nl + xl + cl;
    }
    const read = async (name) => {
      const f = files.get(name);
      if (!f) return null;
      const start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true);
      const raw = u8.subarray(start, start + f.csize);
      if (f.method === 0) return raw;
      if (f.method === 8) return inflateRaw(raw);
      throw new HwpError("not-hwp");
    };
    return { names: [...files.keys()], read };
  }

  const local = (el) => el.localName || String(el.nodeName).replace(/^.*:/, "");
  const up = (el, name) => { for (let e = el.parentNode; e && e.nodeType === 1; e = e.parentNode) if (local(e) === name) return e; return null; };
  const kids = (el, name) => [...el.childNodes].filter((c) => c.nodeType === 1 && local(c) === name);
  const allIn = (el, name) => [...el.getElementsByTagName("*")].filter((c) => local(c) === name);

  function xmlTables(doc) {
    const tables = [];
    for (const tbl of allIn(doc, "tbl")) {
      const t = { rows: +tbl.getAttribute("rowCnt") || 0, cols: +tbl.getAttribute("colCnt") || 0, cells: [] };
      kids(tbl, "tr").forEach((tr, ri) => {
        let ci = 0;
        for (const tc of kids(tr, "tc")) {
          const addr = allIn(tc, "cellAddr").find((x) => up(x, "tc") === tc);
          const span = allIn(tc, "cellSpan").find((x) => up(x, "tc") === tc);
          const c = addr ? +addr.getAttribute("colAddr") : ci, r = addr ? +addr.getAttribute("rowAddr") : ri;
          const cs = (span && +span.getAttribute("colSpan")) || 1, rs = (span && +span.getAttribute("rowSpan")) || 1;
          ci = c + cs;
          /* 이 칸의 문단만 (칸 안에 들어 있는 다른 표의 문단은 빼고) */
          const lines = allIn(tc, "p").filter((pp) => up(pp, "tc") === tc).map((pp) => {
            let s = "";
            for (const tEl of allIn(pp, "t").filter((x) => up(x, "p") === pp)) {
              for (const nd of tEl.childNodes) {
                if (nd.nodeType === 3 || nd.nodeType === 4) s += nd.nodeValue;
                else if (nd.nodeType === 1) s += local(nd) === "lineBreak" ? "\n" : /tab|Space/i.test(local(nd)) ? " " : (nd.textContent || "");
              }
            }
            return s;
          });
          t.cells.push({ r, c, rs, cs, lines });
        }
      });
      tables.push(t);
    }
    return tables;
  }

  /* 워드(.docx): word/document.xml 의 w:tbl (가로 병합 gridSpan, 세로 병합 vMerge) */
  function docxTables(doc) {
    const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const val = (el) => el && (el.getAttribute("w:val") ?? el.getAttributeNS(W, "val"));
    const tables = [];
    for (const tbl of allIn(doc, "tbl")) {
      const t = { rows: 0, cols: 0, cells: [] };
      kids(tbl, "tr").forEach((tr, ri) => {
        const trPr = kids(tr, "trPr")[0];
        let ci = +(val(trPr && kids(trPr, "gridBefore")[0]) || 0);
        for (const tc of kids(tr, "tc")) {
          const pr = kids(tc, "tcPr")[0];
          const cs = +(val(pr && kids(pr, "gridSpan")[0]) || 1);
          const vm = pr && kids(pr, "vMerge")[0];
          if (vm && val(vm) !== "restart") {
            const above = t.cells.find((x) => x.c === ci && x.r + x.rs === ri);
            if (above) { above.rs++; ci += cs; continue; }
          }
          const lines = kids(tc, "p").map((pp) => {
            let s = "";
            for (const el of [...pp.getElementsByTagName("*")]) {
              const n = local(el);
              if (n === "t") s += el.textContent;
              else if (n === "tab") s += " ";
              else if (n === "br" || n === "cr") s += "\n";
            }
            return s;
          });
          t.cells.push({ r: ri, c: ci, rs: 1, cs, lines });
          ci += cs;
        }
        t.rows = ri + 1; t.cols = Math.max(t.cols, ci);
      });
      tables.push(t);
    }
    return tables;
  }

  const finishText = (tables) => { for (const t of tables) for (const c of t.cells) c.text = c.lines.join("\n").replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").trim(); return tables; };

  async function readZipTables(buf) {
    if (typeof DOMParser === "undefined") throw new HwpError("old-browser");
    const zip = await readZip(buf), dec = new TextDecoder();
    const xml = async (nm) => {
      const doc = new DOMParser().parseFromString(dec.decode(await zip.read(nm)), "application/xml");
      if (doc.getElementsByTagName("parsererror").length) throw new HwpError("not-hwp");
      return doc;
    };
    if (zip.names.includes("word/document.xml")) return finishText(docxTables(await xml("word/document.xml")));
    const manifest = await zip.read("META-INF/manifest.xml");
    if (manifest && /encryption-data/.test(dec.decode(manifest))) throw new HwpError("encrypted");
    const sections = zip.names.filter((nm) => /^Contents\/section\d+\.xml$/i.test(nm))
      .sort((a, b) => +a.match(/(\d+)\.xml$/i)[1] - +b.match(/(\d+)\.xml$/i)[1]);
    if (!sections.length) throw new HwpError("not-hwp");
    const tables = [];
    for (const nm of sections) tables.push(...xmlTables(await xml(nm)));
    return finishText(tables);
  }

  async function readTables(buf) {
    const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4) return readZipTables(buf);
    const cfb = readCfb(buf);
    const header = cfb.find("FileHeader");
    if (!header) throw new HwpError("not-hwp");
    const hb = cfb.read(header), flags = new DataView(hb.buffer, hb.byteOffset).getUint32(36, true);
    if (flags & 2) throw new HwpError("encrypted");
    if (flags & 4) throw new HwpError("distribution");
    const sections = cfb.children("BodyText").filter((e) => /^Section\d+$/.test(e.name))
      .sort((a, b) => +a.name.slice(7) - +b.name.slice(7));
    if (!sections.length) throw new HwpError("not-hwp");
    const tables = [];
    for (const s of sections) {
      let body = cfb.read(s);
      if (flags & 1) body = await inflateRaw(body);
      tables.push(...parseTables(body));
    }
    return tables;
  }

  /* ---------- 3. 평가 계획 표 해석 ---------- */
  const squash = (s) => String(s || "").replace(/\s+/g, "");
  const oneLine = (s) => String(s || "").replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
  /* 성취 수준 이름 (줄바꿈으로 갈라진 "노력\n요함"도 같은 것으로) */
  const LEVEL_NAMES = { "매우잘함": "매우 잘함", "잘함": "잘함", "보통": "보통", "노력요함": "노력 요함", "최상": "최상", "상": "상", "중": "중", "하": "하", "우수": "우수", "미흡": "미흡", "A": "A", "B": "B", "C": "C", "D": "D", "E": "E" };
  const levelName = (t) => { const q = squash(t).replace(/[()（）]/g, ""); return LEVEL_NAMES[q] || ""; };

  /* 머리글 칸 이름 → 열 종류 (위에서부터 먼저 맞는 것) */
  const HEAD = [
    ["standard", /성취기준/],
    ["levels", /성취수준|도달수준|수준별/],
    ["criteria", /평가기준|채점기준/],
    ["area", /^(평가)?영역(명)?$|^평가영역/],
    ["element", /평가요소|평가내용/],
    ["view", /평가관점|평가착안점/],
    ["method", /수업.?평가방법|주안점/],
    ["way", /^평가(방법|도구|유형)$/],
    ["unit", /^단원/],
    ["when", /^(평가)?시기$/],
  ];
  const headKind = (text) => { const q = squash(text); const k = HEAD.find(([, re]) => re.test(q)); return k ? k[0] : (levelName(q) ? "level" : ""); };
  const CRIT_KINDS = ["standard", "levels", "criteria", "view", "level"];

  function subjectFromTitle(text) {
    const t = oneLine(text);
    const m = t.match(/^(.+?)과?\s*교수\s*[·•]?\s*학습/) || t.match(/^(.+?)(과)?\s*평가\s*(운영)?\s*계획/);
    if (!m) return "";
    return m[1].replace(/과$/, "").replace(/^\d{4}학년도\s*(\d학년\s*)?(\d학기\s*)?/, "").trim();
  }
  const normalizeSubject = (s) => (/^창의적\s*체험\s*활동$/.test(s) ? "창의적 체험활동" : s);

  function cleanList(text) {
    return String(text || "").split("\n").map((l) => l.replace(/^\s*(?:[-•·▪◦○●■□※]|\d+[.)])\s*/, "").trim()).filter(Boolean);
  }
  const methodTags = (text) => [...String(text || "").matchAll(/[\[［]\s*([^\]］]+?)\s*[\]］]/g)].map((m) => m[1].trim());

  function parseTable(t, lastTitle) {
    const at = (r, c) => t.cells.find((x) => x.r <= r && r < x.r + x.rs && x.c <= c && c < x.c + x.cs);
    const rowsOf = [...new Set(t.cells.map((c) => c.r))].sort((a, b) => a - b);
    /* 머리글 줄: «평가 영역» 칸과 평가 기준 계열 칸(성취기준·평가 기준·성취 수준·평가 관점)이 함께 있는 줄 */
    const headerRow = rowsOf.find((r) => {
      const kinds = t.cells.filter((c) => c.r === r).map((c) => headKind(c.text));
      return kinds.includes("area") && kinds.some((k) => CRIT_KINDS.includes(k));
    });
    if (headerRow == null) return null;
    const col = {};
    const levelCols = [];   // 수준이 열로 나뉜 표: [{c, label}]
    for (const c of t.cells.filter((x) => x.r === headerRow)) {
      const k = headKind(c.text);
      if (k === "level") levelCols.push({ c: c.c, label: LEVEL_NAMES[squash(c.text)] || oneLine(c.text) });
      else if (k && col[k] == null) col[k] = { c: c.c, cs: c.cs, rs: c.rs };
    }
    /* 두 줄 머리글: «평가 기준» 아래에 상·중·하 같은 작은 칸들이 있으면 수준 열 */
    let dataStart = headerRow + 1;
    const sub = t.cells.filter((x) => x.r === headerRow + 1 && levelName(x.text));
    const group = ["levels", "criteria"].map((k) => col[k]).find((h) => h && h.cs > 1 && h.rs === 1);
    const startsNext = t.cells.filter((x) => x.r === headerRow + 1);
    if (group && sub.length >= 2 && startsNext.every((x) => x.c >= group.c && x.c < group.c + group.cs)) {
      sub.forEach((x) => levelCols.push({ c: x.c, label: LEVEL_NAMES[squash(x.text).replace(/[()（）]/g, "")] || oneLine(x.text) }));
      if (col.levels === group) delete col.levels; else delete col.criteria;
      dataStart = headerRow + 2;
    }

    let subject = "", grade = "";
    for (const c of t.cells.filter((x) => x.r < headerRow)) {
      subject ||= subjectFromTitle(c.text);
      grade ||= (c.text.match(/(?:^|[^\d])([1-6])\s*학년(?!도)/) || [])[1] || "";
    }
    subject = normalizeSubject(subject || subjectFromTitle(lastTitle || ""));
    if (!grade) grade = (String(lastTitle || "").match(/(?:^|[^\d])([1-6])\s*학년(?!도)/) || [])[1] || "";

    /* 평가 요소 칸 하나 = 영역 카드 하나 (요소 칸이 없으면 영역 칸 기준) */
    const keyCol = (col.element || col.area).c;
    const keys = t.cells.filter((c) => c.r >= dataStart && c.c === keyCol && c.text).sort((a, b) => a.r - b.r);
    const areas = [];
    for (const k of keys) {
      const get = (name) => { const h = col[name]; if (!h) return ""; const c = at(k.r, h.c); return c && c.r >= dataStart ? c.text : ""; };
      const name = oneLine(get("area"));
      if (headKind(name) === "area") continue;   // 표 중간에 머리글이 반복되는 경우
      const elements = cleanList(col.element ? k.text : "");
      const tags = [...new Set([...methodTags(get("method")), ...cleanList(get("way")).flatMap((s) => s.split(/\s*,\s*/))])].filter(Boolean);
      let activity = elements.join("\n");
      if (tags.length) activity += (activity ? "\n" : "") + `(평가 방법: ${tags.join(", ")})`;

      const parts = [];
      const std = oneLine(get("standard"));
      if (std) parts.push(std);
      /* 수준이 줄로 나뉜 표: «성취 수준» 아래 [수준 이름 | 설명] */
      const lv = col.levels || (col.criteria && col.criteria.cs > 1 ? col.criteria : null);
      if (lv && lv.cs > 1) {
        for (let r = k.r; r < k.r + k.rs; r++) {
          const label = at(r, lv.c), desc = at(r, lv.c + 1);
          if (!label || label.r !== r) continue;
          const ln = levelName(label.text), d = desc && desc !== label ? oneLine(desc.text) : "";
          if (ln && d) parts.push(`${LEVEL_NAMES[squash(label.text).replace(/[()（）]/g, "")]}: ${d}`);
          else if (d) parts.push(d);
        }
      } else if (lv) {
        parts.push(...cleanList(get(col.levels ? "levels" : "criteria")));
      }
      if (col.criteria && col.criteria !== lv) parts.push(...cleanList(get("criteria")));
      /* 수준이 열로 나뉜 표: 머리글이 상·중·하 */
      for (const L of levelCols) { const c = at(k.r, L.c); const d = c && c !== k ? oneLine(c.text) : ""; if (d) parts.push(`${L.label}: ${d}`); }
      parts.push(...cleanList(get("view")));
      if (!name && !parts.length) continue;
      areas.push({ name, activity, criteria: [...new Set(parts)].join("\n") });
    }
    /* 같은 이름의 영역이 여러 개면 번호를 붙여 구분 */
    const count = {};
    areas.forEach((a) => (count[a.name] = (count[a.name] || 0) + 1));
    const seen = {};
    areas.forEach((a) => { if (count[a.name] > 1) { seen[a.name] = (seen[a.name] || 0) + 1; a.name = `${a.name} ${seen[a.name]}`; } });
    return { subject, grade: grade ? grade + "학년" : "", areas };
  }

  function planFromTables(tables) {
    const subjects = [];
    let grade = "", lastTitle = "";
    for (const t of tables) {
      if (t.cells.length <= 2) { lastTitle = t.cells.map((c) => c.text).join(" "); continue; }
      const p = parseTable(t, lastTitle);
      if (!p || !p.areas.length) continue;
      grade ||= p.grade;
      const same = subjects.find((s) => s.subject === p.subject);
      if (same) same.areas.push(...p.areas); else subjects.push({ subject: p.subject || "과목 미상", areas: p.areas });
    }
    return { grade, subjects };
  }

  /* 평가 영역과 평가 기준(성취기준·평가 기준·성취 수준·평가 관점)이 있는 표를 하나도 못 찾으면 not-plan */
  async function readPlan(buf) {
    const plan = planFromTables(await readTables(buf));
    if (!plan.subjects.length) throw new HwpError("not-plan");
    return plan;
  }

  const api = { readPlan, readTables, planFromTables, HwpError };
  root.HwpImport = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
