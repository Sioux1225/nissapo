// 日報サポート：運転日報と点呼記録簿をスマホで簡単に記録するアプリ
// 画面：はじめての設定 → ホーム（乗務前・乗務後のボタン）→ 一覧 → 書き出し・共有

import { db, requestPersist } from './db.js';
import { shrinkImage, newPhoto, blobToDataUrl, dataUrlToBlob } from './photo.js';
import { COUNT_KEYS, unitPrices, salesReady, monthSales, yen, advanceKey, advanceOf, advanceHistory, advanceTotal, advanceLimit, isFirstAdvanceMonth, prevSalesLevel, SHIFTS, hasExtra, sagawaJob, newbieRule, officeName, newbiePeriod, newbieDates, newbieSpan, sagawaMissing, jobList, jobsOf, dayJobs, jobLabel, jobReady, jobUnits, sagawaSettings, hasSagawa, isFixedSagawa, UNIT_SLOTS } from './sales.js';
import { EXPIRED, expiryStatus, expiryMessage, expiryAlertsToShow } from './expiry.js';
import { OIL_LIMIT, OIL_STEPS, newOilChange, currentOdo, oilStatus, oilMessage, oilAlertToShow, sortOilChanges } from './oil.js';
import {
  backupReminder, DEFAULT_SETTINGS, newStart, newEnd, todayKey, nowTime, isTime, num, distanceOf, prevOdo,
  monthSheets, yearSheets, hasMonth, toCsv, daysInMonth, dateKey, weekday, pad2, isOff, isOffDay
} from './model.js';
import { buildXlsx } from './xlsx.js';
import { verifyInvite, inviteStatus, parseInvite } from './invite.js';
import { specsToPdf, renderSheet, renderAccident, renderAnnex, renderPhotoPage, renderSalesSheet, renderSalesDetail, canvasesToPdf } from './pdf.js';
import {
  newAccident, normalizeAccident, accidentWhen, wareki, annexLines, needsReport, planFromRecord, validateAccident, accidentSheet, accidentCsv,
  KINDS, COLLISIONS, ROAD_TYPES, SLOPES, SHAPES, SURFACES
} from './accident.js';

export const APP_VERSION = '0.24.0';

const app = document.getElementById('app');
const state = {
  view: 'home',
  settings: { ...DEFAULT_SETTINGS },
  records: [],
  accidents: [],
  accPhotos: [],      // 入力中の事故の写真 [{ id, blob, url }]
  acc: null,          // 入力中の事故の記録
  draft: null,        // 入力中の1日分 { date, start, end, rollcaller }
  mode: null,         // 'start' | 'end' | 'day'
  back: 'home',
  month: null,        // 一覧で表示している月 { y, m }
  exp: { doc: 'nippo', period: 'month', y: 0, m: 0, format: 'xlsx' },
  invite: 'ok',       // 招待コード 'ok' | 'none'（まだ・正しくない）| 'revoked'（止めた番号）
  inviteName: '',     // 招待の名前（運転者名はこの名前に固定）
  busy: false
};

// ---- 小さな道具 ----

const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const findRecord = (date) => state.records.find((r) => r.date === date);
const label = (key) => {
  const [, m, d] = key.split('-').map(Number);
  return `${m}月${d}日（${weekday(key)}）`;
};
const hm = (s) => String(s ?? '').replace(/^0(\d)/, '$1'); // "07:05" → "7:05"
const fmtKm = (v) => (v == null ? '' : `${v.toLocaleString('ja-JP')} km`);

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
}

let toastTimer;
function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// 確認の画面（ブラウザの confirm は使えない環境があるので、画面の中に出す）
function ask(message, okLabel, danger = false, cancelLabel = 'やめる', title = '') {
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'dialog';
    box.innerHTML = `<div class="dialog-box" role="alertdialog" aria-modal="true">
      ${title ? `<h2 class="dialog-title ${danger ? 'danger' : ''}">${e(title)}</h2>` : ''}
      <p>${e(message)}</p>
      <div class="btn-row two">
        <button type="button" class="btn-outline" data-answer="no">${e(cancelLabel)}</button>
        <button type="button" class="${danger ? 'btn-danger' : 'btn-primary'}" data-answer="yes">${e(okLabel)}</button>
      </div></div>`;
    box.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-answer]');
      if (!b && ev.target !== box) return;
      box.remove();
      resolve(b?.dataset.answer === 'yes');
    });
    document.body.append(box);
    box.querySelector('[data-answer="yes"]').focus();
  });
}

// アプリのロゴ（ホーム画面のアイコンと同じ絵。確サポの LOGO と同じ作り）
const LOGO = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 160 160" aria-hidden="true">
  <rect x="2" y="2" width="156" height="156" rx="34" fill="#FFFFFF" stroke="#E6E6E6" stroke-width="4"/>
  <rect x="48" y="26" width="66" height="98" rx="7" fill="none" stroke="#F39801" stroke-width="11" stroke-linejoin="round"/>
  <rect x="37" y="43" width="22" height="10" rx="5" fill="#7D7D7D"/>
  <rect x="37" y="70" width="22" height="10" rx="5" fill="#7D7D7D"/>
  <rect x="37" y="97" width="22" height="10" rx="5" fill="#7D7D7D"/>
  <circle cx="70" cy="62" r="7" fill="#7D7D7D"/><circle cx="94" cy="62" r="7" fill="#7D7D7D"/>
  <path d="M68 83 Q82 97 96 83" fill="none" stroke="#7D7D7D" stroke-width="8" stroke-linecap="round"/>
  <circle cx="118" cy="116" r="23" fill="#F39801" stroke="#FFFFFF" stroke-width="6"/>
  <path d="M108 116 L115.5 123.5 L129 109" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const WORDMARK = '<span class="wordmark" aria-label="日報サポート"><span class="g">日報</span><span class="o">サポート</span></span>';

// ホームのボタンの頭に付けるマーク（薄いオレンジの角丸の中に、オレンジの線のマーク）
const mark = (path) => `<span class="btn-mark" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${path}</svg></span>`;
const MARK = {
  list: mark('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'),
  share: mark('<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>'),
  yen: mark('<path d="M6 4l6 8 6-8M12 12v8M7 13h10M7 17h10"/>'),
  warn: mark('<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/>')
};

const ICON = {
  gear: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  back: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
  prev: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  next: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>'
};

// ---- 部品 ----

function seg(path, options, value) {
  return `<div class="seg" role="group">${options.map((o) => {
    const [v, text] = Array.isArray(o) ? o : [o, o];
    return `<button type="button" data-seg="${e(path)}" data-value="${e(v)}" aria-pressed="${v === value}">${e(text)}</button>`;
  }).join('')}</div>`;
}

function field(labelText, inner, note = '') {
  return `<label class="field"><span class="field-label">${labelText}</span>${inner}${note ? `<span class="field-note">${note}</span>` : ''}</label>`;
}

function segField(labelText, path, options) {
  return `<div class="field"><span class="field-label">${labelText}</span>${seg(path, options, getPath(state.draft, path))}</div>`;
}

function input(path, attrs = '') {
  let v = getPath(state.draft, path);
  // 時刻の欄は「07:10」の形でないと空に見えるので、「7:10」のような記録も前に0を付けて出す
  if (attrs.includes('type="time"') && /^\d:\d\d$/.test(v ?? '')) v = `0${v}`;
  return `<input data-bind="${e(path)}" value="${e(v)}" ${attrs}>`;
}

const head = (title, back = 'home') =>
  `<div class="form-head"><button type="button" class="icon-btn plain" data-action="go" data-view="${back}" data-back-btn aria-label="戻る">${ICON.back}</button><h1>${title}</h1></div>`;

// ---- 画面：はじめての設定・設定 ----

// 設定：アプリを使う前の前月の売上（40万円以上・40万円未満・なし）。使い始めた月が過ぎたら「なし」
function prevSalesField(s) {
  const start = isStartMonth(s);
  const cur = start ? prevLevelNow(s) : 'none';
  return `<div class="field"><span class="field-label">前月（${prevMonthNum()}月）の売上（アプリを使う前）</span>
      <div class="picks three">${[['over', '40万円以上'], ['under', '40万円未満'], ['none', 'なし']].map(([v, t]) => `<button type="button" class="chip" data-setting-seg="prevSalesLevel" data-value="${v}" aria-pressed="${cur === v}" ${start ? '' : 'disabled'}>${t}</button>`).join('')}</div>
      <span class="field-note">${start
        ? 'アプリを使う前から稼働していた方は前月の売上を、はじめて稼働する方は「なし」を選んでください。前月の記録がアプリにないときに、留保がいるかどうかの判断に使います（40万円未満なら留保）。'
        : 'アプリを使い始めた月が過ぎたので「なし」になっています（前月の売上は、アプリの記録から計算します）。'}</span></div>`;
}

// 設定：このアプリを使う前に今月すでに受けた前払い（金額を入れるか「なし」を選ぶ）。使い始めた月が過ぎたら「なし」
function priorAdvanceField(s) {
  const start = isStartMonth(s);
  if (!start) {
    return `<div class="field"><span class="field-label">アプリを使う前に受けた前払い</span>
      <div class="prior-row"><input value="" placeholder="なし" disabled aria-label="アプリを使う前に受けた前払い"><button type="button" class="chip" aria-pressed="true" disabled>なし</button></div>
      <span class="field-note">アプリを使い始めた月が過ぎたので「なし」になっています。前払いを受けたら、売上表の「前払いを記録する」から入れてください。</span></div>`;
  }
  const none = s.priorAdvanceNone === thisMonthKey();
  return `<div class="field"><span class="field-label">今月（${Number(thisMonthKey().slice(5))}月）すでに受けた前払いの金額（円）</span>
    <div class="prior-row">
      <input data-setting="priorAdvance" value="${none ? '' : e(s.priorAdvance ?? '')}" type="text" inputmode="numeric" placeholder="例：20000" aria-label="今月すでに受けた前払いの金額" class="${none ? 'is-none' : ''}">
      <button type="button" class="chip" data-action="prior-none" aria-pressed="${none}">なし</button>
    </div>
    <span class="field-note">このアプリを使う前に、今月受けた前払いがあれば金額を、なければ「なし」を選んでください。売上表の前払いの合計に入り、前払い可能額の計算で差し引きます。</span></div>`;
}

// 設定の「保存する」を押す前に入っていない項目（期限のお知らせ・前月の売上は任意）
function settingsMissing(s) {
  const has = (v) => String(v ?? '').trim() !== '';
  const miss = [];
  [['driverName', '運転者名'], ['office', '営業所（勤務先）'], ['vehicleNo', '車両番号'], ['company', '屋号（ない場合は氏名）'],
    ['startPlace', '乗務開始・終了地点'], ['via', '主な経過地点'], ['restPlace', '休憩地点'], ['restMin', '休憩時間'], ['initialOdo', '今のメーターの距離']]
    .forEach(([k, label]) => { if (!has(s[k])) miss.push(label); });
  const jobs = jobList(s);
  if (!jobs.length) miss.push('案件');
  // 法人は営業所名も入れてもらう（計算には使わないので、以前の版の案件は営業所名がなくても数える）
  jobs.forEach((j, i) => { if (!jobReady(j) || (j.kind === 'corp' && !String(j.branch || '').trim())) miss.push(`案件${i + 1}（${jobMissing(j)}）`); });
  if (!has(s.salesStartDate)) miss.push('稼働を開始した日');
  if (!s.leaseCar) miss.push('リース車両');
  if (isStartMonth(s)) {
    if (!['over', 'under', 'none'].includes(prevLevelNow(s))) miss.push('前月の売上（40万円以上・未満か「なし」）');
    if (!(s.priorAdvanceNone === thisMonthKey() || (s.priorAdvanceMonth === thisMonthKey() && num(s.priorAdvance) > 0))) miss.push('今月すでに受けた前払い（金額か「なし」）');
  }
  return miss;
}

// 保存のボタン（入っていない項目があるときは押せない）
function saveSettingsButton(label) {
  const miss = settingsMissing(state.settings);
  return `<p class="save-hint warn-text" id="save-hint" ${miss.length ? '' : 'hidden'}>まだ入っていない項目：${e(miss.join('、'))}</p>
    <button type="button" class="btn-primary" data-action="save-settings" data-next="home" ${miss.length ? 'disabled' : ''}>${label}</button>`;
}
function updateSaveState() {
  const btn = app.querySelector('[data-action="save-settings"]');
  const hint = app.querySelector('#save-hint');
  if (!btn || !hint) return;
  const miss = settingsMissing(state.settings);
  btn.disabled = miss.length > 0;
  hint.hidden = !miss.length;
  hint.textContent = `まだ入っていない項目：${miss.join('、')}`;
}

// 今月（'YYYY-MM'）・前月
const thisMonthKey = () => todayKey().slice(0, 7);
const prevMonthKey = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
const prevMonthNum = () => Number(prevMonthKey().slice(5));
// 設定の「前月の売上」は、選んだときの前月が今の前月と同じときだけ選ばれている
const prevLevelNow = (s) => (s.prevSalesMonth === prevMonthKey() ? s.prevSalesLevel || '' : '');
// 「前月の売上」と「今月すでに受けた前払い」は、アプリを使い始める前のことを聞く欄。
// 使い始めた月（はじめて設定を保存した月）だけ入れてもらい、月が変わったら自動で「なし」にする
const startMonth = (s) => s.appStartMonth || thisMonthKey();
const isStartMonth = (s) => startMonth(s) === thisMonthKey();

// 案件の足りない入力（「保存する」の上に出す）
function jobMissing(j) {
  if (j.kind !== 'sagawa' && j.kind !== 'corp') return '佐川急便か法人か';
  if (j.kind === 'sagawa') return sagawaMissing(j).join('・') || '営業所';
  if (!String(j.company || '').trim()) return '会社名';
  if (!String(j.branch || '').trim()) return '営業所名';
  if (j.pay !== 'daily' && j.pay !== 'unit') return '日極か単価か';
  return '種類と単価';
}

// 売上表の案件（佐川急便・法人をまとめて登録）。1つもなければ、空の案件を1つ出す
function jobsFields(s) {
  const list = jobList(s).length ? jobList(s) : [{ kind: '' }];
  return `<div class="field job-head"><span class="field-label">案件（佐川急便・法人をいくつでも登録できます）</span></div>
    ${list.map((j, i) => jobCard(s, j, i)).join('')}
    <div class="field"><button type="button" class="btn-outline" data-action="add-job">＋ 案件を追加</button>
      <span class="field-note">乗務後点呼で、その日の案件を選びます（いくつでも）。朝は法人・午後は佐川急便のように、組み合わせても数えられます。</span></div>`;
}

function jobCard(s, j, i) {
  const kinds = [['sagawa', '佐川急便'], ['corp', '法人']].map(([v, t]) => `<button type="button" class="chip" data-action="job-kind" data-i="${i}" data-value="${v}" aria-pressed="${j.kind === v}">${t}</button>`).join('');
  const inp = (k, label, attrs = '', note = '') => field(label, `<input data-job-i="${i}" data-job-k="${k}" value="${e(getPath(j, k) ?? '')}" ${attrs}>`, note);
  let body = '';
  if (j.kind === 'sagawa') {
    const sj = sagawaJob(j);
    const rule = newbieRule(sj);
    const nbDates = newbieDates(sagawaSettings(j, s));
    const yenInp = (k, label, ex, note = '') => inp(k, label, `type="number" inputmode="numeric" min="0" placeholder="例：${ex}"`, note);
    const chip = (act, v, t, on) => `<button type="button" class="chip" data-action="${act}" data-i="${i}" data-value="${v}" aria-pressed="${on}">${t}</button>`;
    const shifts = [['', '通常'], ...SHIFTS.map((x) => [x, x])].map(([v, t]) => chip('job-shift', v, t, sj.shift === v)).join('');
    const pays = [['unit', '単価'], ['daily', '日極']].map(([v, t]) => chip('job-pay', v, t, sj.pay === v)).join('');
    // 営業所名は各自が入れ、種別と支払いは選ぶ。単価・日極・上乗せ・新人保証の金額も各自が入れる（新人保証の期間だけ自動で出す）
    body = `${inp('office', '営業所名', 'placeholder="例：○○"', '「営業所」は付けなくても大丈夫です')}
      <div class="field"><span class="field-label">種別</span><div class="picks">${shifts}</div></div>
      <div class="field"><span class="field-label">支払い</span><div class="picks">${pays}</div></div>
      ${sj.pay === 'daily' ? yenInp('priceDaily', '日極（円/日）', '○○○○', '個数も入れますが、記録用で金額は変わりません') : ''}
      ${sj.pay === 'unit' ? `
        ${yenInp('priceTakuhai', '単価：宅配（円/個）', '○○○')}
        ${yenInp('priceShogyo', '単価：商業（円/個）', '○○○')}
        ${yenInp('priceShuka', '単価：集荷（円/個）', '○○○')}
        ${hasExtra(sj.shift) ? yenInp('priceExtra', `1日の上乗せ（保障など）（円/日）`, '○○○○', '乗務した日ごとに足します。なければ空のまま') : ''}` : ''}
      ${rule ? `${yenInp('newbiePerDay', '新人保証（円/日）', '○○○○', `この営業所で働き始めた日から${newbieSpan(rule)}、乗務した日ごとに足します${nbDates ? `（${nbDates.from.replace(/-/g, '/')}〜${nbDates.to.replace(/-/g, '/')}）` : ''}。新人保証がなければ空のまま`)}
        ${inp('startDate', 'この営業所で働き始めた日', 'type="date"', '新人保証の期間を数えるのに使います（空なら下の「稼働を開始した日」）')}` : ''}`;
  } else if (j.kind === 'corp') {
    const pays = [['daily', '日極'], ['unit', '単価']].map(([v, t]) => `<button type="button" class="chip" data-action="job-pay" data-i="${i}" data-value="${v}" aria-pressed="${j.pay === v}">${t}</button>`).join('');
    const EX = [['宅配', '170'], ['ネコポス', '40'], ['○○', '○○']];
    body = `${inp('company', '会社名', 'placeholder="例：○○運輸"')}
      ${inp('branch', '営業所名', 'placeholder="例：△△営業所"')}
      <div class="field"><span class="field-label">支払い</span><div class="picks">${pays}</div></div>
      ${j.pay === 'daily' ? inp('price', 'いつもの金額（日極・円）', 'inputmode="numeric" placeholder="例：19000"', '金額が毎回変わる案件（距離で変わるチャーター便など）は、空にしておくと毎回入れられます') : ''}
      ${j.pay === 'unit' ? `<div class="field"><span class="field-label">種類と単価（円）</span>
        ${Array.from({ length: UNIT_SLOTS }, (_, k) => `<div class="unit-row">
          <input data-job-i="${i}" data-job-k="units.${k}.label" value="${e(j.units?.[k]?.label ?? '')}" placeholder="例：${EX[k][0]}" aria-label="種類${k + 1}">
          <input data-job-i="${i}" data-job-k="units.${k}.price" value="${e(j.units?.[k]?.price ?? '')}" inputmode="numeric" placeholder="例：${EX[k][1]}" aria-label="種類${k + 1}の単価（円）">
        </div>`).join('')}
        <span class="field-note">乗務後点呼で、種類ごとの個数を入れます。</span></div>` : ''}`;
  }
  return `<div class="job-card">
    <div class="job-top"><b>案件 ${i + 1}</b><button type="button" class="btn-text danger" data-action="del-job" data-i="${i}">消す</button></div>
    <div class="field"><div class="picks">${kinds}</div></div>
    ${body}
  </div>`;
}

