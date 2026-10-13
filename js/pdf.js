// PDF を外部のプログラムなしで作る。
// 帳票を画面の裏で画像（A4横）に描き、その画像を1ページずつPDFに貼る。
// 日本語の文字をPDFに入れるには大きなフォントファイルが要るため、画像にする方法をとっている。

import { concat } from './xlsx.js';

const enc = new TextEncoder();

// A4横（pt）
const PAGE_W = 841.89;
const PAGE_H = 595.28;

// pages：[{ jpeg: Uint8Array, width, height }]
export function buildPdf(pages) {
  const parts = [];
  const offsets = [];
  let len = 0;
  const push = (x) => {
    const b = typeof x === 'string' ? enc.encode(x) : x;
    parts.push(b);
    len += b.length;
  };
  const obj = (id, body) => {
    offsets[id] = len;
    push(`${id} 0 obj\n`);
    for (const b of body) push(b);
    push('\nendobj\n');
  };

  push('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');
  const pageIds = pages.map((_, i) => 3 + i * 3);
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  obj(2, [`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`]);
  pages.forEach((p, i) => {
    const id = pageIds[i];
    const content = `q ${PAGE_W} 0 0 ${PAGE_H} 0 0 cm /Im1 Do Q`;
    obj(id, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /XObject << /Im1 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`]);
    obj(id + 1, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
    obj(id + 2, [
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      '\nendstream'
    ]);
  });
  const count = 3 + pages.length * 3;
  const xref = len;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id++) table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return concat(parts);
}

// ---- 帳票を画像に描く（ブラウザでのみ動く） ----

const PX_W = 2339; // A4横・約200dpi
const PX_H = 1654;
const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", sans-serif';

function fitText(ctx, text, maxW, size, weight = 400) {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (s > 12 && ctx.measureText(text).width > maxW) {
    s -= 1;
    ctx.font = `${weight} ${s}px ${FONT}`;
  }
  if (ctx.measureText(text).width <= maxW) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(out + '…').width > maxW) out = out.slice(0, -1);
  return out + '…';
}

// 複数行（\n区切り）をセルの中央に描く
function drawLines(ctx, text, x, y, w, h, { size, weight = 400, align = 'center' }) {
  const lines = String(text).split('\n');
  const lh = size * 1.25;
  const top = y + h / 2 - (lh * lines.length) / 2 + lh / 2;
  ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    const s = fitText(ctx, line, w - 12, size, weight);
    ctx.textAlign = align;
    const tx = align === 'left' ? x + 8 : x + w / 2;
    ctx.fillText(s, tx, top + i * lh);
  });
}

const cellText = (v) => (v == null ? '' : typeof v === 'object' ? v.time : String(v));

export function renderSheet(spec) {
  const canvas = document.createElement('canvas');
  canvas.width = PX_W;
  canvas.height = PX_H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, PX_W, PX_H);
  ctx.fillStyle = '#000000';
  ctx.strokeStyle = '#000000';

  const margin = 70;
  const tableW = PX_W - margin * 2;
  const total = spec.widths.reduce((s, w) => s + w, 0);
  const xs = [margin];
  spec.widths.forEach((w) => xs.push(xs[xs.length - 1] + (w / total) * tableW));

  // 表題
  ctx.font = `700 46px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(spec.title, PX_W / 2, 70);

  // 年月・運転者名など
  for (const it of spec.info) {
    drawLines(ctx, it.text, xs[it.c[0]], 112, xs[it.c[1] + 1] - xs[it.c[0]], 50, { size: 25, align: 'left' });
  }

  // 見出し
  const headTop = 172;
  const headH = spec.headRows === 1 ? 92 : 56;
  ctx.lineWidth = 2;
  for (const h of spec.head) {
    const x = xs[h.c[0]];
    const y = headTop + h.r[0] * headH;
    const w = xs[h.c[1] + 1] - x;
    const hh = (h.r[1] - h.r[0] + 1) * headH;
    ctx.fillStyle = '#EFEFEF';
    ctx.fillRect(x, y, w, hh);
    ctx.fillStyle = '#000000';
    ctx.strokeRect(x, y, w, hh);
    drawLines(ctx, h.text, x, y, w, hh, { size: 21, weight: 700 });
  }

  // 本文（31日分の行の高さで描く。月の日数が少なくても行の高さは同じ）
  const bodyTop = headTop + headH * spec.headRows;
  const rowH = (PX_H - margin - bodyTop) / 31;
  spec.rows.forEach((row, i) => {
    const y = bodyTop + i * rowH;
    row.forEach((v, c) => {
      const x = xs[c];
      const w = xs[c + 1] - x;
      ctx.strokeRect(x, y, w, rowH);
      const text = cellText(v);
      if (text) drawLines(ctx, text, x, y, w, rowH, { size: 22, align: spec.kinds[c] === 'wide' ? 'left' : 'center' });
    });
  });
  return canvas;
}

function canvasJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) { reject(new Error('画像を作れませんでした')); return; }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/jpeg', 0.9);
  });
}

export async function specsToPdf(specs) {
  const pages = [];
  for (const spec of specs) {
    const canvas = renderSheet(spec);
    pages.push({ jpeg: await canvasJpeg(canvas), width: canvas.width, height: canvas.height });
  }
  return buildPdf(pages);
}
