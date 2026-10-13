// 記録の形と、帳票（運転日報・点呼記録簿）の組み立て。
// 帳票の列は、事務所の年間ブック（{年}{運転者名}.xlsx）と同じ並びにしている。

export const DEFAULT_SETTINGS = {
  driverName: '',
  office: '',
  vehicleNo: '',
  company: 'ドライバーズサポート株式会社',
  startPlace: '',      // 乗務開始地点（＝乗務終了地点）
  via: '',             // 主な経過地点
  restPlace: '',       // 休憩・睡眠地点
  restMin: 60,         // 休憩・睡眠時間（分）
  method: 'LINE',      // 点呼方法
  rollcaller: '',      // 点呼実施者名
  initialOdo: null,    // 使い始めたときのメーターの距離
  oilChanges: [],      // オイル交換の記録 [{ id, date, odo, note }]
  oilAck: null,        // 見せたオイル交換のお知らせ { changeId, level }
  shakenDate: '',      // 車検の満了日（任意）
  licenseDate: '',     // 運転免許証の有効期限（任意）
  expiryAck: {},       // 見せた期限のお知らせ { shaken: { date, stage }, license: { date, stage } }
  salesType: '',       // 売上表：'sagawa'（佐川急便）・'daily'（日当の案件）
  salesOffice: '',     // 佐川急便の営業所（単価表の営業所名、または「その他」）
  salesOfficeName: '', // 「その他」のときの営業所名
  salesStartDate: '',  // 稼働を開始した日（新人保証の期間を数える）
  priceTakuhai: '',    // 単価（円/個）宅配
  priceShogyo: '',     // 単価 商業（空なら宅配と同じ）
  priceShuka: '',      // 単価 集荷（空なら宅配と同じ）
  salesProject: '',    // 日当の案件の所属（案件名）
  dailyRate: '',       // 日当（円）
  advance: {},         // 希望する前払い額 { 'YYYY-MM': 円 }
  lastVersion: '',     // 最後に開いたアプリの版（アップデートのお知らせ用）
  retention: '1年間'
};

export const METHODS = ['LINE', '対面', '電話', 'その他'];

// 乗務前（出発するとき）の初期値
export function newStart(settings, odo, time) {
  return {
    time,
    method: settings.method || 'LINE',
    alcohol: '有',       // アルコール検知器使用
    drunk: '無',         // 酒気帯びの有無
    health: '良好',      // 健康状態
    inspection: '良好',  // 日常点検結果
    instruction: '無',   // 指示事項
    place: settings.startPlace,
    odo: odo ?? ''
  };
}

// 乗務後（帰ってきたとき）の初期値
export function newEnd(settings, time) {
  return {
    time,
    method: settings.method || 'LINE',
    alcohol: '有',
    drunk: '無',
    report: '無',        // 運行状況報告
    vehicle: '無',       // 車両異常の有無
    place: settings.startPlace,
    odo: '',
    via: settings.via,
    restPlace: settings.restPlace,
    restMin: settings.restMin ?? 60,
    wait: '無',          // 荷主都合30分以上待機
    cargo: '有',         // 荷役作業の有無
    relief: '無',        // 交替運転 地点・時刻
    accident: '無',      // 事故・異常の概要
    note: '無'           // 備考
  };
}

// ---- 日付・時刻 ----

export const pad2 = (n) => String(n).padStart(2, '0');
export const dateKey = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
export const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
export const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
export const weekday = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return WEEK[new Date(y, m - 1, d).getDay()];
};