// 設定の案件を書き換える前に、以前の版の設定も含めた一覧を settings.jobs に入れる
function editableJobs() {
  const s = state.settings;
  s.jobs = jobList(s).map((j) => ({ ...j, units: (j.units || []).map((u) => ({ ...u })) }));
  return s.jobs;
}

function settingsForm(s, fresh = false) {
  if (state.inviteName) s.driverName = state.inviteName; // 運転者名は招待の名前
  // 以前に受けた前払いは今月の分だけを入れる（前の月に入れた金額は出さない）
  if (s.priorAdvanceMonth !== thisMonthKey()) s = { ...s, priorAdvance: '' };
  // はじめての設定では、はじめから入っている事業者名・休憩時間も、ほかの欄と同じく「例」の薄い文字で見せる
  // （空のまま「はじめる」を押すと、この値になる）
  if (fresh) {
    s = { ...s };
    if (s.company === DEFAULT_SETTINGS.company) s.company = '';
    if (num(s.restMin) === DEFAULT_SETTINGS.restMin) s.restMin = '';
  }
  const f = (key, text, attrs = '', note = '') =>
    field(text, `<input data-setting="${key}" value="${e(s[key] ?? '')}" ${attrs}>`, note);
  return `
    <div class="card fields">
      ${state.inviteName
        ? field('運転者名', `<input value="${e(state.inviteName)}" readonly tabindex="-1" aria-readonly="true">`, '招待の名前です。字が違うときは、会社に連絡してください。')
        : f('driverName', '運転者名 <b class="req">必須</b>', 'autocomplete="name" placeholder="例：配送 太郎"')}
      ${f('office', '営業所（勤務先）', 'placeholder="例：○○"')}
      ${f('vehicleNo', '車両番号', 'placeholder="例：品川 000 あ 1234"')}
      ${f('company', '屋号（ない場合は氏名）', 'placeholder="例：○○運送"', '日報・点呼記録簿の「事業者名」に入ります')}
    </div>
    <h2 class="section-title">毎日ほぼ同じ内容（入力の初期値になります）</h2>
    <div class="card fields">
      ${f('startPlace', '乗務開始・終了地点', 'placeholder="例：○○営業所"')}
      ${f('via', '主な経過地点（集荷・納品先など）', 'placeholder="例：○○町1丁目、△△町2丁目"')}
      ${f('restPlace', '休憩地点', 'placeholder="例：○○公園駐車場"')}
      ${f('restMin', '休憩時間（分）', `type="number" inputmode="numeric" min="0" placeholder="例：${DEFAULT_SETTINGS.restMin}"`)}
      ${field('点呼実施者名', `<input id="rollcaller-view" value="${e(s.driverName ?? '')}" placeholder="運転者名が入ります" readonly tabindex="-1" aria-readonly="true">`)}
      ${f('initialOdo', '今のメーターの距離（km）', 'type="number" inputmode="numeric" min="0" placeholder="例：12345"', '最初の日の「開始時走行距離」になります。あとは前の日の終了距離が自動で入ります')}
    </div>
    <h2 class="section-title">売上表</h2>
    <div class="card fields">
      ${jobsFields(s)}
      ${f('salesStartDate', '稼働を開始した日', 'type="date"', 'はじめて稼働した日（前払いの「はじめての月」の判断に使います）')}
      <div class="field"><span class="field-label">リース車両</span>${[['yes', '利用している'], ['no', '利用していない']].map(([v, t]) => `<button type="button" class="chip" data-setting-seg="leaseCar" data-value="${v}" aria-pressed="${s.leaseCar === v}">${t}</button>`).join('')}</div>
      ${prevSalesField(s)}
      ${priorAdvanceField(s)}
    </div>
    <h2 class="section-title">期限のお知らせ（任意）</h2>
    <div class="card fields">
      ${f('shakenDate', '車検の満了日', 'type="date"', '車検証に書いてある「有効期間の満了する日」')}
      ${f('licenseDate', '運転免許証の有効期限', 'type="date"', '免許証に書いてある「○年○月○日まで有効」の日')}
      <p class="field-note pad-note">期限の60日前・30日前・14日前・7日前と、期限を過ぎたときにお知らせします。更新したら、新しい日付に入れ直してください。</p>
    </div>`;
}

function renderSetup() {
  // はじめての設定では、はじめから入っている事業者名・休憩時間も空にして、ほかの欄と同じく自分で入れてもらう（欄には「例」を薄く出す）
  if (!state.setupCleared) {
    if (state.settings.company === DEFAULT_SETTINGS.company) state.settings.company = '';
    if (num(state.settings.restMin) === DEFAULT_SETTINGS.restMin) state.settings.restMin = '';
    // 屋号は、はじめは招待の名前を入れておく（運転者名と違って書きかえられる）
    if (!state.settings.company && state.inviteName) state.settings.company = state.inviteName;
    state.setupCleared = true;
  }
  app.innerHTML = `
    <main class="screen form">
      <div class="hero">
        <div class="brand">${LOGO(56)}${WORDMARK}</div>
        <p class="lead">運転日報と点呼記録簿を、スマホで簡単に。</p>
        <p class="muted">はじめに、毎日同じになる内容を登録します。あとから設定でいつでも変えられます。</p>
      </div>
      ${settingsForm(state.settings, true)}
      <p class="info">記録はこのスマホの中だけに保存されます。保管用のファイルや事務所に送るファイルは、「書き出し・共有」から Excel・PDF・CSV で作れます。</p>
      ${saveSettingsButton('はじめる')}
    </main>`;
}

function renderSettings() {
  app.innerHTML = `
    <main class="screen form">
      ${head('設定')}
      ${settingsForm(state.settings)}
      ${saveSettingsButton('保存する')}
      <h2 class="section-title">バックアップ</h2>
      <div class="card pad">
        <p class="small">記録はこのスマホの中だけにあります。スマホを替える・アプリを消す前に、バックアップを作って保存してください。毎月末にもお知らせします。</p>
        <p class="small cloud-note"><b>保存先は、クラウド（iPhone は iCloud Drive、Android は Google ドライブ）がいちばん安心です。</b>スマホをなくしたり壊れたりしても、クラウドに残ります。「バックアップを作る」を押したら、iPhone は「"ファイル"に保存」→ iCloud Drive、Android は「ドライブ」を選んでください。</p>
        <button type="button" class="btn-outline" data-action="backup">バックアップを作る</button>
        <button type="button" class="btn-outline" data-action="restore">バックアップから戻す</button>
      </div>
      <button type="button" class="btn-outline" data-action="go" data-view="rules">記録の決まり（保存期間など）</button>
      <p class="info center">日報サポート v${APP_VERSION}${parseInvite(state.settings.invite) ? `（招待 No.${parseInvite(state.settings.invite).no}）` : ''}</p>
    </main>`;
}

// ---- 画面：招待コード ----

// 招待コードがまだない・正しくないとき
function renderGate() {
  app.innerHTML = `
    <main class="screen form">
      <div class="hero">
        <div class="brand">${LOGO(56)}${WORDMARK}</div>
        <p class="lead">運転日報と点呼記録簿を、スマホで簡単に。</p>
      </div>
      <div class="card pad">
        <p class="small">日報サポートは、所属ドライバーのためのアプリです。<b>会社から届いた招待リンク</b>を開いてください。</p>
        <p class="small">ホーム画面に追加したアプリでこの画面が出たときは、届いた招待リンク（または招待コード）をそのまま下に貼り付けてください。</p>
      </div>
      <div class="card fields">${field('招待リンク・招待コード', '<textarea id="invite-input" rows="3" placeholder="例：届いたリンクをそのまま貼り付け"></textarea>')}</div>
      <button type="button" class="btn-primary" data-action="invite-check">確認する</button>
    </main>`;
}

// 招待リンクを開いたとき（はじめての方）：ホーム画面に追加してもらう
function renderInvited() {
  app.innerHTML = `
    <main class="screen form">
      <div class="hero">
        <div class="brand">${LOGO(56)}${WORDMARK}</div>
        <p class="lead">${e(state.inviteName)}さんの招待を確認しました</p>
      </div>
      <div class="card pad">
        <p class="small"><b>次に、ホーム画面に追加してください。</b>アプリのように開けるようになります。<br>iPhone：Safariの共有ボタン →「ホーム画面に追加」<br>Android：Chromeのメニュー →「ホーム画面に追加」</p>
        <p class="small">iPhone では、ホーム画面のアプリをはじめて開いたときに、もう一度招待コードを聞かれることがあります。そのときは、ここで「招待コードをコピー」を押して写しておき、貼り付けてください（届いたリンクを開き直してもかまいません）。</p>
        <button type="button" class="btn-outline" data-action="invite-copy">招待コードをコピー</button>
      </div>
      <button type="button" class="btn-primary" data-action="go" data-view="setup">このまま設定をはじめる</button>
    </main>`;
}

// 招待コードを止めた方（辞めた方）：新しい記録はつけられないが、これまでの記録は書き出せる
function renderStopped() {
  app.innerHTML = `
    <main class="screen form">
      <div class="hero">
        <div class="brand">${LOGO(56)}${WORDMARK}</div>
        <p class="lead">この招待コードは使えなくなりました</p>
      </div>
      <div class="card pad">
        <p class="small">新しい記録はつけられません。これまでの運転日報・点呼記録簿・事故の記録は、下のボタンから Excel・PDF・CSV に書き出せます。</p>
        <p class="small">運転日報・点呼記録簿は<b>1年間</b>、事故の記録は<b>3年間</b>、自分で保管するのが決まりです。</p>
        ${state.settings.driverName ? `<button type="button" class="btn-primary" data-action="go" data-view="export">記録を書き出す</button>
        <button type="button" class="btn-outline" data-action="backup">バックアップを作る</button>` : ''}
      </div>
      <p class="info">わからないことは、会社にお問い合わせください。</p>
    </main>`;
}

// アプリを開いたときに招待コードを確かめる（招待リンクで開いたときは、そのコードを保存する）
async function checkInvite() {
  if (globalThis.NISSAPO_DEMO) return 'ok'; // 見本（claude.ai のアーティファクト）
  if (location.hostname === 'localhost' && !location.search.includes('invite')) return 'ok'; // 開発中（?invite を付けると確かめられる）
  const s = state.settings;
  const fromLink = location.hash.match(/invite=([^&]+)/)?.[1];
  if (fromLink) {
    const v = await verifyInvite(decodeURIComponent(fromLink));
    if (v && v.code !== s.invite) {
      s.invite = v.code;
      await db.putSettings(s);
      state.inviteNew = true;
    }
  }
  return useInvite(await inviteStatus(s.invite));
}

// 確かめた結果を覚え、運転者名を招待の名前にそろえる（設定がまだなら、はじめての設定で入る）
async function useInvite(r) {
  state.inviteName = r.name;
  const s = state.settings;
  if (r.name && s.driverName && s.driverName !== r.name) {
    s.driverName = r.name;
    s.rollcaller = r.name;
    await db.putSettings(s);
  }
  // 屋号がまだ以前のはじめからの値（会社名）か空なら、招待の名前にする（あとから書きかえられる）
  if (r.name && s.driverName && (!String(s.company || '').trim() || s.company === DEFAULT_SETTINGS.company)) {
    s.company = r.name;
    await db.putSettings(s);
  }
  return r.status;
}

// ---- 画面：ホーム ----

// 佐川急便の案件の単価などがまだのとき（以前の版は単価表から入っていたため）、設定で入れてもらう
function pricesCard() {
  const miss = jobList(state.settings).filter((j) => j.kind === 'sagawa' && j.office && sagawaMissing(j).length);
  if (!miss.length) return '';
  return `<div class="card pad warn-card">
    <p><b>${e(miss.map(jobLabel).join('・'))}</b> の単価がまだ入っていません。設定の「売上表」で、単価（日極）と新人保証の金額を入れてください。</p>
    <button type="button" class="btn-outline" data-action="go" data-view="settings">設定を開く</button>
  </div>`;
}

function renderHome() {
  const today = todayKey();
  const rec = findRecord(today);
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const monthRecs = state.records.filter((r) => r.date.startsWith(`${y}-${pad2(m)}-`));
  const workDays = monthRecs.filter((r) => r.start || r.end).length;
  const km = monthRecs.reduce((s, r) => s + (distanceOf(r) || 0), 0);

  // 前の日の乗務後が未入力（日をまたいだ・入れ忘れ）
  const open = state.records
    .filter((r) => r.date < today && r.start && !r.end)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];

  const status = (done, text, time) => `
    <div class="status ${done ? 'done' : ''}">
      <span class="status-mark">${done ? ICON.check : ''}</span>
      <span class="status-label">${text}</span>
      <span class="status-time">${done ? e(hm(time)) : 'まだ'}</span>
    </div>`;

  let main;
  if (!rec?.start) {
    main = `<button type="button" class="btn-big" data-action="open-start" data-date="${today}"><small>出発するとき</small>乗務前点呼を記録</button>`;
  } else if (!rec.end) {
    main = `<button type="button" class="btn-big end" data-action="open-end" data-date="${today}"><small>帰ってきたとき</small>乗務後点呼を記録</button>`;
  } else {
    main = `<div class="done-msg">${ICON.check} 今日の記録は完了です。おつかれさまでした。</div>`;
  }

  app.innerHTML = `
    <main class="screen">
      <div class="home-head">
        <div class="brand">${LOGO(40)}${WORDMARK}</div>
        <button type="button" class="icon-btn" data-action="go" data-view="settings" aria-label="設定">${ICON.gear}</button>
      </div>
      ${open ? `<div class="card pad warn-card">
        <p><b>${label(open.date)}</b> の乗務後点呼がまだです。</p>
        <button type="button" class="btn-outline" data-action="open-end" data-date="${open.date}">${label(open.date)} の乗務後を記録</button>
      </div>` : ''}
      <section class="card today">
        <div class="today-date">${label(today)}</div>
        ${status(!!rec?.start, '乗務前点呼', rec?.start?.time)}
        ${status(!!rec?.end, '乗務後点呼', rec?.end?.time)}
      </section>
      ${main}
      ${pricesCard()}
      ${expiryCards()}
      ${oilCard()}
      <section class="card month-sum">
        <div><span class="muted">${m}月の出勤</span><b>${workDays}<small>日</small></b></div>
        <div><span class="muted">${m}月の走行</span><b>${km.toLocaleString('ja-JP')}<small>km</small></b></div>
      </section>
      <div class="btn-row two">
        <button type="button" class="btn-outline" data-action="go" data-view="list">${MARK.list}記録の一覧</button>
        <button type="button" class="btn-outline" data-action="go" data-view="export">${MARK.share}書き出し・共有</button>
      </div>
      <button type="button" class="btn-outline" data-action="go" data-view="sales">${MARK.yen}売上表（前払い）</button>
      <button type="button" class="btn-outline" data-action="go" data-view="accidents">${MARK.warn}事故の記録${state.accidents.length ? `（${state.accidents.length}件）` : ''}</button>
      <div class="link-stack">
        <button type="button" class="link-btn" data-action="go" data-view="rules">記録の決まり（保存期間・点呼で確かめること）</button>
        <button type="button" class="link-btn" data-action="go" data-view="advrules">前払いのルールと注意事項</button>
      </div>
      ${installHint()}
    </main>`;
}

