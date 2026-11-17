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

  async function inflateRaw(u8) {
    if (typeof DecompressionStream === "undefined") throw new HwpError("old-browser");
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

  async function readTables(buf) {
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
  /* 줄바꿈으로 갈라진 낱말 잇기: "노력\n요함" → "노력 요함" */
  const LEVEL_NAMES = [["매우잘함", "매우 잘함"], ["잘함", "잘함"], ["보통", "보통"], ["노력요함", "노력 요함"]];

  const HEAD = [
    ["standard", /^성취기준$/],
    ["unit", /^단원/],
    ["area", /^평가영역$/],
    ["element", /^평가요소$/],
    ["method", /수업.?평가방법|주안점/],
    ["levels", /^성취수준$/],
    ["view", /^평가관점$/],
    ["way", /^평가방법$/],
    ["when", /^(평가)?시기$/],
  ];

  function subjectFromTitle(text) {
    const t = oneLine(text);
    const m = t.match(/^(.+?)과?\s*교수\s*[·•]?\s*학습/) || t.match(/^(.+?)(과)?\s*평가\s*(운영)?\s*계획/);
    if (!m) return "";
    return m[1].replace(/과$/, "").replace(/^\d{4}학년도\s*\d학년\s*\d학기\s*/, "").trim();
  }
  const normalizeSubject = (s) => (/^창의적\s*체험\s*활동$/.test(s) ? "창의적 체험활동" : s);

  function cleanList(text) {
    return String(text || "").split("\n").map((l) => l.replace(/^\s*(?:[-•·▪◦○●■□※]|\d+[.)])\s*/, "").trim()).filter(Boolean);
  }
  const methodTags = (text) => [...String(text || "").matchAll(/[\[［]\s*([^\]］]+?)\s*[\]］]/g)].map((m) => m[1].trim());

  function parseTable(t, lastTitle) {
    const at = (r, c) => t.cells.find((x) => x.r <= r && r < x.r + x.rs && x.c <= c && c < x.c + x.cs);
    const headerRow = [...new Set(t.cells.map((c) => c.r))].sort((a, b) => a - b)
      .find((r) => t.cells.some((c) => c.r === r && squash(c.text) === "평가영역"));
    if (headerRow == null) return null;
    const col = {};
    for (const c of t.cells.filter((x) => x.r === headerRow)) {
      const k = HEAD.find(([, re]) => re.test(squash(c.text)));
      if (k && col[k[0]] == null) col[k[0]] = { c: c.c, cs: c.cs };
    }
    if (!col.area) return null;

    let subject = "", grade = "";
    for (const c of t.cells.filter((x) => x.r < headerRow)) {
      subject ||= subjectFromTitle(c.text);
      grade ||= (c.text.match(/(?:^|[^\d])([1-6])\s*학년(?!도)/) || [])[1] || "";
    }
    subject = normalizeSubject(subject || subjectFromTitle(lastTitle || ""));

    /* 평가 요소 칸 하나 = 영역 카드 하나 (요소 칸이 없으면 영역 칸 기준) */
    const keyCol = (col.element || col.area).c;
    const keys = t.cells.filter((c) => c.r > headerRow && c.c === keyCol && c.text).sort((a, b) => a.r - b.r);
    const areas = [];
    for (const k of keys) {
      const get = (name) => { const h = col[name]; if (!h) return ""; const c = at(k.r, h.c); return c ? c.text : ""; };
      const name = oneLine(get("area"));
      const elements = cleanList(col.element ? k.text : "");
      const tags = [...new Set([...methodTags(get("method")), ...cleanList(get("way")).flatMap((s) => s.split(/\s*,\s*/))])].filter(Boolean);
      let activity = elements.join("\n");
      if (tags.length) activity += (activity ? "\n" : "") + `(평가 방법: ${tags.join(", ")})`;

      const parts = [];
      const std = oneLine(get("standard"));
      if (std) parts.push(std);
      if (col.levels) {
        for (let r = k.r; r < k.r + k.rs; r++) {
          const label = at(r, col.levels.c), desc = col.levels.cs > 1 ? at(r, col.levels.c + 1) : null;
          if (!label || label.r !== r) continue;
          const ln = LEVEL_NAMES.find(([sq]) => squash(label.text) === sq);
          const d = desc && desc !== label ? oneLine(desc.text) : "";
          if (ln && d) parts.push(`${ln[1]}: ${d}`);
        }
      }
      const view = cleanList(get("view"));
      if (view.length) parts.push(...view);
      if (!name && !parts.length && !activity) continue;
      areas.push({ name, activity, criteria: parts.join("\n") });
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
      if (t.cells.length === 1) { lastTitle = t.cells[0].text; continue; }
      const p = parseTable(t, lastTitle);
      if (!p || !p.areas.length) continue;
      grade ||= p.grade;
      const same = subjects.find((s) => s.subject === p.subject);
      if (same) same.areas.push(...p.areas); else subjects.push({ subject: p.subject || "과목 미상", areas: p.areas });
    }
    return { grade, subjects };
  }

  async function readPlan(buf) { return planFromTables(await readTables(buf)); }

  const api = { readPlan, readTables, planFromTables, HwpError };
  root.HwpImport = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
