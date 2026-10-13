// 事故の記録（貨物自動車運送事業輸送安全規則 第九条の二：営業所で3年間保存）
// 項目と並びは、国土交通省の「事故の記録」の様式（別紙・記載例つき）に合わせている。

import { isTime } from './model.js';

export function newAccident(settings, date, time) {
  return {
    id: `acc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    created: date,     // 作成日
    date,              // 事故の発生日
    time,              // 事故の発生時刻
    place: '',
    driverName: settings.driverName,
    vehicleNo: settings.vehicleNo,
    parties: '',       // 事故の当事者（運転者を除く）の氏名
    situation: '',     // 事故の概要：当時の状況
    kind: '',          // 事故の概要：事故の種類
    road: '',          // 事故の概要：道路等の状況
    plan: '',          // 事故の概要：当時の運行計画
    damage: '',        // 事故の概要：損害の程度
    cause: '',         // 事故の原因
    prevention: '',    // 再発防止対策
    police: 'まだ',    // 警察への届出
    office: 'まだ',    // 事務所（運行管理者）への連絡
    annex: newAnnex()  // 別紙（くわしく記録する場合）
  };
}

export function newAnnex() {
  return {
    kinds: [],         // 区分（番号。選んだ順＝発生の順）
    collision: '',     // 衝突等の状態
    roadType: '',      // 道路の種類
    width: '',         // 道路の幅員（m）
    slope: '',         // こう配
    shape: '',         // 道路の形態
    surface: '',       // 路面の状態
    sign: '',          // 警戒標識の設置
    speed: '',         // 当該道路の制限速度（km/h）
    dead: '', deadDrv: '', serious: '', seriousDrv: '', light: '', lightDrv: ''
  };
}

// 以前の版（v0.2.0）の記録を、いまの形にそろえる
export function normalizeAccident(a) {
  const out = { ...newAccident({}, a.date, a.time), ...a, annex: { ...newAnnex(), ...(a.annex || {}) } };
  out.created = a.created || (a.updatedAt || '').slice(0, 10) || a.date;
  if (!out.situation && a.summary) out.situation = a.summary;
  if (!out.damage && a.injury === 'あり') out.damage = 'けが人あり';
  delete out.summary;
  delete out.injury;
  return out;
}

// ---- 別紙の選択肢（国土交通省の様式の別紙） ----

export const KINDS = ['転覆', '転落', '路外逸脱', '火災', '踏切', '衝突', '死傷', '危険物等', '車内', '飲酒等', '健康起因', '救護違反', '車両故障', '交通障害', 'その他'];
export const COLLISIONS = ['正面衝突', '側面衝突', '追突', '接触', '物件衝突'];
export const ROAD_TYPES = ['高速自動車国道', '自動車専用道路等', 'その他の道路', '道路以外の場所'];
export const SLOPES = ['平たん', '上り', '下り'];
export const SHAPES = ['直線', '右曲り', '左曲り', '交差', 'つづら折り'];
export const SURFACES = ['乾', '湿', '積雪', '氷結'];

// 国土交通大臣への報告（30日以内）が必要な事故にあたるおそれ（自動車事故報告規則 第二条）
// 区分：転覆・転落・火災・踏切・危険物等・飲酒等・健康起因・救護違反・車両故障・交通障害、または死者・重傷者・負傷者10人以上
const REPORT_KINDS = ['転覆', '転落', '火災', '踏切', '危険物等', '飲酒等', '健康起因', '救護違反', '車両故障', '交通障害'];
const n = (v) => Number(v) || 0;
export function needsReport(a) {
  const x = a.annex || {};
  if ((x.kinds || []).some((k) => REPORT_KINDS.includes(k))) return true;
  if (n(x.dead) > 0 || n(x.serious) > 0) return true;
  return n(x.dead) + n(x.serious) + n(x.light) >= 10;
}

// ---- 表示 ----

// 2026 → 令和8（様式に合わせて和暦で書く）
export function wareki(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const era = y > 2019 || (y === 2019 && m >= 5) ? `令和${y - 2018 === 1 ? '元' : y - 2018}` : `平成${y - 1988}`;
  return `${era}年${m}月${d}日`;
}

export const accidentWhen = (a) => `${wareki(a.date)}${isTime(a.time) ? ` ${a.time.replace(/^0(\d)/, '$1')}頃` : ''}`;

// 別紙の内容を文章にする（何も入っていなければ空）
export function annexLines(a) {
  const x = a.annex || {};
  const lines = [];
  if (x.kinds?.length) lines.push(['事故の種類（区分）', x.kinds.map((k, i) => `${x.kinds.length > 1 ? `${i + 1}. ` : ''}${k}`).join('　')]);
  if (x.collision) lines.push(['衝突等の状態', x.collision]);
  if (x.roadType) lines.push(['道路の種類', x.roadType]);
  if (x.width !== '' && x.width != null) lines.push(['道路の幅員', `${x.width} m`]);
  if (x.slope) lines.push(['こう配', x.slope]);
  if (x.shape) lines.push(['道路の形態', x.shape]);
  if (x.surface) lines.push(['路面の状態', x.surface]);
  if (x.sign) lines.push(['警戒標識の設置', x.sign]);
  if (x.speed !== '' && x.speed != null) lines.push(['当該道路の制限速度', `${x.speed} km/h`]);
  const people = [['死亡', x.dead, x.deadDrv], ['重傷', x.serious, x.seriousDrv], ['軽傷', x.light, x.lightDrv]]
    .filter(([, v]) => v !== '' && v != null);
  if (people.length) lines.push(['損害の程度（人）', people.map(([t, v, d]) => `${t} ${n(v)}人（うち運転者 ${n(d)}人）`).join('　')]);
  return lines;
}

// その日の運転日報から「当時の運行計画」の下書きを作る
export function planFromRecord(rec, defaultVia = '') {
  if (!rec?.start) return '';
  const s = rec.start;
  const e = rec.end;
  const t = (v) => String(v || '').replace(/^0(\d)/, '$1');
  const v = e?.via || defaultVia;
  const via = v ? `～${v}にて配送` : '';
  const back = e?.time ? `～${t(e.time)} ${e.place || s.place}に帰庫` : `～${s.place}に帰庫予定`;
  return `${t(s.time)} ${s.place}を出庫${via}${back}`;
}

export function validateAccident(a) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date || '')) return '事故の発生日を入れてください';
  if (!String(a.place).trim()) return '事故の発生場所を入れてください';
  if (!String(a.situation).trim()) return '当時の状況を入れてください';
  return null;
}

const sortAcc = (list) => [...list].sort((a, b) => (`${a.date} ${a.time}` < `${b.date} ${b.time}` ? -1 : 1));

// 書き出しの列（Excel・CSV）
const COLUMNS = [
  ['作成日', (a) => (a.created || '').replace(/-/g, '/'), 11, 'text'],
  ['発生日', (a) => a.date.replace(/-/g, '/'), 11, 'text'],
  ['時刻', (a) => (isTime(a.time) ? { time: a.time.replace(/^0(\d)/, '$1') } : null), 7, 'time'],
  ['発生場所', (a) => a.place, 20, 'wide'],
  ['運転者の氏名', (a) => a.driverName, 12, 'text'],
  ['車両番号', (a) => a.vehicleNo, 15, 'text'],
  ['当事者の氏名\n（運転者を除く）', (a) => a.parties, 16, 'wide'],
  ['当時の状況', (a) => a.situation, 50, 'wide'],
  ['事故の種類', (a) => a.kind, 14, 'wide'],
  ['道路等の状況', (a) => a.road, 20, 'wide'],
  ['当時の運行計画', (a) => a.plan, 24, 'wide'],
  ['損害の程度', (a) => a.damage, 20, 'wide'],
  ['事故の原因', (a) => a.cause, 26, 'wide'],
  ['再発防止対策', (a) => a.prevention, 30, 'wide'],
  ['別紙', (a) => annexLines(a).map(([k, v]) => `${k}：${v}`).join('\n'), 28, 'wide'],
  ['警察への\n届出', (a) => a.police, 9, 'text'],
  ['事務所への\n連絡', (a) => a.office, 9, 'text']
];

// Excel 用（xlsx.js の sheetXml が読む形）
export function accidentSheet(list, settings) {
  return {
    name: '事故の記録',
    title: '事故の記録',
    info: [
      { c: [0, 3], text: `運転者名: ${settings.driverName || ''}` },
      { c: [4, 6], text: `営業所: ${settings.office || ''}` },
      { c: [7, 9], text: `事業者名：${settings.company || ''}` },
      { c: [10, 12], text: '保存期間：3年' }
    ],
    widths: COLUMNS.map((c) => c[2]),
    kinds: COLUMNS.map((c) => c[3]),
    headRows: 1,
    head: COLUMNS.map((c, i) => ({ r: [0, 0], c: [i, i], text: c[0] })),
    formulas: {},
    rowHeight: 150,
    rows: sortAcc(list).map((a) => COLUMNS.map((c) => {
      const v = c[1](a);
      return v === '' || v == null ? null : v;
    }))
  };
}

const csvCell = (v) => {
  const s = v && typeof v === 'object' ? v.time : String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function accidentCsv(list) {
  const lines = [COLUMNS.map((c) => c[0].replace('\n', '')).join(',')];
  for (const a of sortAcc(list)) lines.push(COLUMNS.map((c) => csvCell(c[1](a))).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