export function todayKey(now = new Date()) {
  return dateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function nowTime(now = new Date()) {
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

export function isTime(s) {
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
}

// "7:20" → Excelの時刻（1日＝1）
export function timeToSerial(s) {
  const [h, m] = String(s).split(':').map(Number);
  return (h * 60 + m) / 1440;
}

// ---- 走行距離 ----

export const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

export function distanceOf(rec) {
  const a = num(rec?.start?.odo);
  const b = num(rec?.end?.odo);
  return a != null && b != null ? b - a : null;
}

// その日より前の、いちばん新しいメーターの距離（次の日の開始距離の初期値）
export function prevOdo(records, key, settings) {
  const before = records.filter((r) => r.date < key).sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const r of before) {
    const end = num(r.end?.odo);
    if (end != null) return end;
    const start = num(r.start?.odo);
    if (start != null) return start;
  }
  return num(settings.initialOdo);
}

// ---- 帳票 ----
// セルの値：数値・文字・{ time: 'H:MM' }・null（空欄）

const clean = (v) => (v == null ? '' : String(v));
// "07:05" → "7:05"（事務所のブックと同じ書き方）
const t = (s) => (isTime(s) ? { time: String(s).replace(/^0(\d)/, '$1') } : null);
const n = (v) => num(v);

// 休みの日は、事務所の書式を崩さないよう「備考」に「休み」と書く
const offRow = (day) => [day, ...Array(14).fill(null), '休み'];
// 以前の版で「休み」にした記録
export const isOff = (rec) => !!rec?.off && !rec.start && !rec.end;

// 休みの日：今日より前で、乗務前・乗務後のどちらも記録がない日（走行距離を入れなかった日）は自動で休み。
// 今日はまだ記録の途中かもしれないので休みにしない
export function isOffDay(rec, key, today = todayKey()) {
  if (rec?.start || rec?.end) return false;
  return isOff(rec) || key < today;
}

function dailyRow(day, rec, off = isOff(rec)) {
  const s = rec?.start;
  const e = rec?.end;
  if (off) return offRow(day);
  if (!s && !e) return [day, ...Array(15).fill(null)];
  const dist = distanceOf(rec);
  return [
    day,
    clean(s?.place) || null,
    t(s?.time),
    e ? clean(e.place) || null : null,
    e ? t(e.time) : null,
    e ? clean(e.via) || null : null,
    s ? n(s.odo) : null,
    e ? n(e.odo) : null,
    dist,
    e ? clean(e.restPlace) || null : null,
    e ? n(e.restMin) : null,
    e ? clean(e.wait) : null,
    e ? clean(e.cargo) : null,
    e ? clean(e.relief) : null,
    e ? clean(e.accident) : null,
    e ? clean(e.note) : null
  ];
}

function rollcallRow(day, rec, off = isOff(rec)) {
  const s = rec?.start;
  const e = rec?.end;
  if (off) return offRow(day);
  if (!s && !e) return [day, ...Array(15).fill(null)];
  return [
    day,
    s ? t(s.time) : null,
    s ? clean(s.method) : null,
    s ? clean(s.alcohol) : null,
    s ? clean(s.drunk) : null,
    s ? clean(s.health) : null,
    s ? clean(s.inspection) : null,
    s ? clean(s.instruction) : null,
    e ? t(e.time) : null,
    e ? clean(e.method) : null,
    e ? clean(e.alcohol) : null,
    e ? clean(e.drunk) : null,
    e ? clean(e.report) : null,
    e ? clean(e.vehicle) : null,
    clean(rec.rollcaller) || null,
    null
  ];
}

// 1か月分の「運転日報」「点呼記録簿」の2枚。xlsx.js と pdf.js がこの形を使う。
// 列番号は0始まり。info・head の範囲は [開始列, 終了列]。
export function monthSheets(records, year, month, settings, today = todayKey()) {
  const byDate = new Map(records.map((r) => [r.date, r]));
  const days = daysInMonth(year, month);
  const recs = Array.from({ length: days }, (_, i) => byDate.get(dateKey(year, month, i + 1)));
  const offs = recs.map((rec, i) => isOffDay(rec, dateKey(year, month, i + 1), today));
  const name = clean(settings.driverName);
  const ym = `${year}年 ${month}月`;
  const info = [
    { c: [0, 1], text: ym },
    { c: [2, 4], text: `運転者名: ${name}` },
    { c: [5, 6], text: `車両番号: ${clean(settings.vehicleNo)}` },
    { c: [7, 9], text: `営業所: ${clean(settings.office)}` },
    { c: [10, 13], text: `事業者名：${clean(settings.company)}` },
    { c: [14, 15], text: `保存期間：${clean(settings.retention) || '1年間'}` }
  ];

  const daily = {
    name: `運転日報${month}月`,
    title: '運転日報',
    info,
    widths: [6.6, 14, 9, 14, 9, 27.6, 13, 13, 10, 17, 10, 12, 10, 14, 16, 16],
    // 文字（中央）text・左寄せ wide・時刻 time・数値 num
    kinds: ['num', 'text', 'time', 'text', 'time', 'wide', 'num', 'num', 'num', 'wide', 'num', 'text', 'text', 'text', 'text', 'text'],
    headRows: 1,
    head: ['日付', '乗務開始\n地点', '乗務開始\n時刻', '乗務終了\n地点', '乗務終了\n時刻', '主な経過地点\n（集荷/納品先等）',
        '開始時\n走行距離(km)', '終了時\n走行距離(km)', '従事距離\n(km)', '休憩・睡眠\n地点', '休憩・睡眠\n時間(分)',
        '荷主都合\n30分以上待機', '荷役作業\nの有無', '交替運転\n地点・時刻', '事故・異常\nの概要', '備考']
      .map((text, i) => ({ r: [0, 0], c: [i, i], text })),
    // 終了時走行距離は、事務所のブックと同じく「開始＋従事距離」の式にする
    formulas: { 7: (row) => `SUM(G${row},I${row})` },
    rows: recs.map((rec, i) => dailyRow(i + 1, rec, offs[i]))
  };

  const rollcall = {
    name: `点呼記録簿${month}月`,
    title: '点呼記録簿',
    info,
    widths: [6.6, 9, 13, 10, 10, 10, 10, 12, 9, 13, 10, 10, 10, 10, 13, 12],
    kinds: ['num', 'time', 'text', 'text', 'text', 'text', 'text', 'text', 'time', 'text', 'text', 'text', 'text', 'text', 'text', 'text'],
    headRows: 2,
    head: [
      { r: [0, 1], c: [0, 0], text: '日付' },
      { r: [0, 0], c: [1, 7], text: '乗務前点呼' },
      { r: [0, 0], c: [8, 13], text: '乗務後点呼' },
      { r: [0, 1], c: [14, 14], text: '点呼実施者名' },
      { r: [0, 1], c: [15, 15], text: '備考' },
      ...['点呼時刻', '点呼方法\n（対面/電話等）', 'アルコール\n検知器使用', '酒気帯び\nの有無', '健康状態', '日常点検\n結果', '指示事項']
        .map((text, i) => ({ r: [1, 1], c: [1 + i, 1 + i], text })),
      ...['点呼時刻', '点呼方法\n（対面/電話等）', 'アルコール\n検知器使用', '酒気帯び\nの有無', '運行状況\n報告', '車両異常\nの有無']
        .map((text, i) => ({ r: [1, 1], c: [8 + i, 8 + i], text }))
    ],
    formulas: {},
    rows: recs.map((rec, i) => rollcallRow(i + 1, rec, offs[i]))
  };
  return [daily, rollcall];
}

// 1年分（事務所のブックと同じく、運転日報1〜12月 → 点呼記録簿1〜12月の順）
export function yearSheets(records, year, settings, today = todayKey()) {
  const months = Array.from({ length: 12 }, (_, i) => monthSheets(records, year, i + 1, settings, today));
  return [...months.map((m) => m[0]), ...months.map((m) => m[1])];
}

// その月に記録があるか
export function hasMonth(records, year, month) {
  const prefix = `${year}-${pad2(month)}-`;
  return records.some((r) => r.date.startsWith(prefix));
}

// ---- CSV ----

export const CSV_HEAD = [
  '日付', '乗務開始地点', '乗務開始時刻', '乗務終了地点', '乗務終了時刻', '主な経過地点',
  '開始時走行距離(km)', '終了時走行距離(km)', '従事距離(km)', '休憩・睡眠地点', '休憩・睡眠時間(分)',
  '荷主都合30分以上待機', '荷役作業の有無', '交替運転地点・時刻', '事故・異常の概要', '備考',
  '乗務前_点呼時刻', '乗務前_点呼方法', '乗務前_アルコール検知器使用', '乗務前_酒気帯びの有無', '乗務前_健康状態',
  '乗務前_日常点検結果', '乗務前_指示事項',
  '乗務後_点呼時刻', '乗務後_点呼方法', '乗務後_アルコール検知器使用', '乗務後_酒気帯びの有無', '乗務後_運行状況報告',
  '乗務後_車両異常の有無', '点呼実施者名'
];

const csvCell = (v) => {
  if (v == null) return '';
  const s = typeof v === 'object' ? v.time : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// 記録のある日と休みの日を1日1行で書き出す（先頭にBOMを付け、Excelで文字化けしないようにする）
export function toCsv(records, from, to, today = todayKey()) {
  const lines = [CSV_HEAD.join(',')];
  const byDate = new Map(records.map((r) => [r.date, r]));
  const [fy, fm, fd] = from.split('-').map(Number);
  for (let dt = new Date(fy, fm - 1, fd); ; dt.setDate(dt.getDate() + 1)) {
    const key = dateKey(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    if (key > to) break;
    const rec = byDate.get(key);
    const off = isOffDay(rec, key, today);
    if (!off && !rec?.start && !rec?.end) continue; // 今日以降で記録のない日
    const day = dt.getDate();
    const d = dailyRow(day, rec, off).slice(1);
    const r = rollcallRow(day, rec, off).slice(1, 15);
    lines.push([key.replace(/-/g, '/'), ...d, ...r].map(csvCell).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
