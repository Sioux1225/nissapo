// Excel（.xlsx）を外部のプログラムなしで作る。
// xlsx は「XMLファイルをzipでまとめたもの」なので、必要なXMLを書いて無圧縮のzipに入れる。

import { timeToSerial } from './model.js';

const enc = new TextEncoder();

// ---- zip（無圧縮） ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

export function zip(files, date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034B50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true); // ファイル名はUTF-8
    head.setUint16(8, 0, true);      // 無圧縮
    head.setUint16(10, time, true);
    head.setUint16(12, day, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, data.length, true);
    head.setUint32(22, data.length, true);
    head.setUint16(26, name.length, true);
    head.setUint16(28, 0, true);
    locals.push(new Uint8Array(head.buffer), name, data);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014B50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, time, true);
    cen.setUint16(14, day, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    centrals.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cenSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054B50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  return concat([...locals, ...centrals, new Uint8Array(end.buffer)]);
}

export function concat(parts) {
  const out = new Uint8Array(parts.reduce((s, b) => s + b.length, 0));
  let p = 0;
  for (const b of parts) { out.set(b, p); p += b.length; }
  return out;
}

// ---- シート ----

export function colName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// styles.xml の cellXfs の番号
const S = { title: 1, info: 2, head: 3, text: 4, time: 5, num: 6, wide: 7 };

const TITLE_ROW = 1;
const INFO_ROW = 2;
const HEAD_ROW = 3;

function strCell(ref, style, text) {
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}

function valueCell(ref, kind, v, formula) {
  const style = S[kind];
  if (formula) return `<c r="${ref}" s="${style}"><f>${formula}</f>${v == null ? '' : `<v>${v}</v>`}</c>`;
  if (v == null || v === '') return `<c r="${ref}" s="${style}"/>`;
  if (typeof v === 'object' && v.time) return `<c r="${ref}" s="${S.time}"><v>${timeToSerial(v.time)}</v></c>`;
  if (typeof v === 'number') return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
  return strCell(ref, style, v);
}

export function sheetXml(spec) {
  const last = spec.widths.length - 1;
  const cells = new Map(); // 行番号 → Map(列番号 → xml)
  const put = (r, c, xml) => {
    if (!cells.has(r)) cells.set(r, new Map());
    cells.get(r).set(c, xml);
  };
  const merges = [`A${TITLE_ROW}:${colName(last)}${TITLE_ROW}`];

  put(TITLE_ROW, 0, strCell(`A${TITLE_ROW}`, S.title, spec.title));
  for (const it of spec.info) {
    put(INFO_ROW, it.c[0], strCell(`${colName(it.c[0])}${INFO_ROW}`, S.info, it.text));
    if (it.c[1] > it.c[0]) merges.push(`${colName(it.c[0])}${INFO_ROW}:${colName(it.c[1])}${INFO_ROW}`);
  }
  // 見出し：結合したセルも罫線が付くよう、範囲内のすべてのセルに書式を付ける
  for (const h of spec.head) {
    for (let r = h.r[0]; r <= h.r[1]; r++) {
      for (let c = h.c[0]; c <= h.c[1]; c++) {
        const ref = `${colName(c)}${HEAD_ROW + r}`;
        put(HEAD_ROW + r, c, r === h.r[0] && c === h.c[0] ? strCell(ref, S.head, h.text) : `<c r="${ref}" s="${S.head}"/>`);
      }
    }
    if (h.r[1] > h.r[0] || h.c[1] > h.c[0]) {
      merges.push(`${colName(h.c[0])}${HEAD_ROW + h.r[0]}:${colName(h.c[1])}${HEAD_ROW + h.r[1]}`);
    }
  }
  const first = HEAD_ROW + spec.headRows;
  spec.rows.forEach((row, i) => {
    const r = first + i;
    row.forEach((v, c) => {
      const f = spec.formulas[c] && v != null ? spec.formulas[c](r) : null;
      put(r, c, valueCell(`${colName(c)}${r}`, spec.kinds[c], v, f));
    });
  });

  const heights = { [TITLE_ROW]: 30, [INFO_ROW]: 24 };
  for (let r = 0; r < spec.headRows; r++) heights[HEAD_ROW + r] = spec.headRows === 1 ? 36 : 30;
  const lastRow = first + spec.rows.length - 1;
  const rowsXml = [...cells.keys()].sort((a, b) => a - b).map((r) => {
    const cs = cells.get(r);
    const body = [...cs.keys()].sort((a, b) => a - b).map((c) => cs.get(c)).join('');
    return `<row r="${r}" ht="${heights[r] || 22}" customHeight="1">${body}</row>`;
  }).join('');

  const cols = spec.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
    + `<dimension ref="A1:${colName(last)}${lastRow}"/>`
    + `<sheetViews><sheetView workbookViewId="0" zoomScale="85"><pane ySplit="${first - 1}" topLeftCell="A${first}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    + '<sheetFormatPr defaultRowHeight="18"/>'
    + `<cols>${cols}</cols>`
    + `<sheetData>${rowsXml}</sheetData>`
    + `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
    + '<printOptions horizontalCentered="1"/>'
    + '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>'
    + '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="1"/>'
    + '</worksheet>';
}

const FONT = '<name val="游ゴシック"/><family val="3"/><charset val="128"/>';
const BORDER = ['left', 'right', 'top', 'bottom'].map((s) => `<${s} style="thin"><color auto="1"/></${s}>`).join('');
const center = '<alignment horizontal="center" vertical="center" wrapText="1"/>';

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="1"><numFmt numFmtId="164" formatCode="h:mm"/></numFmts>'
  + `<fonts count="3"><font><sz val="11"/>${FONT}</font><font><b/><sz val="16"/>${FONT}</font><font><b/><sz val="10"/>${FONT}</font></fonts>`
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${BORDER}<diagonal/></border></borders>`
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="8">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>'
  + `<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${center}</xf>`
  + `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">${center}</xf>`
  + `<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1">${center}</xf>`
  + `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">${center}</xf>`
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1" shrinkToFit="0"/></xf>'
  + '</cellXfs>'
  + '<cellStyles count="1"><cellStyle name="標準" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

// specs（model.js の monthSheets / yearSheets）から .xlsx のバイト列を作る
export function buildXlsx(specs) {
  const files = [];
  files.push({
    name: '[Content_Types].xml',
    data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + specs.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>'
  });
  files.push({
    name: '_rels/.rels',
    data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>'
  });
  files.push({
    name: 'xl/workbook.xml',
    data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<bookViews><workbookView/></bookViews><sheets>'
      + specs.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
      + '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>'
  });
  files.push({
    name: 'xl/_rels/workbook.xml.rels',
    data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + specs.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${specs.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + '</Relationships>'
  });
  files.push({ name: 'xl/styles.xml', data: STYLES });
  specs.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) }));
  return zip(files);
}
