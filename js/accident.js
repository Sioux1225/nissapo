// 事故の記録（貨物自動車運送事業輸送安全規則 第九条の二：営業所で3年間保存）
// 記録する事項：乗務員等の氏名・車両番号・発生日時・発生場所・当事者の氏名・概要（損害の程度を含む）・原因・再発防止対策

import { isTime } from './model.js';

export function newAccident(settings, date, time) {
  return {
    id: `acc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    date,
    time,
    place: '',
    driverName: settings.driverName,
    vehicleNo: settings.vehicleNo,
    parties: '',     // 事故の当事者（乗務員等を除く）の氏名
    summary: '',     // 事故の概要（損害の程度を含む）
    cause: '',       // 事故の原因
    prevention: '',  // 再発防止対策
    injury: 'なし',  // けが人
    police: 'まだ',  // 警察への届出
    office: 'まだ'   // 事務所（運行管理者）への連絡
  };
}

// 記録に書く項目（画面・PDF・Excel・CSV で同じ並び）
export const ACCIDENT_FIELDS = [
  { key: 'driverName', label: '乗務員等の氏名' },
  { key: 'vehicleNo', label: '車両番号' },
  { key: 'when', label: '発生日時' },
  { key: 'place', label: '発生場所' },
  { key: 'parties', label: '事故の当事者の氏名（乗務員等を除く）' },
  { key: 'summary', label: '事故の概要（損害の程度を含む）' },
  { key: 'cause', label: '事故の原因' },
  { key: 'prevention', label: '再発防止対策' },
  { key: 'injury', label: 'けが人' },
  { key: 'police', label: '警察への届出' },
  { key: 'office', label: '事務所への連絡' }
];

export const accidentWhen = (a) => {
  const [y, m, d] = a.date.split('-').map(Number);
  return `${y}年${m}月${d}日${isTime(a.time) ? ` ${a.time.replace(/^0(\d)/, '$1')}` : ''}`;
};

export const accidentValue = (a, key) => (key === 'when' ? accidentWhen(a) : String(a[key] ?? ''));

export function validateAccident(a) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date || '')) return '発生した日を入れてください';
  if (!String(a.place).trim()) return '発生場所を入れてください';
  if (!String(a.summary).trim()) return '事故の概要を入れてください';
  return null;
}

const sortAcc = (list) => [...list].sort((a, b) => (`${a.date} ${a.time}` < `${b.date} ${b.time}` ? -1 : 1));

// Excel 用（xlsx.js の sheetXml が読む形）
export function accidentSheet(list, settings) {
  const cols = ['発生日', '時刻', '発生場所', '乗務員等の氏名', '車両番号', '当事者の氏名\n（乗務員等を除く）',
    '事故の概要\n（損害の程度を含む）', '事故の原因', '再発防止対策', 'けが人', '警察への\n届出', '事務所への\n連絡'];
  return {
    name: '事故の記録',
    title: '事故の記録',
    info: [
      { c: [0, 2], text: `運転者名: ${settings.driverName || ''}` },
      { c: [3, 5], text: `営業所: ${settings.office || ''}` },
      { c: [6, 8], text: `事業者名：${settings.company || ''}` },
      { c: [9, 11], text: '保存期間：3年間' }
    ],
    widths: [12, 7, 22, 13, 16, 18, 36, 28, 28, 8, 9, 9],
    kinds: ['text', 'time', 'wide', 'text', 'text', 'wide', 'wide', 'wide', 'wide', 'text', 'text', 'text'],
    headRows: 1,
    head: cols.map((text, i) => ({ r: [0, 0], c: [i, i], text })),
    formulas: {},
    rowHeight: 72,
    rows: sortAcc(list).map((a) => [
      a.date.replace(/-/g, '/'), isTime(a.time) ? { time: a.time.replace(/^0(\d)/, '$1') } : null,
      a.place, a.driverName, a.vehicleNo, a.parties, a.summary, a.cause, a.prevention, a.injury, a.police, a.office
    ].map((v) => (v === '' ? null : v)))
  };
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function accidentCsv(list) {
  const head = ['発生日', '時刻', ...ACCIDENT_FIELDS.filter((f) => f.key !== 'when').map((f) => f.label)];
  const lines = [head.join(',')];
  for (const a of sortAcc(list)) {
    lines.push([a.date.replace(/-/g, '/'), a.time, ...ACCIDENT_FIELDS.filter((f) => f.key !== 'when').map((f) => a[f.key])].map(csvCell).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