function installHint() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone || state.settings.installHintDismissed) return '';
  return `<div class="card pad hint">
    <p class="small"><b>ホーム画面に追加すると、アプリのように開けます。</b><br>iPhone：Safariの共有ボタン →「ホーム画面に追加」<br>Android：Chromeのメニュー →「ホーム画面に追加」</p>
    <button type="button" class="btn-text" data-action="dismiss-install">閉じる</button>
  </div>`;
}

// ---- 画面：入力（乗務前・乗務後・1日分） ----

function startSection(full) {
  const d = state.draft.start;
  const warn = d.drunk === '有'
    ? '<p class="warn">酒気帯びがあるときは乗務できません。すぐに事務所（運行管理者）に連絡してください。</p>'
    : d.health === '不良' || d.inspection === '不良'
      ? '<p class="warn">健康状態・日常点検に問題があるときは、事務所に連絡して指示を受けてください。</p>' : '';
  return `
    <section class="card fields">
      <h2 class="card-title">乗務前点呼（出発するとき）</h2>
      ${field('点呼時刻', input('start.time', 'type="time" required'))}
      ${segField('アルコール検知器', 'start.alcohol', [['有', '使用した'], ['無', '使用していない']])}
      ${segField('酒気帯び', 'start.drunk', ['無', '有'])}
      ${segField('健康状態', 'start.health', ['良好', '不良'])}
      ${segField('日常点検', 'start.inspection', ['良好', '不良'])}
      ${warn}
      ${oilWarnInEntry()}
      ${field('出発時のメーター（km）', input('start.odo', 'type="number" inputmode="numeric" min="0"'), '前の日の終了距離が入っています')}
      <details class="more" ${full ? 'open' : ''}>
        <summary>そのほかの項目（ふだんは変更不要）</summary>
        ${field('指示事項', input('start.instruction'))}
        ${field('乗務開始地点', input('start.place'))}
      </details>
    </section>`;
}

function endSection(full) {
  const d = state.draft.end;
  const dist = distanceOf(state.draft);
  const warn = d.drunk === '有'
    ? '<p class="warn">酒気帯びがあります。すぐに事務所（運行管理者）に連絡してください。</p>'
    : d.vehicle === '有' ? '<p class="warn">車両の異常は、事務所に連絡してください。</p>' : '';
  return `
    <section class="card fields">
      <h2 class="card-title">乗務後点呼（帰ってきたとき）</h2>
      ${field('点呼時刻', input('end.time', 'type="time" required'))}
      ${field('帰着時のメーター（km）', input('end.odo', 'type="number" inputmode="numeric" min="0"'),
        num(state.draft.start?.odo) != null ? `出発時は ${num(state.draft.start.odo).toLocaleString('ja-JP')} km` : '')}
      ${field('今日走った距離（km）', `<input data-dist value="${dist ?? ''}" type="number" inputmode="numeric" min="0">`,
        'メーターか走った距離の、どちらか一方を入れればOK')}
      ${segField('アルコール検知器', 'end.alcohol', [['有', '使用した'], ['無', '使用していない']])}
      ${segField('酒気帯び', 'end.drunk', ['無', '有'])}
      ${segField('車両の異常', 'end.vehicle', ['無', '有'])}
      ${warn}
      ${jobsPickField()}
      <details class="more" ${full ? 'open' : ''}>
        <summary>そのほかの項目（ふだんは変更不要）</summary>
        ${field('運行状況の報告', input('end.report'))}
        ${field('主な経過地点', input('end.via'))}
        ${field('休憩地点', input('end.restPlace'))}
        ${field('休憩時間（分）', input('end.restMin', 'type="number" inputmode="numeric" min="0"'))}
        ${segField('荷主都合で30分以上待機', 'end.wait', ['無', '有'])}
        ${segField('荷役作業', 'end.cargo', ['有', '無'])}
        ${field('交替運転（地点・時刻）', input('end.relief'))}
        ${field('事故・異常の概要', input('end.accident'))}
        ${field('備考', input('end.note'))}
        ${field('乗務終了地点', input('end.place'))}
      </details>
    </section>`;
}

function renderEntry() {
  const d = state.draft;
  const mode = state.mode;
  const title = mode === 'start' ? '乗務前点呼' : mode === 'end' ? '乗務後点呼' : label(d.date);
  let body = '';
  if (mode === 'start') body = startSection(false);
  else if (mode === 'end') body = endSection(false);
  else {
    body = (d.start ? startSection(true) : `<button type="button" class="btn-outline" data-action="add-part" data-part="start">＋ 乗務前点呼を入力する</button>`)
      + (d.end ? endSection(true) : `<button type="button" class="btn-outline" data-action="add-part" data-part="end">＋ 乗務後点呼を入力する</button>`)
      + `<section class="card fields">${field('点呼実施者名', `<input value="${e(d.rollcaller || state.settings.driverName)}" readonly tabindex="-1" aria-readonly="true">`)}</section>`;
  }
  const exists = !!findRecord(d.date);
  app.innerHTML = `
    <main class="screen form">
      ${head(title, state.back)}
      ${mode !== 'day' ? `<p class="muted">${label(d.date)}　${e(state.settings.driverName)}</p>` : ''}
      ${body}
      ${entrySaveButton()}
      ${mode === 'day' && exists && !isOff(d) ? '<button type="button" class="btn-text danger" data-action="delete-day">この日の記録を消す</button>' : ''}
    </main>`;
}

// 乗務後点呼で、入れないと記録できない項目（帰着時のメーターか走った距離・その日の案件の金額や個数）
function entryMissing(d) {
  if (!d?.end) return [];
  const miss = [];
  if (num(d.end.odo) == null) miss.push('帰着時のメーターか今日走った距離');
  const jobs = jobsOf(state.settings);
  if (jobs.length) {
    const picked = (d.jobs || []).map((p) => ({ p, j: jobs.find((x) => x.id === p.id) })).filter((x) => x.j);
    if (!picked.length) miss.push('今日の案件');
    for (const { p, j } of picked) {
      if (j.kind === 'corp' && j.pay === 'daily') {
        if (num(p.amount) == null) miss.push(`${jobLabel(j)}の金額`);
      } else {
        const c = p.counts || {};
        const keys = j.kind === 'sagawa' ? COUNT_KEYS.map(([k]) => k) : jobUnits(j).map((u) => u.i);
        if (keys.every((k) => num(c[k]) == null)) miss.push(`${jobLabel(j)}の個数`);
      }
    }
  }
  return miss;
}

// 記録のボタン（乗務後点呼で入っていない項目があるときは押せない）
function entrySaveButton() {
  const miss = entryMissing(state.draft);
  return `<p class="save-hint warn-text" id="entry-hint" ${miss.length ? '' : 'hidden'}>まだ入っていない項目：${e(miss.join('、'))}</p>
    <button type="button" class="btn-primary" data-action="save-entry" ${miss.length ? 'disabled' : ''}>この内容で記録する</button>`;
}
function updateEntryState() {
  const btn = app.querySelector('[data-action="save-entry"]');
  const hint = app.querySelector('#entry-hint');
  if (!btn || !hint) return;
  const miss = entryMissing(state.draft);
  btn.disabled = miss.length > 0;
  hint.hidden = !miss.length;
  hint.textContent = `まだ入っていない項目：${miss.join('、')}`;
}

// ---- 画面：一覧 ----

function renderList() {
  const { y, m } = state.month;
  const days = daysInMonth(y, m);
  const today = todayKey();
  const rows = [];
  let km = 0;
  let work = 0;
  for (let d = 1; d <= days; d++) {
    const key = dateKey(y, m, d);
    if (key > today && !findRecord(key)) continue;
    const r = findRecord(key);
    const wd = weekday(key);
    const dist = distanceOf(r);
    const off = isOffDay(r, key, today);
    if (r && !off) { work++; km += dist || 0; }
    const sub = off
      ? '<span class="tag off-tag">休み</span>'
      : r
        ? `${e(hm(r.start?.time) || '--:--')} → ${e(hm(r.end?.time) || '--:--')}${r.start && !r.end ? '<span class="tag">乗務後まだ</span>' : ''}`
        : '<span class="off">記録なし</span>';
    rows.push(`
      <button type="button" class="row ${r && !off ? '' : 'is-off'}" data-action="open-day" data-date="${key}" data-back="list">
        <span class="row-day ${wd === '日' ? 'sun' : wd === '土' ? 'sat' : ''}"><b>${d}</b><span>${wd}</span></span>
        <span class="row-main"><span class="row-sub">${sub}</span></span>
        <span class="row-km">${r ? fmtKm(dist) : ''}</span>
      </button>`);
  }
  rows.reverse(); // 新しい日を上に
  app.innerHTML = `
    <main class="screen">
      ${head('記録の一覧')}
      <div class="month-nav">
        <button type="button" class="icon-btn" data-action="month" data-step="-1" aria-label="前の月">${ICON.prev}</button>
        <b>${y}年${m}月</b>
        <button type="button" class="icon-btn" data-action="month" data-step="1" aria-label="次の月">${ICON.next}</button>
      </div>
      <p class="muted center">出勤 ${work}日・走行 ${km.toLocaleString('ja-JP')} km</p>
      <div class="card list">${rows.join('') || '<p class="empty">この月の記録はありません</p>'}</div>
      <p class="info">走行距離を入れなかった日は、自動で「休み」になります。日付をタップすると、記録を直したり、入れ忘れた日を追加したりできます。</p>
    </main>`;
}

// ---- 画面：書き出し・共有 ----

function renderExport() {
  const x = state.exp;
  const isAcc = x.doc === 'accident';
  const dates = isAcc ? state.accidents.map((a) => a.date) : state.records.map((r) => r.date);
  const years = new Set([new Date().getFullYear(), ...dates.map((d) => Number(d.slice(0, 4)))]);
  const yearOpts = [...years].sort((a, b) => b - a).map((y) => `<option value="${y}" ${y === x.y ? 'selected' : ''}>${y}年</option>`).join('');
  const monthOpts = Array.from({ length: 12 }, (_, i) => i + 1).map((m) => `<option value="${m}" ${m === x.m ? 'selected' : ''}>${m}月</option>`).join('');
  const notes = isAcc ? {
    xlsx: '事故1件を1行にした「事故の記録」のシートです。',
    pdf: '事故1件を A4縦 1枚にします。そのまま印刷して保管できます。',
    csv: '事故1件を1行にした表です。'
  } : {
    xlsx: '事務所の年間ブックと同じ形（運転日報・点呼記録簿のシート）です。「1年分」にすると1月〜12月の24シートになります。',
    pdf: 'A4横で、運転日報と点呼記録簿を1か月1枚ずつにします。印刷やそのまま提出するときに。',
    csv: '記録のある日を1日1行にした表です。ほかのソフトに取り込むときに。'
  };
  const canShare = !!navigator.canShare;
  app.innerHTML = `
    <main class="screen form">
      ${head('書き出し・共有')}
      <section class="card fields">
        <div class="field"><span class="field-label">書類</span>
          <div class="seg">${[['nippo', '運転日報・点呼記録簿'], ['accident', '事故の記録']].map(([v, t]) => `<button type="button" data-exp="doc" data-value="${v}" aria-pressed="${x.doc === v}">${t}</button>`).join('')}</div>
        </div>
        <div class="field"><span class="field-label">期間</span>
          <div class="seg">${[['month', '1か月分'], ['year', '1年分']].map(([v, t]) => `<button type="button" data-exp="period" data-value="${v}" aria-pressed="${x.period === v}">${t}</button>`).join('')}</div>
        </div>
        <div class="field"><span class="field-label">年・月</span>
          <div class="ym">
            <select class="select" data-exp-select="y">${yearOpts}</select>
            ${x.period === 'month' ? `<select class="select" data-exp-select="m">${monthOpts}</select>` : ''}
          </div>
        </div>
        <div class="field"><span class="field-label">保存形式</span>
          <div class="seg">${[['xlsx', 'Excel'], ['pdf', 'PDF'], ['csv', 'CSV']].map(([v, t]) => `<button type="button" data-exp="format" data-value="${v}" aria-pressed="${x.format === v}">${t}</button>`).join('')}</div>
          <span class="field-note">${notes[x.format]}</span>
        </div>
      </section>
      ${canShare ? '<button type="button" class="btn-primary" data-action="export" data-how="share">共有する（LINE・メールなど）</button>' : ''}
      <button type="button" class="${canShare ? 'btn-outline' : 'btn-primary'}" data-action="export" data-how="save">このスマホに保存する</button>
      <button type="button" class="btn-text" data-action="preview">プレビューで確認する</button>
      <p class="info">${canShare ? '事務所に送るときは「共有する」を押して、LINEやメールを選んでください。' : '保存したファイルを、LINEやメールに添付して事務所に送ってください。'}</p>
      <p class="info">${isAcc ? '事故の記録は<b>3年間</b>、自分で保管するのが決まりです。事務所にも送っておくと、会社でも控えを残せます。' : '運転日報・点呼記録簿は<b>1年間</b>、自分で保管するのが決まりです。毎月書き出して保存し、事務所にも送っておくと安心です。'}<button type="button" class="link-btn inline" data-action="go" data-view="rules">記録の決まり</button></p>
      <div id="preview" class="preview"></div>
    </main>`;
}

// ---- 画面：事故の記録 ----

function renderAccidents() {
  const list = [...state.accidents].sort((a, b) => (`${a.date} ${a.time}` < `${b.date} ${b.time}` ? 1 : -1));
  const rows = list.map((a) => {
    const todo = [a.police === 'まだ' ? '警察まだ' : '', a.office === 'まだ' ? '事務所まだ' : ''].filter(Boolean);
    return `<button type="button" class="row" data-action="open-accident" data-id="${e(a.id)}">
      <span class="row-main">
        <span class="row-title">${e(accidentWhen(a))}</span>
        <span class="row-text">${e(a.place)}　${e(a.kind || a.situation)}</span>
        ${todo.length || needsReport(a) ? `<span class="row-sub">${needsReport(a) ? '<span class="tag danger">国への報告</span>' : ''}${todo.map((t) => `<span class="tag">${t}</span>`).join('')}</span>` : ''}
      </span>
    </button>`;
  }).join('');
  app.innerHTML = `
    <main class="screen">
      ${head('事故の記録')}
      <section class="card pad warn-card">
        <p><b>事故が起きたら、まず</b></p>
        <ol class="rule-list">
          <li>けが人がいれば救護する（救急は119番）</li>
          <li>ハザードランプ・三角表示板で、続けて事故が起きないようにする</li>
          <li>警察に連絡する（110番）</li>
          <li>事務所（運行管理者）に連絡する</li>
        </ol>
        <p class="small">落ち着いてから、このアプリに記録してください。</p>
      </section>
      <button type="button" class="btn-primary" data-action="new-accident">＋ 事故を記録する</button>
      <div class="card list">${rows || '<p class="empty">事故の記録はありません</p>'}</div>
      <p class="info">事故の記録は<b>3年間</b>、自分で保管するのが決まりです。「書き出し・共有」で「事故の記録」を選ぶと、まとめて保存したり事務所に送ったりできます。</p>
    </main>`;
}

// 事故の記録の入力部品（キーは 'place' や 'annex.width' のような道すじ）
function accField(labelText, key, attrs = '', note = '') {
  return field(labelText, `<input id="acc-${key.replace('.', '-')}" data-acc="${key}" value="${e(getPath(state.acc, key))}" ${attrs}>`, note);
}
function accText(labelText, key, example, note = '', rows = 4) {
  return field(labelText, `<textarea id="acc-${key}" data-acc="${key}" rows="${rows}" placeholder="${e(example)}">${e(state.acc[key])}</textarea>`, note);
}
// 選んだものをもう一度押すと、選んでいない状態に戻る（別紙は書かない項目があってよい）
function accSeg(labelText, key, options, toggle = false) {
  const v = getPath(state.acc, key);
  return `<div class="field"><span class="field-label">${labelText}</span><div class="seg wrap">${options.map((o) =>
    `<button type="button" data-acc-seg="${key}" data-value="${e(o)}" ${toggle ? 'data-toggle' : ''} aria-pressed="${v === o}">${e(o)}</button>`).join('')}</div></div>`;
}

const EX = {
  place: '例：○○県○○市○○1-1-1付近',
  parties: '例：山田 一郎（ヤマダ イチロウ）',
  situation: '例：運転者 貨物太郎は、令和6年10月11日午前9時00分に○○営業所に出社し、午前9時15分に○○から業務前点呼を受け、出庫した。当日は晴天で、視界は良好だった。○○地区にて配送のため運行中、住宅街の十字路を右折する際、時間に追われていたこともあり、スピードを十分に落とさずに進行した結果、左へ膨らみ、民家の壁に衝突した。この事故によるけが人はいなかったが、壁の一部が損傷した。',
  kind: '例：民家の壁に衝突（物損）／自転車と接触（人身事故）',
  road: '例：住宅街、道路幅員3m程の平坦な十字路',
  plan: '例：8時00分出庫～8時35分 ○○営業所にて積込み～10時から20時30分 ○○地区にて配送～21時00分帰庫',
  damage: '例：車両左側面のすり傷、民家の壁の損傷',
  cause: '例：スピードの出し過ぎ',
  prevention: '例：法定速度を守り、スピードの出し過ぎに注意する。住宅街や狭い道路では、交差点のミラーの確認、交差点の手前での確実な減速・一時停止、目視による安全確認を心掛ける。'
};

function renderAccidentForm() {
  const a = state.acc;
  const x = a.annex;
  const saved = state.accidents.some((y) => y.id === a.id);
  const annexFilled = annexLines(a).length > 0;
  const num = (key, labelText, unit) => accField(`${labelText}（${unit}）`, `annex.${key}`, 'type="number" inputmode="decimal" min="0"');
  const people = (key, labelText) => `<div class="people"><b>${labelText}</b>
      <input id="acc-annex-${key}" data-acc="annex.${key}" value="${e(x[key])}" type="number" inputmode="numeric" min="0" aria-label="${labelText}の人数"><span>人</span>
      <span class="sub">うち運転者</span>
      <input id="acc-annex-${key}Drv" data-acc="annex.${key}Drv" value="${e(x[`${key}Drv`])}" type="number" inputmode="numeric" min="0" aria-label="${labelText}のうち運転者の人数"><span>人</span></div>`;
  app.innerHTML = `
    <main class="screen form">
      ${head(saved ? '事故の記録を直す' : '事故を記録する', 'accidents')}
      <p class="muted">国土交通省の「事故の記録」の様式と同じ項目です。薄い文字は記入例です。</p>
      <section class="card fields">
        ${accField('作成日', 'created', 'type="date"')}
        ${accField('運転者の氏名', 'driverName')}
        ${accField('車両番号', 'vehicleNo', 'placeholder="例：品川 000 あ 1234"')}
        ${accField('事故の発生日', 'date', 'type="date" required')}
        ${accField('事故の発生時刻（頃）', 'time', 'type="time"')}
        ${accField('事故の発生場所', 'place', `placeholder="${EX.place}"`, '場所を示す地図の画像を別に保存しておくこともできます')}
        ${accField('事故の当事者（運転者を除く）の氏名', 'parties', `placeholder="${EX.parties}"`, '運転者のほかに当事者がいる場合に書きます')}
      </section>

      <h2 class="section-title">事故の概要</h2>
      <section class="card fields">
        ${accText('当時の状況', 'situation', EX.situation, 'いつ、どこで、だれが、どのような事故を起こし、結果どうなったか。けが人や物損があればその内容も', 8)}
        ${accText('事故の種類', 'kind', EX.kind, '物損・人身事故など。物損なら何とぶつかったか', 2)}
        ${accText('道路等の状況', 'road', EX.road, '道幅・坂道・カーブ・交差点・路面のぬれなど', 2)}
        ${accText('当時の運行計画', 'plan', EX.plan, '出発地・経由地・到着地と、それぞれの時刻を書きます', 3)}
        ${!a.plan && planFromRecord(findRecord(a.date), state.settings.via) ? '<button type="button" class="link-btn plan-btn" data-action="plan-from-nippo">その日の運転日報から下書きを入れる</button>' : ''}
        ${accText('損害の程度', 'damage', EX.damage, 'けがは医師の診断にもとづいて書きます', 2)}
      </section>

      <section class="card fields">
        ${accText('事故の原因', 'cause', EX.cause, '', 3)}
        ${accText('再発防止対策', 'prevention', EX.prevention, '原因がまだ分からないときは「原因究明結果待ち」と書き、すぐにとった対策も書きます', 4)}
      </section>

      <h2 class="section-title">写真</h2>
      <section class="card pad">
        <div class="photos">
          ${state.accPhotos.map((ph, i) => `<div class="photo">
            <button type="button" class="photo-view" data-action="view-photo" data-id="${ph.id}" aria-label="写真${i + 1}を大きく見る"><img src="${ph.url}" alt="写真${i + 1}"></button>
            <button type="button" class="photo-del" data-action="delete-photo" data-id="${ph.id}" aria-label="写真${i + 1}を消す">×</button>
            <span class="photo-no">${i + 1}</span>
          </div>`).join('')}
          <button type="button" class="photo-add" data-action="add-photo"><span>＋</span>写真を追加</button>
        </div>
        <p class="field-note">事故の現場・車の傷・相手の車・道路の様子など。場所を示す地図の画面写真でも大丈夫です。写真は追加したときにこのスマホに保存され、PDFにすると後ろのページに付きます。</p>
      </section>

      <details class="card more annex" ${annexFilled ? 'open' : ''}>
        <summary>別紙：事故の種類・道路・死傷者</summary>
        <div class="field"><span class="field-label">事故の種類（区分）　２つ以上なら起きた順に押す</span>
          <div class="seg wrap">${KINDS.map((k) => {
            const i = x.kinds.indexOf(k);
            return `<button type="button" data-acc-kind="${e(k)}" aria-pressed="${i >= 0}">${i >= 0 && x.kinds.length > 1 ? `${i + 1}. ` : ''}${e(k)}</button>`;
          }).join('')}</div>
        </div>
        ${accSeg('衝突等の状態', 'annex.collision', COLLISIONS, true)}
        ${accSeg('道路の種類', 'annex.roadType', ROAD_TYPES, true)}
        ${num('width', '道路の幅員', 'm')}
        ${accSeg('こう配', 'annex.slope', SLOPES, true)}
        ${accSeg('道路の形態', 'annex.shape', SHAPES, true)}
        ${accSeg('路面の状態', 'annex.surface', SURFACES, true)}
        ${accSeg('警戒標識の設置', 'annex.sign', ['有', '無'], true)}
        ${num('speed', '当該道路の制限速度', 'km/h')}
        <div class="field"><span class="field-label">損害の程度（人数）</span>
          ${people('dead', '死亡')}${people('serious', '重傷')}${people('light', '軽傷')}
          <span class="field-note">死亡は、事故から24時間以内に亡くなった人です</span>
        </div>
      </details>
      ${needsReport(a) ? '<p class="warn block">この事故は、国土交通大臣への報告（30日以内）が必要な事故にあたる可能性があります。すぐに事務所に連絡してください。（自動車事故報告規則 第2条）</p>' : ''}

      <section class="card fields">
        ${accSeg('警察への届出', 'police', ['届け出た', 'まだ'])}
        ${accSeg('事務所への連絡', 'office', ['連絡した', 'まだ'])}
      </section>
      <button type="button" class="btn-primary" data-action="save-accident">この内容で記録する</button>
      ${saved ? `<button type="button" class="btn-outline" data-action="share-accident">PDFにして事務所に送る</button>
        <button type="button" class="btn-text danger" data-action="delete-accident">この事故の記録を消す</button>` : ''}
    </main>`;
}

// 入力の途中で画面を描き直す（開いている別紙・スクロール位置・入力中の欄をそのままに）
function rerenderAccident(focusId) {
  const open = app.querySelector('details.annex')?.open;
  const y = window.scrollY;
  renderAccidentForm();
  if (open) app.querySelector('details.annex').open = true;
  window.scrollTo(0, y);
  if (focusId) {
    const el = document.getElementById(focusId);
    el?.focus();
    try { el?.setSelectionRange?.(el.value.length, el.value.length); } catch { /* number の欄は選択できない */ }
  }
}

async function openAccident(id) {
  const found = state.accidents.find((a) => a.id === id);
  if (found) state.acc = structuredClone(found);
  else state.acc = newAccident(state.settings, todayKey(), nowTime());
  setAccPhotos(found ? await loadPhotos(found.id) : []);
  state.back = 'accidents';
  go('accident');
}

// ---- 事故の写真 ----

async function loadPhotos(accidentId) {
  return (await db.photosOf(accidentId)).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

// 画面に出す写真を入れ替える（前の写真の表示用URLは片づける）
function setAccPhotos(list) {
  for (const ph of state.accPhotos) URL.revokeObjectURL(ph.url);
  state.accPhotos = list.map((ph) => ({ ...ph, url: URL.createObjectURL(ph.blob) }));
}

async function addPhotos(files) {
  let added = 0;
  for (const file of files) {
    try {
      const ph = newPhoto(state.acc.id, await shrinkImage(file));
      await db.putPhoto(ph);
      state.accPhotos.push({ ...ph, url: URL.createObjectURL(ph.blob) });
      added++;
    } catch (err) {
      console.error(err);
    }
  }
  rerenderAccident();
  toast(added === files.length ? `写真を${added}枚追加しました` : `${files.length - added}枚の写真を読み込めませんでした`);
}

function viewPhoto(id) {
  const ph = state.accPhotos.find((p) => p.id === id);
  if (!ph) return;
  const box = document.createElement('div');
  box.className = 'viewer';
  box.innerHTML = `<img src="${ph.url}" alt="事故の写真"><button type="button" class="viewer-close">閉じる</button>`;
  box.addEventListener('click', () => box.remove());
  document.body.append(box);
}

// 保存されていない事故の写真（入力をやめたときに残ったもの）を片づける
async function cleanupPhotos() {
  try {
    const ids = new Set(state.accidents.map((a) => a.id));
    const orphans = (await db.photoIndex()).filter((p) => !ids.has(p.accidentId)).map((p) => p.id);
    if (orphans.length) await db.deletePhotos(orphans);
  } catch (err) { console.error(err); }
}

async function saveAccident() {
  const a = state.acc;
  const err = validateAccident(a);
  if (err) { toast(err); return; }
  await db.putAccident(a);
  // その日の運転日報の「事故・異常の概要」が「無」なら、事故の種類（なければ状況）を書き写す
  const rec = findRecord(a.date);
  let copied = false;
  if (rec?.end && (!rec.end.accident || rec.end.accident === '無')) {
    rec.end.accident = (a.kind || a.situation).replace(/\s+/g, ' ').slice(0, 60);
    await db.putRecord(rec);
    copied = true;
  }
  await reload();
  toast(copied ? '記録しました。運転日報の「事故・異常」にも書き写しました' : '事故を記録しました');
  history.back();
}

// PDF のページ（事故の記録、別紙を書いていれば別紙、写真があれば写真のページも）
async function accidentCanvases(a) {
  const s = state.settings;
  const sub = `事業者名：${s.company || ''}　営業所：${s.office || ''}`;
  const pages = [renderAccident({
    title: '事故の記録',
    sub,
    fields: [
      { label: '作成日', value: a.created ? wareki(a.created) : '' },
      { label: '運転者の氏名', value: a.driverName },
      { label: '車両番号', value: a.vehicleNo },
      { label: '事故の発生日時', value: accidentWhen(a) },
      { label: '事故の発生場所', value: a.place },
      { label: '事故の当事者\n（運転者を除く）の氏名', value: a.parties },
      { label: '当時の状況', value: a.situation, group: '事故の概要', tall: true },
      { label: '事故の種類', value: a.kind, group: '事故の概要', tall: true },
      { label: '道路等の状況', value: a.road, group: '事故の概要', tall: true },
      { label: '当時の運行計画', value: a.plan, group: '事故の概要', tall: true },
      { label: '損害の程度', value: a.damage, group: '事故の概要', tall: true },
      { label: '事故の原因', value: a.cause, tall: true },
      { label: '再発防止対策', value: a.prevention, tall: true }
    ],
    footer: [`（保存期間：3年）　警察への届出：${a.police}　事務所への連絡：${a.office}`, '貨物自動車運送事業輸送安全規則 第九条の二による記録']
  })];
  const rows = annexLines(a);
  if (rows.length) pages.push(renderAnnex({ title: '別紙', sub: `${accidentWhen(a)}　${a.driverName}`, rows }));
  const photos = await loadPhotos(a.id);
  for (let i = 0; i < photos.length; i += 2) {
    const items = [];
    for (const [k, ph] of photos.slice(i, i + 2).entries()) {
      items.push({ image: await createImageBitmap(ph.blob), label: `写真${i + k + 1}` });
    }
    pages.push(renderPhotoPage({ title: '写真', sub: `${accidentWhen(a)}　${a.driverName}`, items }));
    items.forEach((it) => it.image.close?.());
  }
  return pages;
}

const accFileName = (a) => `事故の記録_${a.date.replace(/-/g, '')}_${safeName(a.driverName)}`;

// ---- オイル交換 ----

const kmText = (v) => `${Number(v).toLocaleString('ja-JP')}km`;

// 0〜5,000km のバー（3,000km からの目安に目盛り）
// animate：アプリを開いたときに、バーを左から右へ伸ばす
function oilBar(st, animate = false) {
  const pct = Math.min(100, (st.since / OIL_LIMIT) * 100);
  const cls = st.level >= 4500 ? 'danger' : st.level >= 3000 ? 'caution' : '';
  return `<div class="oil-bar ${cls} ${animate ? 'grow' : ''}" role="img" aria-label="前回の交換から${kmText(st.since)}（5,000kmまで）">
    <div class="oil-fill" style="width:${pct}%"></div>
    ${OIL_STEPS.map((s) => `<span class="oil-tick" style="left:${(s / OIL_LIMIT) * 100}%"></span>`).join('')}
  </div>
  <div class="oil-scale"><span>0</span><span style="left:60%">3,000</span><span style="left:100%">5,000km</span></div>`;
}

// アプリを開いた（戻ってきた）あと、最初にホームを描くときだけバーを動かす
let oilBarGrow = true;

function oilCard() {
  const st = oilStatus(state.settings, state.records);
  if (!st.last) {
    return `<button type="button" class="card pad oil-card empty-oil" data-action="go" data-view="oil">
      <span class="oil-head"><b>オイル交換</b><span class="muted">まだ記録がありません</span></span>
      <span class="small">前回オイル交換をした日とメーターを記録すると、3,000km から交換の時期をお知らせします。</span>
    </button>`;
  }
  const msg = oilMessage(st);
  const grow = oilBarGrow;
  oilBarGrow = false;
  return `<button type="button" class="card pad oil-card ${st.level >= 4500 ? 'danger' : st.level >= 3000 ? 'caution' : ''}" data-action="go" data-view="oil">
    <span class="oil-head"><b>オイル交換</b><span class="oil-num">前回から <b>${kmText(st.since)}</b></span></span>
    ${oilBar(st, grow)}
    <span class="small">${msg ? `<b>${e(msg.title)}</b>　` : ''}${st.remaining > 0 ? `5,000km まで あと ${kmText(st.remaining)}` : `5,000km を ${kmText(-st.remaining)} 超えています`}${st.element.need === 'must' ? '<br>次のオイル交換では<b>エレメントも必ず交換</b>します' : st.element.need === 'suggest' ? '<br>次のオイル交換は<b>エレメントも交換の時期</b>です' : ''}</span>
  </button>`;
}

function oilWarnInEntry() {
  if (state.mode !== 'start') return '';
  const st = oilStatus(state.settings, state.records);
  if (st.level < 4500) return '';
  return `<p class="warn">オイル交換：前回から ${kmText(st.since)}。${st.level >= OIL_LIMIT ? '5,000km を超えています。すぐに交換してください。' : `5,000km まで あと ${kmText(st.remaining)}。必ず交換してください。`}</p>`;
}

function renderOil() {
  const s = state.settings;
  const st = oilStatus(s, state.records);
  const changes = sortOilChanges(s.oilChanges).reverse();
  const nowOdo = currentOdo(state.records, s);
  const msg = oilMessage(st);
  const el = st.element;
  // 今回エレメントも交換したか（必ず交換する回は「交換した」、交換の時期・はじめての記録は選んでもらう）
  if (state.oilElement == null) state.oilElement = el.need === 'must' ? '交換した' : el.need === 'suggest' || !st.last ? '' : '交換していない';
  const elemKm = el.km != null ? `・${kmText(el.km)}` : '';
  app.innerHTML = `
    <main class="screen form">
      ${head('オイル交換')}
      ${st.last ? `<section class="card pad oil-status ${st.level >= 4500 ? 'danger' : st.level >= 3000 ? 'caution' : ''}">
        <span class="muted">前回のオイル交換から</span>
        <b class="oil-big">${kmText(st.since)}</b>
        ${oilBar(st)}
        <p class="small">${msg ? `<b>${e(msg.title)}</b><br>` : ''}${st.remaining > 0 ? `5,000km まで あと <b>${kmText(st.remaining)}</b>` : `5,000km を ${kmText(-st.remaining)} 超えています`}</p>
        <p class="small elem-line">エレメント：${el.need === 'must' ? '<b>次のオイル交換で必ず交換します</b>' : el.need === 'suggest' ? '<b>次のオイル交換で交換の時期です</b>' : `次から数えて ${el.left} 回目のオイル交換から交換の時期です`}${el.known ? `（前回のエレメント交換から オイル交換 ${el.since} 回${elemKm}）` : ''}</p>
      </section>` : ''}
      <p class="info">前回の交換から <b>3,000km・3,500km・4,000km・4,500km</b> を超えるとお知らせします。<b>5,000km までに必ず</b>オイル交換をしてください。オイルエレメントは<b>オイル交換2〜3回に1回（10,000km〜15,000km）</b>交換します。走った距離は、運転日報のメーターから計算します。</p>

      <h2 class="section-title">オイル交換をしたら記録する</h2>
      <section class="card fields">
        ${field('交換した日', `<input id="oil-date" type="date" value="${todayKey()}">`)}
        ${field('交換したときのメーター（km）', `<input id="oil-odo" type="number" inputmode="numeric" min="0" value="${nowOdo ?? ''}">`, '運転日報のいちばん新しいメーターが入っています。違うときは直してください')}
        <div class="field"><span class="field-label">オイルエレメント</span>
          <div class="seg">${['交換した', '交換していない'].map((v) => `<button type="button" data-oil-element="${v}" aria-pressed="${state.oilElement === v}">${v}</button>`).join('')}</div>
          <span class="field-note ${el.need === 'must' ? 'must' : ''}">${el.need === 'must' ? '<b>今回は必ずエレメントも交換してください</b>（2〜3回に1回・10,000km〜15,000km）' : el.need === 'suggest' ? '<b>エレメントも交換の時期です</b>（2〜3回に1回）。交換したかどうかを選んでください' : st.last ? `エレメントは、次から数えて ${el.left} 回目のオイル交換から交換の時期です` : 'はじめての記録です。そのときエレメントも交換したかを選んでください'}</span>
        </div>
      </section>
      <button type="button" class="btn-primary" data-action="save-oil">オイル交換を記録する</button>

      <h2 class="section-title">これまでの記録</h2>
      <div class="card list">${changes.map((c, i) => {
        const prev = changes[i + 1];
        return `<div class="row oil-row">
          <span class="row-main">
            <span class="row-title">${e(c.date.replace(/-/g, '/'))}　${kmText(c.odo)}</span>
            <span class="row-text">${c.element ? '<span class="tag">エレメントも交換</span> ' : 'オイルのみ　'}${prev ? `前回から ${kmText(c.odo - prev.odo)}` : '最初の記録'}${c.note ? `　${e(c.note)}` : ''}</span>
          </span>
          <button type="button" class="btn-text danger" data-action="delete-oil" data-id="${e(c.id)}">消す</button>
        </div>`;
      }).join('') || '<p class="empty">まだ記録がありません</p>'}</div>
    </main>`;
}

async function saveOil() {
  const date = document.getElementById('oil-date').value;
  const odo = num(document.getElementById('oil-odo').value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('交換した日を入れてください'); return; }
  if (odo == null) { toast('交換したときのメーターを入れてください'); return; }
  if (!state.oilElement) { toast('オイルエレメントを交換したかどうかを選んでください'); return; }
  const s = state.settings;
  const element = state.oilElement === '交換した';
  s.oilChanges = [...(s.oilChanges || []), newOilChange(date, odo, element)];
  s.oilAck = null;
  await db.putSettings(s);
  state.oilElement = null;
  toast(element ? 'オイルとエレメントの交換を記録しました' : 'オイル交換を記録しました');
  renderOil();
  window.scrollTo(0, 0);
}

// オイル交換のお知らせ（まだ見せていない目安を超えたとき。5,000km を超えたら毎回）
async function checkOil() {
  const s = state.settings;
  const st = oilStatus(s, state.records);
  const msg = oilAlertToShow(s, st);
  if (!msg || document.querySelector('.dialog')) return;
  if (st.level < OIL_LIMIT) {
    s.oilAck = { changeId: st.last.id, level: st.level };
    await db.putSettings(s);
  }
  if (await ask(msg.text, 'オイル交換を記録する', msg.danger, 'あとで', msg.title)) go('oil');
}

// ---- 売上表（前払い） ----

// 乗務後点呼の画面に出す「今日の案件」：佐川急便は配達個数、法人の単価は種類ごとの個数、法人の日極は金額
function jobsPickField() {
  const s = state.settings;
  const jobs = jobsOf(s);
  if (!jobs.length) return '';
  const picked = state.draft.jobs || [];
  const unitInput = (i, k, label, v) => `<label><span>${e(label)}</span><input data-jobcnt="${i}" data-k="${k}" value="${v ?? ''}" type="number" inputmode="numeric" min="0"></label>`;
  return `<div class="field"><span class="field-label">今日の案件（いくつでも選べます）</span>
      <div class="picks">${jobs.map((j) => `<button type="button" class="chip" data-pick-job="${e(j.id)}" aria-pressed="${picked.some((p) => p.id === j.id)}">${e(jobLabel(j))}</button>`).join('')}</div>
      <span class="field-note">前回と同じ組み合わせが、はじめから選ばれています。</span></div>
    ${picked.length ? `<div class="picked">${picked.map((p, i) => {
      const j = jobs.find((x) => x.id === p.id);
      if (!j) return '';
      let inputs;
      if (isFixedSagawa(j)) {
        inputs = `<span class="ex">日極 ${yen(unitPrices(sagawaSettings(j, s)).daily)}（金額は固定）</span>
          <div class="counts pj-counts">${COUNT_KEYS.map(([k, t]) => unitInput(i, k, t, num(p.counts?.[k]))).join('')}</div>`;
      } else if (j.kind === 'sagawa') {
        inputs = `<div class="counts pj-counts">${COUNT_KEYS.map(([k, t]) => unitInput(i, k, t, num(p.counts?.[k]))).join('')}</div>`;
      } else if (j.pay === 'unit') {
        inputs = `<div class="counts pj-counts">${jobUnits(j).map((u) => unitInput(i, u.i, `${u.label}（${yen(u.price)}）`, num(p.counts?.[u.i]))).join('')}</div>`;
      } else {
        const fixed = num(j.price) != null;
        const last = fixed ? null : lastJobAmount(j.id, state.draft.date);
        inputs = `<input class="pj-amount ${num(p.amount) == null ? 'need' : ''}" data-jobamt="${i}" value="${num(p.amount) ?? ''}" inputmode="numeric" placeholder="${last != null ? `例：${last.toLocaleString('ja-JP')}` : '金額（円）'}" aria-label="${e(jobLabel(j))}の金額">
          ${fixed ? '' : `<span class="ex">金額は毎回入れます${last != null ? `（前回 ${yen(last)}）` : ''}</span>`}`;
      }
      return `<div class="pj"><b class="${j.kind === 'corp' && j.pay === 'daily' ? '' : 'pj-wide'}">${e(jobLabel(j))}</b>${inputs}
        <input class="memo" data-jobmemo="${i}" value="${e(p.memo || '')}" placeholder="メモ（任意）" aria-label="${e(jobLabel(j))}のメモ"></div>`;
    }).join('')}</div>
    <div class="daytotal"><span class="muted">今日の金額</span><b id="daytotal">${yen(draftDayTotal())}</b></div>` : ''}`;
}

// 入力中の「今日の金額」
function draftDayTotal() {
  const d = state.draft;
  return dayJobs({ date: d.date, jobs: d.jobs || [] }, state.settings).reduce((t, j) => t + (j.amount || 0), 0);
}

// その案件の、前回入れた金額（金額が毎回変わる日極の案件の入力欄に「例」として出す）
function lastJobAmount(id, date) {
  for (let i = state.records.length - 1; i >= 0; i--) {
    const r = state.records[i];
    if (r.date >= date || !Array.isArray(r.jobs)) continue;
    const j = r.jobs.find((x) => x.id === id && num(x.amount) != null);
    if (j) return num(j.amount);
  }
  return null;
}

// 今日の案件の入力の初期値（決まった日極の金額は入れ、個数・毎回変わる金額は空）
function newDayJob(j) {
  return j.kind === 'sagawa' ? { id: j.id, counts: {}, memo: '' }
    : j.pay === 'unit' ? { id: j.id, counts: [], memo: '' }
      : { id: j.id, amount: num(j.price), memo: '' };
}

// 新しく乗務後点呼を入れるときの「今日の案件」：前回と同じ組み合わせ
function defaultDayJobs(date) {
  const jobs = jobsOf(state.settings);
  for (let i = state.records.length - 1; i >= 0; i--) {
    const r = state.records[i];
    if (r.date >= date) continue;
    const prev = dayJobs(r, state.settings).filter((x) => x.job);
    if (prev.length) return prev.map((x) => newDayJob(x.job));
  }
  return jobs.length === 1 ? [newDayJob(jobs[0])] : [];
}

// 記録の「その日の案件」を、入力用の形にする
const toDayEntry = (x) => ({ id: x.id, counts: x.counts, amount: x.job?.kind === 'corp' && x.job.pay === 'daily' ? x.amount : undefined, memo: x.memo || '' });

function salesContext() {
  const s = state.settings;
  const { y, m } = state.salesMonth;
  const today = todayKey();
  const thisMonth = today.startsWith(`${y}-${pad2(m)}-`);
  const upto = thisMonth ? today : null;
  return { s, y, m, today, thisMonth, upto, data: monthSales(state.records, y, m, s, upto) };
}


// withOffice：false なら営業所名を書かない（PDF では表題の「佐川急便」の右に書くため）
const mdText = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

// 売上表の2行目：車両（リース・持ち込み）・前月の売上（40万円以上・未満）・新人保証の期間（佐川急便の案件が2つ以上のとき）
function salesInfoLine(s, y, m) {
  const parts = [`車両：${s.leaseCar === 'yes' ? 'リース' : '持ち込み'}`];
  const pd = new Date(y, m - 2, 1);
  const py = pd.getFullYear();
  const pm = pd.getMonth() + 1;
  let prev;
  if (hasMonth(state.records, py, pm)) prev = monthSales(state.records, py, pm, s).total.amount >= 400000 ? '40万円以上' : '40万円未満';
  else if (s.prevSalesMonth === advanceKey(py, pm) && s.prevSalesLevel === 'over') prev = '40万円以上';
  else if (s.prevSalesMonth === advanceKey(py, pm) && s.prevSalesLevel === 'under') prev = '40万円未満';
  else prev = 'なし';
  parts.push(`前月（${pm}月）の売上：${prev}`);
  const jobs = jobsOf(s);
  if (!(jobs.length === 1 && jobs[0].kind === 'sagawa')) {
    const monthFrom = `${y}-${pad2(m)}-01`;
    const monthTo = `${y}-${pad2(m)}-31`;
    jobs.filter((j) => j.kind === 'sagawa').forEach((j) => {
      const nb = newbiePeriod(sagawaSettings(j, s));
      if (nb && nb.from <= monthTo && nb.to >= monthFrom) parts.push(`新人保証：1日+${yen(nb.perDay)}（${mdText(nb.from)}〜${mdText(nb.to)}）`);
    });
  }
  return parts.join('　');
}

function salesSub(s, y, m, withOffice = true) {
  const jobs = jobsOf(s);
  // 佐川急便の営業所1つだけ：単価と新人保証
  if (jobs.length === 1 && jobs[0].kind === 'sagawa') {
    const ss = sagawaSettings(jobs[0], s);
    const p = unitPrices(ss);
    const nb = newbiePeriod(ss);
    const monthFrom = y ? `${y}-${pad2(m)}-01` : '';
    const monthTo = y ? `${y}-${pad2(m)}-31` : '';
    if (isFixedSagawa(jobs[0])) return `${withOffice ? `営業所：${officeName(ss)}　` : ''}日極：${yen(p.daily)}`;
    const nbText = nb && (!y || (nb.from <= monthTo && nb.to >= monthFrom)) ? `　新人保証：1日+${yen(nb.perDay)}（${mdText(nb.from)}〜${mdText(nb.to)}）` : '';
    return `${withOffice ? `営業所：${officeName(ss)}　` : ''}単価：宅配 ${yen(p.takuhai)}・商業 ${yen(p.shogyo)}・集荷 ${yen(p.shuka)}${p.daily ? `＋1日 ${yen(p.daily)}` : ''}${nbText}`;
  }
  // 法人の日極1つだけ：日極
  if (jobs.length === 1 && jobs[0].pay === 'daily' && num(jobs[0].price) != null) return `所属：${jobLabel(jobs[0])}　日極：${yen(jobs[0].price)}`;
  return `案件：${jobs.map(jobLabel).join('／')}`;
}

// 売上表の表題：案件が1つならその名前（佐川急便は「佐川急便　八王子営業所」）、いくつかなら「売上表」
function salesTitle(s) {
  const jobs = jobsOf(s);
  if (jobs.length !== 1) return '売上表';
  return jobs[0].kind === 'sagawa' ? jobLabel(jobs[0]).replace(/^佐川急便 /, '佐川急便　') : jobLabel(jobs[0]);
}

// その日の案件の個数（佐川急便：宅配・商業・集荷、法人の単価：種類ごと）を文字にする
function jobCountsText(j) {
  if (!j.job) return '';
  if (j.job.kind === 'sagawa') return COUNT_KEYS.filter(([k]) => num(j.counts?.[k]) != null).map(([k, t]) => `${t}${num(j.counts[k])}`).join('・');
  if (j.job.pay === 'unit') return jobUnits(j.job).filter((u) => num(j.counts?.[u.i]) != null).map((u) => `${u.label}${num(j.counts[u.i])}`).join('・');
  return '';
}

// その月に受けた前払いの履歴・合計・残り（希望する前払い額の欄の上）
// 前払いの対象額（前月の売上はアプリの記録から）
function advanceInfo(s, y, m, salesAmount) {
  const pd = new Date(y, m - 2, 1);
  const py = pd.getFullYear();
  const pm = pd.getMonth() + 1;
  const prevSales = hasMonth(state.records, py, pm) ? monthSales(state.records, py, pm, s).total.amount : null;
  const prevLevel = prevSales == null ? prevSalesLevel(s, y, m) : null;
  const first = isFirstAdvanceMonth(s, y, m);
  const total = advanceTotal(s, y, m);
  const lim = advanceLimit({ sales: salesAmount, advanced: total, prevSales, prevLevel, first, lease: s.leaseCar === 'yes' });
  return { ...lim, first, prevSales, prevLevel, pm, total, remaining: lim.target };
}

function advanceSection(s, y, m, salesAmount, today) {
  const list = advanceHistory(s, y, m);
  const info = advanceInfo(s, y, m, salesAmount);
  const total = info.total;
  const def = today.startsWith(`${y}-${pad2(m)}-`) ? today : dateKey(y, m, 1);
  return `<section class="card adv">
    <h2 class="card-title">${m}月の前払い</h2>
    <div class="adv-list">${list.map((a) => `<div class="adv-row">
        <span>${a.prior ? 'アプリ以前' : `${Number(a.date.slice(5, 7))}/${Number(a.date.slice(8))}`}</span><b>${yen(a.amount)}</b>
        <button type="button" class="btn-text danger" data-action="delete-advance" data-id="${e(a.id)}">消す</button>
      </div>`).join('') || '<p class="empty">まだ前払いの記録はありません</p>'}</div>
    <div class="adv-target">
      <span class="muted">前払い可能額の計算</span>
      <span class="adv-formula">（売上 ${yen(salesAmount)}${info.reserve ? ` − 留保 ${yen(info.reserve)}` : ''}）× 50%${total ? ` − 前払い済み ${yen(total)}` : ''} ＝ <b>${yen(info.exact)}</b></span>
      <span class="small">${info.reason ? `留保：${info.reason}${info.prevSales != null && !info.first ? `（${info.pm}月の売上 ${yen(info.prevSales)}）` : info.prevLevel ? '（設定で選んだ前月の売上）' : ''}` : info.prevSales != null ? `${info.pm}月の売上 ${yen(info.prevSales)}（40万円以上のため留保なし）` : info.prevLevel === 'over' ? `${info.pm}月の売上 40万円以上（設定で選択）のため留保なし` : ''}</span>
    </div>
    <div class="adv-sum">
      <div><span class="muted">前払いの合計</span><b>${yen(total)}</b></div>
      <div class="adv-rest"><span class="muted">前払い可能額</span><b>${yen(info.remaining)}</b>${info.exact !== info.target ? '<small class="muted rest-note">（千円未満は切り捨て）</small>' : ''}</div>
    </div>
    <div class="adv-add">
      <p class="field-note adv-note"><b>申請が承認されたら</b>、今回の前払い金額を入力して「前払いを記録する」を押してください。</p>
      <input id="adv-date" type="date" value="${def}" aria-label="前払いを受けた日">
      <input id="adv-amount" type="number" inputmode="numeric" min="0" placeholder="金額（円）" aria-label="前払いの金額">
      <button type="button" class="btn-outline" data-action="add-advance">前払いを記録する</button>
    </div>
  </section>`;
}

function renderSales() {
  const { s, y, m, today, thisMonth, upto, data } = salesContext();
  const ready = salesReady(s);
  const sagawa = hasSagawa(s);
  const t = data.total;
  // 入力がまだの日は、はじめから開いておく（押すと閉じる）
  const isOpen = (r) => (state.salesOpen?.has(r.date)) || (r.missing && !state.salesClosed?.has(r.date));
  const rows = data.rows.filter((r) => r.worked && r.inRange).reverse().map((r) => {
    const miss = r.jobs.find((j) => j.missing);
    const tag = !r.missing ? '' : !r.jobs.length || (miss && miss.job?.kind === 'corp' && miss.job.pay === 'daily') ? '金額まだ' : '個数まだ';
    return `
    <button type="button" class="row sales-row" data-action="toggle-day" data-date="${r.date}" aria-expanded="${isOpen(r)}">
      <span class="row-day ${r.week === '日' ? 'sun' : r.week === '土' ? 'sat' : ''}"><b>${r.day}</b><span>${r.week}</span></span>
      <span class="row-main">
        <span class="row-sub">${e(hm(r.start))} → ${e(hm(r.end) || '--:--')}　${r.km != null ? kmText(r.km) : ''}</span>
        <span class="jobs-line">${r.jobs.length ? e(r.jobs.map((j) => j.name).join('／')) : '案件を選んでいません'}</span>
      </span>
      <span class="row-km">${r.amount != null ? yen(r.amount) : ''}${r.newbie ? `<span class="nb-line">新人保証 ${yen(r.newbie)}</span>` : ''}${tag ? `<span class="tag warn-tag">${tag}</span>` : ''}</span>
    </button>
    ${isOpen(r) ? `<div class="day-detail">
      ${r.jobs.map((j) => {
        // 佐川急便・法人の単価は、ここで個数を入れられる
        const cnt = j.job?.kind === 'sagawa' ? COUNT_KEYS.map(([k, tx]) => [k, tx, j.counts?.[k]])
          : j.job?.pay === 'unit' ? jobUnits(j.job).map((u) => [u.i, u.label, j.counts?.[u.i]]) : null;
        return `<div class="dj"><div><span>${e(j.name)}${j.memo ? `　<span class="muted">${e(j.memo)}</span>` : ''}</span><b>${j.amount == null ? '<span class="warn-text">まだ</span>' : yen(j.amount)}</b></div>
          ${cnt ? `<span class="counts small-counts">${cnt.map(([k, tx, v]) => `<label><span>${e(tx)}</span><input data-sales-date="${r.date}" data-sales-job="${e(j.id)}" data-sales-key="${k}" value="${num(v) ?? ''}" type="number" inputmode="numeric" min="0"></label>`).join('')}</span>` : ''}</div>`;
      }).join('')}
      <button type="button" class="btn-text" data-action="open-day" data-date="${r.date}" data-back="sales">この日の案件・金額を直す</button>
    </div>` : ''}`;
  }).join('');
  app.innerHTML = `
    <main class="screen">
      ${head('売上表（前払い）')}
      <div class="month-nav">
        <button type="button" class="icon-btn" data-action="sales-month" data-step="-1" aria-label="前の月">${ICON.prev}</button>
        <b>${y}年${m}月</b>
        <button type="button" class="icon-btn" data-action="sales-month" data-step="1" aria-label="次の月">${ICON.next}</button>
      </div>
      ${!ready ? `<section class="card pad warn-card">
        <p><b>はじめに、設定で案件（佐川急便・法人）を登録してください。</b></p>
        <button type="button" class="btn-outline" data-action="go" data-view="settings">設定を開く</button>
      </section>` : `
      <section class="card pad sales-total">
        <span class="muted">${thisMonth ? `${m}月1日〜今日（${Number(today.slice(8))}日）の売上` : `${m}月の売上`}</span>
        <b class="oil-big">${yen(t.amount)}</b>
        <span class="small">稼働 ${t.days}日${sagawa ? `・宅配 ${t.takuhai}個・商業 ${t.shogyo}個・集荷 ${t.shuka}個` : ''}・${kmText(t.km)}</span>
        ${t.missing ? `<span class="small warn-text">個数・金額がまだの日が ${t.missing}日あります</span>` : ''}
        <span class="small muted">${e(salesSub(s, y, m))}</span>
      </section>
      ${advanceSection(s, y, m, t.amount, today)}
      <section class="card fields">
        ${field('希望する前払い額（円）', `<input id="advance" data-advance="${advanceKey(y, m)}" value="${advanceOf(s, y, m) ?? ''}" type="number" inputmode="numeric" min="0" placeholder="例：50000">`,
          advanceOf(s, y, m) != null && advanceOf(s, y, m) > advanceInfo(s, y, m, t.amount).remaining
            ? '<span class="warn-text">前払い可能額より多い額です</span>' : '')}
      </section>
      <p class="info">前払いは<b>月初めからの売上</b>で計算します。乗務後点呼で選んだ案件の売上の合計を、その日の売上として数えます。日付を押すと内訳が見られ、個数もここで入れられます。</p>
      <button type="button" class="btn-primary" data-action="share-sales">PDFにしてLINEで送る</button>
      <button type="button" class="btn-text" data-action="preview-sales">プレビューで確認する</button>
      <div class="card list">${rows || '<p class="empty">この月はまだ乗務の記録がありません</p>'}</div>
      <div id="preview" class="preview"></div>`}
    </main>`;
}

// 送る売上表のページ：1枚目は1日の合計だけ。その月に案件を組み合わせていれば（2つ以上の案件で乗務していれば）、案件ごとの内訳のページを足す
function salesCanvases() {
  const s = state.settings;
  const { y, m, data } = salesContext();
  const worked = data.rows.filter((x) => x.worked && x.inRange);
  if (new Set(worked.flatMap((r) => r.jobs.map((j) => j.id || j.name))).size < 2) return [salesCanvas()];
  const rows = [];
  const sums = new Map();
  for (const r of worked) {
    r.jobs.forEach((j, i) => {
      const note = [jobCountsText(j), j.memo].filter(Boolean).join('　');
      rows.push([i ? '' : `${r.day}（${r.week}）`, j.name, j.amount == null ? 'まだ' : yen(j.amount), note]);
      const t = sums.get(j.name) || { days: 0, amount: 0 };
      t.days++;
      t.amount += j.amount || 0;
      sums.set(j.name, t);
    });
    if (!r.jobs.length) rows.push([`${r.day}（${r.week}）`, '（案件を選んでいません）', '', '']);
  }
  return [salesCanvas(), ...renderSalesDetail({
    title: '売上の内訳', ym: `${y}年 ${m}月`, name: s.driverName, sub: jobsOf(s).length > 1 ? `案件：${jobsOf(s).map(jobLabel).join('／')}` : salesTitle(s),
    rows, sums: [...sums].map(([k, v]) => [k, `${v.days}日`, yen(v.amount)]),
    total: yen(data.total.amount)
  })];
}

function salesCanvas() {
  const { s, y, m, today, thisMonth, data } = salesContext();
  const sagawa = hasSagawa(s);
  const single = jobsOf(s).length === 1;
  // 佐川急便の案件があれば個数の列あり（法人の分は数えない）。佐川急便がなければ個数の列を出さない
  const countHead = sagawa ? COUNT_KEYS.map(([, tx]) => ({ text: tx, w: 9 })) : [];
  // 新人保証の期間がかかっている月は「新人保証」の列を足す（金額には新人保証を含む）
  const nbCol = sagawa && data.hasNewbie;
  const head = [
    { text: '日', w: 5 }, { text: '曜日', w: 6 }, { text: '開始', w: 10 }, { text: '終了', w: 10 },
    ...countHead, { text: '稼働距離', w: sagawa ? (nbCol ? 11 : 13) : 20, align: 'right' },
    ...(nbCol ? [{ text: '新人保証', w: 12, align: 'right' }] : []),
    { text: '金額', w: sagawa ? (nbCol ? 15 : 16) : 24, align: 'right' }
  ];
  const blank = Array(head.length - 4).fill('');
  const rows = data.rows.map((r) => {
    if (r.off) return [r.day, r.week, '休み', '', ...blank];
    if (!r.worked || !r.inRange) return [r.day, r.week, '', '', ...blank];
    return [r.day, r.week, hm(r.start), hm(r.end), ...(sagawa ? COUNT_KEYS.map(([k]) => r.counts[k] ?? '') : []), r.km != null ? kmText(r.km) : '',
      ...(nbCol ? [r.newbie ? yen(r.newbie) : ''] : []), r.amount != null ? yen(r.amount) : ''];
  });
  const t = data.total;
  const foot = ['合計', '', `${t.days}日`, '', ...(sagawa ? [`${t.takuhai}`, `${t.shogyo}`, `${t.shuka}`] : []), kmText(t.km), ...(nbCol ? [yen(t.newbie)] : []), yen(t.amount)];
  const [ty, tm, td] = today.split('-').map(Number);
  return renderSalesSheet({
    title: salesTitle(s),
    ym: `${y}年 ${m}月`,
    name: s.driverName,
    sub: salesSub(s, y, m, !(sagawa && single)),
    sub2: salesInfoLine(s, y, m),
    head,
    rows,
    foot,
    summary: { label: thisMonth ? `${m}月1日〜${td}日の売上合計` : `${m}月の売上合計`, value: yen(t.amount) },
    paid: { label: '前払い済み', value: yen(advanceTotal(s, y, m)) },
    request: advanceOf(s, y, m) != null ? { label: '今回希望する前払い額', value: yen(advanceOf(s, y, m)) } : null,
    note: [
      ...(sagawa ? ['＊大型貨物料金は省略とさせていただきます'] : []),
      `作成日：${ty}年${tm}月${td}日`,
      `ドライバーズサポート株式会社`
    ]
  });
}

// ---- 車検・免許証の期限 ----

// ホームに出す期限のカード（60日前から）
function expiryCards() {
  return expiryStatus(state.settings, todayKey()).filter((st) => st.stage > 0).map((st) => {
    const danger = st.stage >= 3;
    const text = st.stage === EXPIRED ? `${st.item.dateLabel}を過ぎています` : st.days === 0 ? '今日が期限です' : `あと <b>${st.days}日</b>`;
    return `<button type="button" class="card pad expiry-card ${danger ? 'danger' : 'caution'}" data-action="go" data-view="settings">
      <span class="oil-head"><b>${st.item.label}</b><span class="oil-num">${text}</span></span>
      <span class="small">${st.item.dateLabel}：${st.date.replace(/-/g, '/')}　更新したら、設定で新しい日付に入れ直してください</span>
    </button>`;
  }).join('');
}

// 期限のお知らせ（まだ見せていない段階のもの。期限切れは毎回）
async function checkExpiry() {
  const s = state.settings;
  for (const st of expiryAlertsToShow(s, todayKey())) {
    if (document.querySelector('.dialog')) return;
    if (st.stage !== EXPIRED) {
      s.expiryAck = { ...(s.expiryAck || {}), [st.item.key]: { date: st.date, stage: st.stage } };
      await db.putSettings(s);
    }
    const msg = expiryMessage(st);
    if (await ask(msg.text, '日付を直す', msg.danger, 'わかった', msg.title)) { go('settings'); return; }
  }
}

// アプリを開いたとき・点呼を記録したときのお知らせ（期限 → オイル交換の順）
async function runAlerts() {
  await checkExpiry();
  if (state.view === 'home') await checkOil();
  if (state.view === 'home') await checkBackup();
}

// 月末のバックアップのお知らせ
async function checkBackup() {
  const s = state.settings;
  const key = backupReminder(todayKey(), s);
  if (!key || !state.records.length || document.querySelector('.dialog')) return;
  s.backupShown = key; // お知らせは月に1回だけ
  await db.putSettings(s);
  const m = Number(key.slice(5));
  const yes = await ask(`${m}月の記録のバックアップを作りましょう。スマホをなくしたり壊れたりしても、バックアップがあれば記録を戻せます。保存先は、iPhone は iCloud Drive、Android は Google ドライブがおすすめです。`, '今すぐ作る', false, 'あとで', 'バックアップのお知らせ');
  if (yes) runBusy(backup);
}

// ---- 画面：記録の決まり ----

function renderRules() {
  app.innerHTML = `
    <main class="screen">
      ${head('記録の決まり')}
      <p class="small">軽貨物（貨物軽自動車運送事業）の運転日報と点呼記録簿には、国の決まり（貨物自動車運送事業輸送安全規則）があります。記録を作って保管する義務があるのは、<b>自分の名前で事業を届け出ている本人（事業者）</b>です。</p>

      <h2 class="section-title">保存しておく期間</h2>
      <div class="card list rules">
        <div class="rule"><span class="rule-name">点呼記録簿<small>以前から義務（アルコール検知器は2011年4月から）</small></span><span class="rule-term">1年間</span></div>
        <div class="rule"><span class="rule-name">運転日報（業務記録）<small>2025年4月から義務</small></span><span class="rule-term">1年間</span></div>
        <div class="rule"><span class="rule-name">事故の記録<small>2025年4月から義務</small></span><span class="rule-term">3年間</span></div>
      </div>

      <h2 class="section-title">点呼で確かめること</h2>
      <div class="card pad">
        <p class="small"><b>乗務前（出発するとき）</b></p>
        <ul class="rule-list">
          <li>酒気帯びの有無（<b>アルコール検知器を使う</b>）</li>
          <li>健康状態（病気・疲れ・睡眠不足などで、安全に運転できないおそれがないか）</li>
          <li>日常点検の結果</li>
        </ul>
        <p class="small"><b>乗務後（帰ってきたとき）</b></p>
        <ul class="rule-list">
          <li>酒気帯びの有無（<b>アルコール検知器を使う</b>）</li>
          <li>車両・道路・運行の状況の報告</li>
        </ul>
        <p class="small muted">点呼でのアルコール検知器の使用は、2011年4月から義務です。酒気帯びがあるときは乗務できません。</p>
      </div>

      <h2 class="section-title">運転日報に書くこと</h2>
      <div class="card pad">
        <p class="small">乗務を始めた・終えた地点と時刻、主な経過地点、走行距離、休憩、荷役作業や荷主都合の待機、事故・異常など。このアプリの入力項目で、すべて書けます。</p>
      </div>

      <h2 class="section-title">このアプリでの保存</h2>
      <div class="card pad">
        <ul class="rule-list">
          <li>記録は<b>自身で保管</b>します。会社への提出は、決まりでは求められていません。</li>
          <li>記録はこのスマホの中だけにあります。スマホの故障・紛失で消えないよう、<b>毎月「書き出し・共有」で書き出して</b>、<b>パソコンやクラウド</b>など別の場所にも保存してください。</li>
          <li>事務所（運行管理者）にも送っておくと、会社でも控えを残せて安心です。</li>
          <li>運輸支局の監査などで求められたら、見せられるようにしておきます。事故の記録は、届け出た営業所（個人事業主の場合は自宅）で保管する決まりです。</li>
          <li>アプリの記録は、自分で消さないかぎり残ります。保存期間（1年・事故は3年）がたっていない記録は消さないでください。</li>
          <li>スマホを替える・アプリを消す前に、設定から<b>バックアップ</b>を作ってください。</li>
        </ul>
      </div>

      <h2 class="section-title">事故が起きたら</h2>
      <div class="card pad">
        <p class="small">すぐに事務所（運行管理者）に連絡してください。ホームの「事故の記録」から記録できます。事故の記録（概要・原因・再発防止対策など）は3年間保存します。死者・重傷者が出た事故や、転覆・転落・火災・踏切での事故、飲酒運転・健康状態が原因の事故など一定の事故は、30日以内に国への報告が必要です。報告するのは届け出ている本人（事業者）なので、事務所に相談しながら進めてください。</p>
      </div>

      <p class="info">決まりは法令の改正で変わることがあります。くわしくは事務所か運輸支局に確かめてください。<br>
        出典：<a href="https://www.mlit.go.jp/report/press/jidosha02_hh_000665.html" target="_blank" rel="noopener">国土交通省「貨物軽自動車運送事業者に対する規制の適正化」</a></p>
    </main>`;
}

// ---- 画面：前払いのルールと注意事項 ----

function renderAdvanceRules() {
  app.innerHTML = `
    <main class="screen">
      ${head('前払いのルールと注意事項')}
      <h2 class="section-title">前払いできる金額（対象額）</h2>
      <div class="card pad">
        <ul class="rule-list">
          <li><b>稼働を開始した月のはじめての前払い</b>は、まず売上のうち<b>留保額</b>を差し引きます。留保額は、<b>リース車両を利用している方は10万円</b>、<b>車両持ち込みの方は6万円</b>です。それを超えた売上の<b>50%</b>が前払いの対象額です。</li>
          <li><b>2回目からの前払い</b>は、（売上 − 留保額）の<b>50%</b>から、その月に<b>すでに受けた前払いの額</b>を差し引いた額が前払いできる額です。</li>
          <li>前払いできる額は、<b>千円未満を切り捨て</b>ます（例：104,230円 → 104,000円）。</li>
          <li><b>翌月以降</b>は、その月の売上の<b>50%</b>が前払いの対象額です（支払いは2か月サイトのため、まだ支払われていない売上があるので、はじめての留保はいりません）。</li>
          <li>ただし、<b>前月の売上が40万円に届かなかった場合</b>は、<b>5万円の留保</b>が必要です（売上によっては個別計算になることもあります）。</li>
          <li>前払いは<b>当月分を当月中にだけ</b>申請できます。月が変わるとリセットされ、元には戻せません。</li>
          <li>このアプリでは、<b>売上表（前払い）</b>の画面で、前払いの対象額と前払い可能額を自動で計算します（リース車両かどうかは設定で選びます）。</li>
        </ul>
      </div>

      <h2 class="section-title">申請のしかた</h2>
      <div class="card pad">
        <ul class="rule-list">
          <li>受付は<b>平日の8時〜13時</b>です。13時以降に順に処理します。担当者が終日不在の日は、翌日の処理になります。</li>
          <li><b>土日・祝日は申請できません。</b></li>
          <li>月末の最後の申請は、<b>最終平日の12時まで</b>です。</li>
          <li>申請は LINE で受け付けます。事務所で処理して振り込んだら、LINE で連絡します。</li>
        </ul>
      </div>

      <h2 class="section-title">前払いのアプリ「PAYS」</h2>
      <div class="card pad">
        <ul class="rule-list">
          <li>前払いは「<b>PAYS</b>」というアプリを使います。はじめに、ご自身で<b>銀行口座の情報</b>を登録してください。</li>
          <li>口座の情報を間違えると、振り込みや前払いができなくなることがあります。PAYS 側の取り消しの手続きが終わるまで（2〜3営業日かかることがあります）は新しく申請できず、月をまたぐと前払いできる金額がリセットされてしまいます。<b>登録するときは、よく確かめてください。</b></li>
        </ul>
      </div>

      <h2 class="section-title">手数料と振込金額</h2>
      <div class="card pad">
        <ul class="rule-list">
          <li><b>利用手数料：6%（税抜）</b>　<b>振込手数料：330円（税込）</b></li>
          <li>振込金額は、申請額から利用手数料と振込手数料を差し引き、100円未満を切り捨てた金額です。</li>
        </ul>
        <div class="fee-ex">
          <p class="small"><b>例：10,000円を申請した場合</b></p>
          <p class="small">振込金額：<b>9,000円</b></p>
          <p class="small">委託料の支払いのときに差し引く金額：<br>9,000円 ＋ 利用手数料 594円 ＋ 振込手数料 330円 ＝ <b>9,924円</b></p>
        </div>
      </div>
    </main>`;
}

// ---- 描画 ----

function render() {
  if (state.invite === 'none') state.view = 'gate';
  else if (state.invite === 'revoked') { if (state.view !== 'export') state.view = 'stopped'; }
  else if (state.view !== 'setup' && state.view !== 'invited' && !state.settings.driverName) state.view = 'setup';
  const views = { gate: renderGate, invited: renderInvited, stopped: renderStopped, sales: renderSales, oil: renderOil, accidents: renderAccidents, accident: renderAccidentForm, rules: renderRules, advrules: renderAdvanceRules, setup: renderSetup, settings: renderSettings, home: renderHome, entry: renderEntry, list: renderList, export: renderExport };
  try {
    (views[state.view] || renderHome)();
  } catch (err) {
    // 画面を出せなかったときは、何も起きないままにせず、内容を見せる（原因を調べるため）
    console.error(err);
    const where = String(err?.stack || '').split('\n').slice(1, 3).map((l) => l.trim()).join(' / ');
    toast(`画面を開けませんでした：${err?.message || err}${where ? `（${where}）` : ''}`, 20000);
  }
}

function go(view, { push = true } = {}) {
  state.view = view;
  if (view === 'home') state.back = 'home'; // ホームに戻ったら、どこから来たかは忘れる
  if (view === 'oil') state.oilElement = null; // エレメントの選択は、開くたびに初期値から
  if (view === 'list' && !state.month) {
    const n = new Date();
    state.month = { y: n.getFullYear(), m: n.getMonth() + 1 };
  }
  if (view === 'sales' && !state.salesMonth) {
    const n = new Date();
    state.salesMonth = { y: n.getFullYear(), m: n.getMonth() + 1 };
  }
  if (view === 'export' && !state.exp.y) {
    const n = new Date();
    state.exp.y = n.getFullYear();
    state.exp.m = n.getMonth() + 1;
  }
  // スマホの「戻る」でホームに戻れるようにする
  if (push && view !== 'home') history.pushState({ view }, '');
  render();
  window.scrollTo(0, 0);
}

// スマホの「戻る」や画面左上の「＜」：ひとつ前に開いていた画面に戻る（開いた順は履歴に残してある）
window.addEventListener('popstate', (ev) => {
  if (state.view === 'setup') return;
  let to = ev.state?.view || 'home';
  // 入力の途中の画面（点呼・事故の記録）には、戻るで入り直さない
  if (to === 'entry' || to === 'accident' || to === 'setup') to = state.view === 'accident' ? 'accidents' : 'home';
  go(to, { push: false });
});

// ---- 入力の開始 ----

function openEntry(date, mode, back = 'home') {
  const s = state.settings;
  const rec = findRecord(date);
  const draft = structuredClone(rec || { date, start: null, end: null, rollcaller: s.driverName });
  if (mode === 'start' && !draft.start) draft.start = newStart(s, prevOdo(state.records, date, s), date === todayKey() ? nowTime() : '');
  if (mode === 'end' && !draft.end) {
    draft.end = newEnd(s, date === todayKey() ? nowTime() : '');
    if (!draft.start) draft.start = newStart(s, prevOdo(state.records, date, s), '');
  }
  if (mode === 'day' && !rec) {
    draft.start = newStart(s, prevOdo(state.records, date, s), '');
    draft.end = newEnd(s, '');
  }
  // 乗務後点呼に「今日の案件」を出す（以前の版の記録の配達個数は、その日の案件に読み替える）
  if (salesReady(s) && draft.end && !Array.isArray(draft.jobs)) {
    draft.jobs = rec?.end ? dayJobs(rec, s).filter((x) => x.job).map(toDayEntry) : defaultDayJobs(date);
  }
  state.draft = draft;
  state.mode = mode;
  state.back = back;
  go('entry');
}

function validate(d) {
  if (d.start && !isTime(d.start.time)) return '乗務前の点呼時刻を入れてください';
  if (d.end && !isTime(d.end.time)) return '乗務後の点呼時刻を入れてください';
  const a = num(d.start?.odo);
  const b = num(d.end?.odo);
  if (a != null && b != null && b < a) return '帰着時のメーターが、出発時より小さくなっています';
  if (a != null && b != null && b - a > 1500) return '走った距離が大きすぎます。メーターの数字を確かめてください';
  return null;
}

async function saveEntry() {
  const d = state.draft;
  const err = validate(d);
  if (err) { toast(err); return; }
  const miss = entryMissing(d);
  if (miss.length) { toast(`まだ入っていない項目があります：${miss[0]}`); updateEntryState(); return; }
  if (!d.rollcaller) d.rollcaller = state.settings.driverName; // 点呼実施者名は運転者名と同じ
  if (d.start || d.end) delete d.off; // 乗務を記録したら休みではない
  await db.putRecord(d);
  // 地点などを変えたら、次回からの初期値にする
  if (d.end) {
    const s = state.settings;
    Object.assign(s, { via: d.end.via, restPlace: d.end.restPlace, restMin: num(d.end.restMin) ?? s.restMin });
    await db.putSettings(s);
  }
  await reload();
  toast(state.mode === 'start' ? '乗務前点呼を記録しました' : state.mode === 'end' ? '乗務後点呼を記録しました。おつかれさまでした' : '記録しました');
  history.back();
  setTimeout(runAlerts, 400);
}

async function reload() {
  state.records = (await db.allRecords()).sort((a, b) => (a.date < b.date ? -1 : 1));
  state.accidents = (await db.allAccidents()).map(normalizeAccident);
}

// ---- 書き出し ----

const safeName = (s) => String(s || '').replace(/[\s　]/g, '').replace(/[\\/:*?"<>|]/g, '');

// 書き出す期間の事故の記録
function periodAccidents() {
  const { period, y, m } = state.exp;
  const prefix = period === 'year' ? `${y}-` : `${y}-${pad2(m)}-`;
  return state.accidents.filter((a) => a.date.startsWith(prefix));
}

function checkPeriod() {
  const { period, y, m } = state.exp;
  if (state.exp.doc === 'accident') {
    if (!periodAccidents().length) throw new Error(period === 'year' ? `${y}年の事故の記録はありません` : `${y}年${m}月の事故の記録はありません`);
    return;
  }
  const recs = state.records;
  if (period === 'month' && !hasMonth(recs, y, m)) throw new Error(`${y}年${m}月の記録がありません`);
  if (period === 'year' && !recs.some((r) => r.date.startsWith(`${y}-`))) throw new Error(`${y}年の記録がありません`);
}

// PDF・画面で確認する帳票（1年分のときは記録のある月だけ。運転日報・点呼記録簿の順に月ごと）
function pageSpecs() {
  const { period, y, m } = state.exp;
  const s = state.settings;
  const recs = state.records;
  if (period === 'month') return monthSheets(recs, y, m, s);
  const specs = [];
  for (let mm = 1; mm <= 12; mm++) if (hasMonth(recs, y, mm)) specs.push(...monthSheets(recs, y, mm, s));
  return specs;
}

async function showPreview() {
  checkPeriod();
  const out = document.getElementById('preview');
  out.innerHTML = '';
  if (state.exp.doc === 'accident') {
    for (const a of periodAccidents()) {
      for (const c of await accidentCanvases(a)) {
        const img = new Image();
        img.src = c.toDataURL('image/jpeg', 0.85);
        img.alt = `事故の記録（${accidentWhen(a)}）`;
        out.append(img);
      }
    }
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  for (const spec of pageSpecs()) {
    const img = new Image();
    img.src = renderSheet(spec).toDataURL('image/jpeg', 0.85);
    img.alt = `${spec.title}（${spec.info[0].text}）`;
    out.append(img);
    await new Promise((r) => setTimeout(r)); // 1枚ずつ表示する
  }
  out.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function makeExport() {
  const { period, y, m, format } = state.exp;
  const s = state.settings;
  const name = safeName(s.driverName);
  const recs = state.records;
  checkPeriod();
  if (state.exp.doc === 'accident') {
    const list = periodAccidents();
    const accBase = `${period === 'year' ? `${y}年` : `${y}年${m}月`}_${name}_事故の記録`;
    if (format === 'xlsx') return new File([buildXlsx([accidentSheet(list, s)])], `${accBase}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (format === 'pdf') return new File([await canvasesToPdf((await Promise.all(list.map(accidentCanvases))).flat())], `${accBase}.pdf`, { type: 'application/pdf' });
    return new File([accidentCsv(list)], `${accBase}.csv`, { type: 'text/csv' });
  }
  const base = period === 'year' ? `${y}${name}` : `${y}年${m}月_${name}_運転日報・点呼記録簿`;

  if (format === 'xlsx') {
    const specs = period === 'year' ? yearSheets(recs, y, s) : monthSheets(recs, y, m, s);
    return new File([buildXlsx(specs)], `${base}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  if (format === 'pdf') {
    return new File([await specsToPdf(pageSpecs())], `${base}.pdf`, { type: 'application/pdf' });
  }
  const from = period === 'year' ? `${y}-01-01` : dateKey(y, m, 1);
  const to = period === 'year' ? `${y}-12-31` : dateKey(y, m, daysInMonth(y, m));
  return new File([toCsv(recs, from, to)], `${base}.csv`, { type: 'text/csv' });
}

async function deliver(file, how) {
  if (how === 'share' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // 共有の画面を閉じただけ
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  toast(`${file.name} を保存しました`);
}

async function runBusy(fn) {
  if (state.busy) return;
  state.busy = true;
  document.body.classList.add('busy');
  try { await fn(); } catch (err) { toast(err.message || 'うまくいきませんでした'); console.error(err); }
  finally { state.busy = false; document.body.classList.remove('busy'); }
}

// ---- バックアップ ----

async function backup() {
  state.settings.lastBackup = todayKey(); // 月末のお知らせは、その月の分を作ったら出さない
  await db.putSettings(state.settings);
  const photos = [];
  for (const ph of await db.allPhotos()) photos.push({ id: ph.id, accidentId: ph.accidentId, createdAt: ph.createdAt, data: await blobToDataUrl(ph.blob) });
  const data = { app: 'nippo-sapo', version: 1, exportedAt: new Date().toISOString(), settings: state.settings, records: state.records, accidents: state.accidents, photos };
  const d = new Date();
  const file = new File([JSON.stringify(data)], `日報サポート_バックアップ_${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}.json`, { type: 'application/json' });
  await deliver(file, 'share');
}

async function restore(file) {
  const data = JSON.parse(await file.text());
  if (data?.app !== 'nippo-sapo' || !Array.isArray(data.records)) throw new Error('日報サポートのバックアップではありません');
  if (!(await ask(`${data.records.length}日分の記録を戻します。同じ日の記録は、バックアップの内容に置きかわります。`, '戻す'))) return;
  await db.putRecords(data.records.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r?.date)));
  if (Array.isArray(data.accidents)) await db.putAccidents(data.accidents.filter((a) => a?.id && /^\d{4}-\d{2}-\d{2}$/.test(a.date)));
  if (Array.isArray(data.photos)) {
    const photos = [];
    for (const ph of data.photos) {
      if (!ph?.id || !ph.accidentId || !String(ph.data).startsWith('data:image/')) continue;
      photos.push({ id: ph.id, accidentId: ph.accidentId, createdAt: ph.createdAt, blob: await dataUrlToBlob(ph.data) });
    }
    await db.putPhotos(photos);
  }
  // 招待コードは、いまこのスマホに入っているものを残す
  if (data.settings) await db.putSettings({ ...DEFAULT_SETTINGS, ...data.settings, invite: state.settings.invite || data.settings.invite || '' });
  state.settings = await db.getSettings();
  if (state.inviteName) await useInvite({ status: state.invite, name: state.inviteName });
  await reload();
  toast('バックアップから戻しました');
  go('home', { push: false });
}

// ---- 操作 ----

app.addEventListener('click', async (ev) => {
  const segBtn = ev.target.closest('[data-seg]');
  if (segBtn) {
    setPath(state.draft, segBtn.dataset.seg, segBtn.dataset.value);
    // 開いている「そのほかの項目」を開いたままにする
    const opened = [...app.querySelectorAll('details')].map((d) => d.open);
    const y = window.scrollY;
    renderEntry();
    app.querySelectorAll('details').forEach((d, i) => { if (opened[i]) d.open = true; });
    window.scrollTo(0, y);
    return;
  }
  const accSegBtn = ev.target.closest('[data-acc-seg]');
  if (accSegBtn) {
    const key = accSegBtn.dataset.accSeg;
    const same = getPath(state.acc, key) === accSegBtn.dataset.value;
    setPath(state.acc, key, same && 'toggle' in accSegBtn.dataset ? '' : accSegBtn.dataset.value);
    rerenderAccident();
    return;
  }
  const kindBtn = ev.target.closest('[data-acc-kind]');
  if (kindBtn) {
    const kinds = state.acc.annex.kinds;
    const i = kinds.indexOf(kindBtn.dataset.accKind);
    if (i >= 0) kinds.splice(i, 1); else kinds.push(kindBtn.dataset.accKind);
    rerenderAccident();
    return;
  }
  const oilEl = ev.target.closest('[data-oil-element]');
  if (oilEl) {
    state.oilElement = oilEl.dataset.oilElement;
    oilEl.parentElement.querySelectorAll('[data-oil-element]').forEach((b) => b.setAttribute('aria-pressed', b === oilEl));
    return;
  }
  const pickJob = ev.target.closest('[data-pick-job]');
  if (pickJob) {
    // 今日の案件を選ぶ・外す（登録した順に並べる）
    const id = pickJob.dataset.pickJob;
    const jobs = jobsOf(state.settings);
    const cur = state.draft.jobs || [];
    const next = cur.some((p) => p.id === id) ? cur.filter((p) => p.id !== id) : [...cur, newDayJob(jobs.find((j) => j.id === id))];
    state.draft.jobs = jobs.map((j) => next.find((p) => p.id === j.id)).filter(Boolean);
    const opened = [...app.querySelectorAll('details')].map((d) => d.open);
    const y = window.scrollY;
    renderEntry();
    app.querySelectorAll('details').forEach((d, i) => { if (opened[i]) d.open = true; });
    window.scrollTo(0, y);
    return;
  }
  const setSeg = ev.target.closest('[data-setting-seg]');
  if (setSeg) {
    // 前月の売上は、選んでいるものをもう一度押すと取り消し
    const off = setSeg.dataset.settingSeg === 'prevSalesLevel' && setSeg.getAttribute('aria-pressed') === 'true';
    state.settings[setSeg.dataset.settingSeg] = off ? '' : setSeg.dataset.value;
    setSeg.parentElement.querySelectorAll('[data-setting-seg]').forEach((b) => b.setAttribute('aria-pressed', !off && b === setSeg));
    if (setSeg.dataset.settingSeg === 'prevSalesLevel') state.settings.prevSalesMonth = prevMonthKey();
    updateSaveState();
    return;
  }
  const expBtn = ev.target.closest('[data-exp]');
  if (expBtn) {
    state.exp[expBtn.dataset.exp] = expBtn.dataset.value;
    renderExport();
    return;
  }

  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const { action } = el.dataset;
  if (action === 'go') {
    // 戻るのボタン（画面の左上）とホームへのボタンだけ、ひとつ前の画面に戻る。
    // ホームの「記録の一覧」などは、前に開いた画面に関係なく、その画面を開く
    if ('backBtn' in el.dataset || el.dataset.view === 'home') history.back();
    else go(el.dataset.view);
  } else if (action === 'open-start') openEntry(el.dataset.date, 'start');
  else if (action === 'open-end') openEntry(el.dataset.date, 'end');
  else if (action === 'open-day') openEntry(el.dataset.date, 'day', el.dataset.back || 'home');
  else if (action === 'new-accident') openAccident(null);
  else if (action === 'open-accident') openAccident(el.dataset.id);
  else if (action === 'save-accident') runBusy(saveAccident);
  else if (action === 'save-oil') runBusy(saveOil);
  else if (action === 'add-advance') {
    const date = document.getElementById('adv-date').value;
    const amount = num(document.getElementById('adv-amount').value);
    const { y, m } = state.salesMonth;
    if (!date.startsWith(`${y}-${pad2(m)}-`)) { toast(`${m}月の日付を入れてください`); return; }
    if (!amount || amount <= 0) { toast('前払いの金額を入れてください'); return; }
    const s = state.settings;
    const key = advanceKey(y, m);
    const hist = { ...(s.advanceHistory || {}) };
    hist[key] = [...(hist[key] || []), { id: `adv-${Date.now().toString(36)}`, date, amount }];
    s.advanceHistory = hist;
    await db.putSettings(s);
    toast(`前払い ${yen(amount)} を記録しました`);
    const sy = window.scrollY;
    renderSales();
    window.scrollTo(0, sy);
  } else if (action === 'delete-advance') {
    const s = state.settings;
    const key = advanceKey(state.salesMonth.y, state.salesMonth.m);
    if (el.dataset.id === 'prior') {
      if (!(await ask(`このアプリを使う前に受けた前払い ${yen(s.priorAdvance)} を消します。`, '消す', true))) return;
      s.priorAdvance = '';
      await db.putSettings(s);
      const sy = window.scrollY;
      renderSales();
      window.scrollTo(0, sy);
      return;
    }
    const item = (s.advanceHistory?.[key] || []).find((a) => a.id === el.dataset.id);
    if (!item || !(await ask(`${Number(item.date.slice(5, 7))}/${Number(item.date.slice(8))} の前払い ${yen(item.amount)} の記録を消します。`, '消す', true))) return;
    s.advanceHistory = { ...s.advanceHistory, [key]: s.advanceHistory[key].filter((a) => a.id !== item.id) };
    await db.putSettings(s);
    const sy = window.scrollY;
    renderSales();
    window.scrollTo(0, sy);
  }
  else if (action === 'prior-none') {
    // 今月すでに受けた前払い：「なし」（もう一度押すと取り消し）
    const s = state.settings;
    const on = s.priorAdvanceNone !== thisMonthKey();
    s.priorAdvanceNone = on ? thisMonthKey() : '';
    if (on) s.priorAdvance = '';
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  } else if (['add-job', 'del-job', 'job-kind', 'job-pay', 'job-shift'].includes(action)) {
    const jobs = editableJobs();
    const i = Number(el.dataset.i);
    if (action === 'add-job') jobs.push({ id: `job-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: '' });
    else if (action === 'del-job') jobs.splice(i, 1);
    else {
      if (!jobs[i]) jobs[i] = { id: `job-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: '' };
      const j = jobs[i];
      if (!j.id) j.id = `job-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      if (action === 'job-kind') {
        j.kind = el.dataset.value;
        if (j.kind === 'sagawa') { j.office ??= ''; j.shift ??= ''; j.pay ??= ''; }
        else { j.company ??= ''; j.branch ??= ''; j.pay ??= ''; }
      } else if (action === 'job-shift') j.shift = el.dataset.value;
      else j.pay = el.dataset.value;
      if (j.kind === 'corp') j.units = Array.from({ length: UNIT_SLOTS }, (_, k) => j.units?.[k] || { label: '', price: '' });
    }
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  } else if (action === 'toggle-day') {
    // 売上表の一覧：日付を押すと、その日の案件の内訳を開く
    const d = el.dataset.date;
    state.salesOpen = state.salesOpen || new Set();
    state.salesClosed = state.salesClosed || new Set();
    if (el.getAttribute('aria-expanded') === 'true') { state.salesOpen.delete(d); state.salesClosed.add(d); } else { state.salesOpen.add(d); state.salesClosed.delete(d); }
    const y = window.scrollY;
    renderSales();
    window.scrollTo(0, y);
  } else if (action === 'sales-month') {
    const d = new Date(state.salesMonth.y, state.salesMonth.m - 1 + Number(el.dataset.step), 1);
    state.salesMonth = { y: d.getFullYear(), m: d.getMonth() + 1 };
    renderSales();
  } else if (action === 'preview-sales') {
    const out = document.getElementById('preview');
    out.innerHTML = '';
    for (const c of salesCanvases()) {
      const img = new Image();
      img.src = c.toDataURL('image/jpeg', 0.85);
      img.alt = '売上表';
      out.append(img);
    }
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (action === 'share-sales') {
    runBusy(async () => {
      const { y, m } = state.salesMonth;
      const pdf = await canvasesToPdf(salesCanvases());
      await deliver(new File([pdf], `${y}年${m}月_${safeName(state.settings.driverName)}_売上表.pdf`, { type: 'application/pdf' }), 'share');
    });
  }
  else if (action === 'delete-oil') {
    const c = state.settings.oilChanges.find((x) => x.id === el.dataset.id);
    if (!c || !(await ask(`${c.date.replace(/-/g, '/')}（${kmText(c.odo)}）のオイル交換の記録を消します。`, '消す', true))) return;
    state.settings.oilChanges = state.settings.oilChanges.filter((x) => x.id !== c.id);
    state.settings.oilAck = null;
    state.oilElement = null;
    await db.putSettings(state.settings);
    renderOil();
  }
  else if (action === 'add-photo') photoInput.click();
  else if (action === 'view-photo') viewPhoto(el.dataset.id);
  else if (action === 'delete-photo') {
    if (!(await ask('この写真を消します。', '消す', true))) return;
    await db.deletePhoto(el.dataset.id);
    setAccPhotos(state.accPhotos.filter((p) => p.id !== el.dataset.id));
    rerenderAccident();
  }
  else if (action === 'plan-from-nippo') {
    state.acc.plan = planFromRecord(findRecord(state.acc.date), state.settings.via);
    rerenderAccident('acc-plan');
  }
  else if (action === 'share-accident') {
    runBusy(async () => {
      const a = state.acc;
      deliver(new File([await canvasesToPdf(await accidentCanvases(a))], `${accFileName(a)}.pdf`, { type: 'application/pdf' }), 'share');
    });
  } else if (action === 'delete-accident') {
    if (!(await ask(`${accidentWhen(state.acc)} の事故の記録を消します。事故の記録は3年間の保存が決まりです。本当に消しますか？`, '消す', true))) return;
    await db.deleteAccident(state.acc.id);
    await db.deletePhotos(state.accPhotos.map((p) => p.id));
    setAccPhotos([]);
    await reload();
    toast('事故の記録を消しました');
    history.back();
  }
  else if (action === 'add-part') {
    const s = state.settings;
    if (el.dataset.part === 'start') state.draft.start = newStart(s, prevOdo(state.records, state.draft.date, s), '');
    else state.draft.end = newEnd(s, '');
    renderEntry();
  } else if (action === 'save-entry') runBusy(saveEntry);
  else if (action === 'delete-day') {
    if (!(await ask(`${label(state.draft.date)} の記録を消します。消した記録は元に戻せません。`, '消す', true))) return;
    await db.deleteRecord(state.draft.date);
    await reload();
    toast('記録を消しました');
    history.back();
  } else if (action === 'save-settings') {
    const s = state.settings;
    const miss = settingsMissing(s);
    if (miss.length) { toast(`まだ入っていない項目があります：${miss[0]}`); updateSaveState(); return; }
    s.restMin = num(s.restMin) ?? DEFAULT_SETTINGS.restMin;
    // 点呼は自分で行う：点呼実施者名は運転者名、点呼方法は「自身」
    s.rollcaller = String(s.driverName).trim();
    if (!s.appStartMonth) s.appStartMonth = thisMonthKey(); // アプリを使い始めた月
    s.method = '自身';
    // 屋号（事業者名）が空なら、氏名にする
    if (!String(s.company || '').trim()) s.company = String(s.driverName).trim();
    s.initialOdo = num(s.initialOdo);
    await db.putSettings(s);
    toast('保存しました');
    if (state.view === 'setup') { await requestPersist(); go('home', { push: false }); } else history.back();
  } else if (action === 'month') {
    const d = new Date(state.month.y, state.month.m - 1 + Number(el.dataset.step), 1);
    state.month = { y: d.getFullYear(), m: d.getMonth() + 1 };
    renderList();
  } else if (action === 'export') {
    runBusy(async () => deliver(await makeExport(), el.dataset.how));
  } else if (action === 'preview') runBusy(showPreview);
  else if (action === 'backup') runBusy(backup);
  else if (action === 'restore') document.getElementById('import-input').click();
  else if (action === 'invite-check') {
    const v = await verifyInvite(document.getElementById('invite-input').value);
    if (!v) { toast('招待コードが正しくありません。届いたリンクやコードを、そのまま全部貼り付けてください', 6000); return; }
    state.settings.invite = v.code;
    await db.putSettings(state.settings);
    state.invite = await useInvite(await inviteStatus(v.code));
    if (state.invite === 'ok') toast(`${v.name}さんの招待を確認しました`);
    go(state.settings.driverName ? 'home' : 'setup', { push: false });
  } else if (action === 'invite-copy') {
    try { await navigator.clipboard.writeText(state.settings.invite); toast('招待コードをコピーしました'); }
    catch { toast(`招待コード：${state.settings.invite}`, 20000); }
  }
  else if (action === 'dismiss-install') {
    state.settings.installHintDismissed = true;
    await db.putSettings(state.settings);
    renderHome();
  }
});

app.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.bind) {
    setPath(state.draft, t.dataset.bind, t.value);
    // メーターを入れたら走った距離を、走った距離を入れたらメーターを計算する
    if (t.dataset.bind === 'end.odo' || t.dataset.bind === 'start.odo') {
      const out = app.querySelector('[data-dist]');
      if (out) out.value = distanceOf(state.draft) ?? '';
    }
  } else if (t.dataset.acc) {
    setPath(state.acc, t.dataset.acc, t.value);
    // 死傷者の人数で「国への報告」の注意を出し入れする
    if (t.dataset.acc.startsWith('annex.')) {
      const has = !!app.querySelector('.warn.block');
      if (has !== needsReport(state.acc)) rerenderAccident(t.id);
    }
  } else if ('dist' in t.dataset) {
    const a = num(state.draft.start?.odo);
    const dist = num(t.value);
    const odo = a != null && dist != null ? a + dist : '';
    state.draft.end.odo = odo;
    const out = app.querySelector('[data-bind="end.odo"]');
    if (out) out.value = odo;
  } else if (t.dataset.jobI) {
    // 設定：案件の入力（営業所・会社名・単価など）
    const jobs = editableJobs();
    const i = Number(t.dataset.jobI);
    if (!jobs[i]) jobs[i] = { id: `job-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: '' };
    if (!jobs[i].id) jobs[i].id = `job-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    setPath(jobs[i], t.dataset.jobK, t.value);
    // 働き始めた日を変えたら、新人保証の期間を描き直す（営業所名は、入れ終わったとき（change）に描き直す）
    if (t.dataset.jobK === 'startDate') {
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
    }
  } else if (t.dataset.jobamt || t.dataset.jobcnt) {
    // 乗務後点呼：その日の案件の金額・個数
    if (t.dataset.jobamt) {
      const j = state.draft.jobs[Number(t.dataset.jobamt)];
      j.amount = num(t.value);
      t.classList.toggle('need', j.amount == null);
    } else {
      const j = state.draft.jobs[Number(t.dataset.jobcnt)];
      const k = t.dataset.k;
      if (/^\d+$/.test(k)) { j.counts = Array.isArray(j.counts) ? j.counts : []; j.counts[Number(k)] = num(t.value); }
      else { j.counts = { ...(j.counts || {}), [k]: num(t.value) }; }
    }
    const out = app.querySelector('#daytotal');
    if (out) out.textContent = yen(draftDayTotal());
  } else if (t.dataset.jobmemo) {
    state.draft.jobs[Number(t.dataset.jobmemo)].memo = t.value;
  } else if (t.dataset.setting) {
    state.settings[t.dataset.setting] = t.value;
    // 点呼実施者名の欄は、運転者名と同じものを見せる
    if (t.dataset.setting === 'driverName') {
      const rv = app.querySelector('#rollcaller-view');
      if (rv) rv.value = t.value;
    }
    // 以前に受けた前払いは、入力した月の分として数える
    if (t.dataset.setting === 'priorAdvance') { state.settings.priorAdvanceMonth = thisMonthKey(); state.settings.priorAdvanceNone = ''; }
    // 営業所・稼働を開始した日を変えたら、単価・新人保証の表示を描き直す
    if (t.dataset.setting === 'salesOffice' || t.dataset.setting === 'salesStartDate') {
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
    }
  }
  updateSaveState();
  updateEntryState();
});

// 今月すでに受けた前払い：「なし」を選んだあとでも、金額の欄を押せばそのまま金額を入れられる
app.addEventListener('focusin', (ev) => {
  const t = ev.target;
  if (t.dataset?.setting !== 'priorAdvance' || state.settings.priorAdvanceNone !== thisMonthKey()) return;
  state.settings.priorAdvanceNone = '';
  t.classList.remove('is-none');
  const chip = app.querySelector('[data-action="prior-none"]');
  if (chip) chip.setAttribute('aria-pressed', 'false');
  updateSaveState();
});

app.addEventListener('change', async (ev) => {
  const t = ev.target;
  if (t.dataset.advance) {
    // 希望する前払い額（月ごと）
    const s = state.settings;
    s.advance = { ...(s.advance || {}), [t.dataset.advance]: t.value === '' ? '' : Number(t.value) };
    await db.putSettings(s);
    const y = window.scrollY;
    renderSales();
    window.scrollTo(0, y);
    toast('希望する前払い額を保存しました');
    return;
  }
  if (t.dataset.salesDate) {
    // 売上表の一覧で入れた個数を、その日の記録の案件に保存する（以前の版の記録は、その日の案件に読み替えてから）
    const rec = findRecord(t.dataset.salesDate);
    if (!rec) return;
    if (!Array.isArray(rec.jobs)) rec.jobs = dayJobs(rec, state.settings).filter((x) => x.job).map(toDayEntry);
    const j = rec.jobs.find((x) => x.id === t.dataset.salesJob);
    if (!j) return;
    const k = t.dataset.salesKey;
    if (/^\d+$/.test(k)) { j.counts = Array.isArray(j.counts) ? j.counts : []; j.counts[Number(k)] = num(t.value); }
    else j.counts = { ...(j.counts || {}), [k]: num(t.value) };
    await db.putRecord(rec);
    await reload();
    const y = window.scrollY;
    renderSales();
    window.scrollTo(0, y);
    return;
  }
  if (t.dataset.jobK === 'office') {
    // 営業所名を入れ終わったら、新人保証の欄を出し入れする（変わらなければ描き直さない。押したボタンが消えないように）
    const j = jobList(state.settings)[Number(t.dataset.jobI)];
    const shown = !!app.querySelector(`[data-job-i="${t.dataset.jobI}"][data-job-k="newbiePerDay"]`);
    if (!j || !!newbieRule(j) === shown) return;
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    return;
  }
  if (t.dataset.expSelect) {
    state.exp[t.dataset.expSelect] = Number(t.value);
    renderExport();
  }
});

document.getElementById('import-input').addEventListener('change', (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (file) runBusy(() => restore(file));
});

// ---- アップデートの確認と通知（確サポと同じ仕組み） ----

function setupUpdates() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  if (location.hostname === 'localhost' && location.search.includes('nosw')) return; // 開発中は使わない
  // 初めて開いたとき（まだ何も保存されていないとき）は通知しない
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) document.getElementById('update-banner').hidden = false;
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const check = () => reg.update().catch(() => {});
    // ホーム画面のアプリは閉じずに再開されることが多いので、画面に戻ってきたときにも確認する
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 30 * 60 * 1000);
  }).catch(() => {});
  document.getElementById('update-banner').addEventListener('click', async (ev) => {
    if (!ev.target.closest('[data-action="apply-update"]')) return;
    const editing = state.view === 'entry' || state.view === 'accident';
    if (editing && !(await ask('入力中の内容は消えます。更新しますか？（先に保存してから更新するのがおすすめです）', '更新する'))) return;
    location.reload();
  });
}

// 日付が変わったとき・アプリに戻ってきたときに、ホームの「今日」を新しくする
document.addEventListener('visibilitychange', () => {
  // 別のアプリから戻ってきたら、オイル交換のバーをもう一度動かす
  if (document.hidden) { oilBarGrow = true; return; }
  if (state.view === 'home') renderHome();
});

// 写真を撮る・選ぶ（スマホでは「写真を撮る」「写真ライブラリ」を選べる）
const photoInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true, hidden: true });
document.body.append(photoInput);
photoInput.addEventListener('change', () => {
  const files = [...photoInput.files];
  photoInput.value = '';
  if (files.length) runBusy(() => addPhotos(files));
});

async function start() {
  state.settings = await db.getSettings();
  await reload();
  if (state.settings.driverName && !state.settings.appStartMonth) {
    state.settings.appStartMonth = state.records[0]?.date.slice(0, 7) || thisMonthKey();
    await db.putSettings(state.settings);
  }
  cleanupPhotos();
  state.invite = await checkInvite();
  state.view = state.settings.driverName ? 'home' : 'setup';
  if (state.inviteNew && state.invite === 'ok') {
    if (state.settings.driverName) toast(`${state.inviteName}さんの招待を確認しました`);
    else state.view = 'invited';
  }
  history.replaceState({ view: 'home' }, '');
  render();
  setupUpdates();
  // 新しい版で初めて開いたときに知らせる（開き直すとその時点で最新版になるため、更新のお知らせが出ないことがある）
  const s = state.settings;
  if (s.lastVersion !== APP_VERSION) {
    if (s.lastVersion && s.driverName) toast(`v${APP_VERSION} にアップデートしました`);
    s.lastVersion = APP_VERSION;
    db.putSettings(s).catch(() => {});
  }
  if (state.view === 'home' && state.invite === 'ok') setTimeout(runAlerts, 600);
}

start();
