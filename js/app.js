// 日報サポート：運転日報と点呼記録簿をスマホで簡単に記録するアプリ
// 画面：はじめての設定 → ホーム（乗務前・乗務後のボタン）→ 一覧 → 書き出し・共有

import { db, requestPersist } from './db.js';
import {
  DEFAULT_SETTINGS, METHODS, newStart, newEnd, todayKey, nowTime, isTime, num, distanceOf, prevOdo,
  monthSheets, yearSheets, hasMonth, toCsv, daysInMonth, dateKey, weekday, pad2
} from './model.js';
import { buildXlsx } from './xlsx.js';
import { specsToPdf, renderSheet } from './pdf.js';

export const APP_VERSION = '0.1.3';

const app = document.getElementById('app');
const state = {
  view: 'home',
  settings: { ...DEFAULT_SETTINGS },
  records: [],
  draft: null,        // 入力中の1日分 { date, start, end, rollcaller }
  mode: null,         // 'start' | 'end' | 'day'
  back: 'home',
  month: null,        // 一覧で表示している月 { y, m }
  exp: { period: 'month', y: 0, m: 0, format: 'xlsx' },
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
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// 確認の画面（ブラウザの confirm は使えない環境があるので、画面の中に出す）
function ask(message, okLabel, danger = false) {
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'dialog';
    box.innerHTML = `<div class="dialog-box" role="alertdialog" aria-modal="true">
      <p>${e(message)}</p>
      <div class="btn-row two">
        <button type="button" class="btn-outline" data-answer="no">やめる</button>
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
  const v = getPath(state.draft, path);
  return `<input data-bind="${e(path)}" value="${e(v)}" ${attrs}>`;
}

const head = (title, back = 'home') =>
  `<div class="form-head"><button type="button" class="icon-btn plain" data-action="go" data-view="${back}" aria-label="戻る">${ICON.back}</button><h1>${title}</h1></div>`;

// ---- 画面：はじめての設定・設定 ----

function settingsForm(s) {
  const f = (key, text, attrs = '', note = '') =>
    field(text, `<input data-setting="${key}" value="${e(s[key] ?? '')}" ${attrs}>`, note);
  return `
    <div class="card fields">
      ${f('driverName', '運転者名 <b class="req">必須</b>', 'autocomplete="name" placeholder="例：伊藤 孝"')}
      ${f('office', '営業所', 'placeholder="例：八王子"')}
      ${f('vehicleNo', '車両番号', 'placeholder="例：多摩 480 あ 12-34"')}
      ${f('company', '事業者名')}
    </div>
    <h2 class="section-title">毎日ほぼ同じ内容（入力の初期値になります）</h2>
    <div class="card fields">
      ${f('startPlace', '乗務開始・終了地点', 'placeholder="例：八王子営業所"')}
      ${f('via', '主な経過地点（集荷・納品先など）', 'placeholder="例：中沢1,2、唐木田1"')}
      ${f('restPlace', '休憩地点', 'placeholder="例：唐木田1-21-1"')}
      ${f('restMin', '休憩時間（分）', 'type="number" inputmode="numeric" min="0"')}
      ${f('rollcaller', '点呼実施者名', 'placeholder="例：神野"', '点呼をしてくれる人（運行管理者）の名前')}
      <div class="field"><span class="field-label">点呼方法</span>${METHODS.map((m) => `<button type="button" class="chip" data-setting-seg="method" data-value="${m}" aria-pressed="${s.method === m}">${m}</button>`).join('')}</div>
      ${f('initialOdo', '今のメーターの距離（km）', 'type="number" inputmode="numeric" min="0" placeholder="例：56009"', '最初の日の「開始時走行距離」になります。あとは前の日の終了距離が自動で入ります')}
    </div>`;
}

function renderSetup() {
  app.innerHTML = `
    <main class="screen form">
      <div class="hero">
        <div class="brand">${LOGO(56)}${WORDMARK}</div>
        <p class="lead">運転日報と点呼記録簿を、スマホで簡単に。</p>
        <p class="muted">はじめに、毎日同じになる内容を登録します。あとから設定でいつでも変えられます。</p>
      </div>
      ${settingsForm(state.settings)}
      <p class="info">記録はこのスマホの中だけに保存されます。事務所へは、月末などに「書き出し・共有」から Excel・PDF・CSV を送ります。</p>
      <button type="button" class="btn-primary" data-action="save-settings" data-next="home">はじめる</button>
    </main>`;
}

function renderSettings() {
  app.innerHTML = `
    <main class="screen form">
      ${head('設定')}
      ${settingsForm(state.settings)}
      <button type="button" class="btn-primary" data-action="save-settings" data-next="home">保存する</button>
      <h2 class="section-title">バックアップ（スマホを替えるとき）</h2>
      <div class="card pad">
        <p class="small">記録はこのスマホの中だけにあります。スマホを替える・アプリを消す前に、バックアップを作って保存してください。</p>
        <button type="button" class="btn-outline" data-action="backup">バックアップを作る</button>
        <button type="button" class="btn-outline" data-action="restore">バックアップから戻す</button>
      </div>
      <button type="button" class="btn-outline" data-action="go" data-view="rules">記録の決まり（保存期間など）</button>
      <p class="info center">日報サポート v${APP_VERSION}</p>
    </main>`;
}

// ---- 画面：ホーム ----

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
    main = `<div class="done-msg">${ICON.check} 今日の記録は完了です。おつかれさまでした。</div>
      <button type="button" class="btn-outline" data-action="open-day" data-date="${today}">今日の記録を見る・直す</button>`;
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
      <section class="card month-sum">
        <div><span class="muted">${m}月の出勤</span><b>${workDays}<small>日</small></b></div>
        <div><span class="muted">${m}月の走行</span><b>${km.toLocaleString('ja-JP')}<small>km</small></b></div>
      </section>
      <div class="btn-row two">
        <button type="button" class="btn-outline" data-action="go" data-view="list">記録の一覧</button>
        <button type="button" class="btn-outline" data-action="go" data-view="export">書き出し・共有</button>
      </div>
      <button type="button" class="link-btn" data-action="go" data-view="rules">記録の決まり（保存期間・点呼で確かめること）</button>
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
      ${field('出発時のメーター（km）', input('start.odo', 'type="number" inputmode="numeric" min="0"'), '前の日の終了距離が入っています')}
      <details class="more" ${full ? 'open' : ''}>
        <summary>そのほかの項目（ふだんは変更不要）</summary>
        ${segField('点呼方法', 'start.method', METHODS)}
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
        ${segField('点呼方法', 'end.method', METHODS)}
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
      + `<section class="card fields">${field('点呼実施者名', input('rollcaller'))}</section>`;
  }
  const exists = !!findRecord(d.date);
  app.innerHTML = `
    <main class="screen form">
      ${head(title, state.back)}
      ${mode !== 'day' ? `<p class="muted">${label(d.date)}　${e(state.settings.driverName)}</p>` : ''}
      ${body}
      <button type="button" class="btn-primary" data-action="save-entry">この内容で記録する</button>
      ${mode === 'day' && exists ? '<button type="button" class="btn-text danger" data-action="delete-day">この日の記録を消す</button>' : ''}
    </main>`;
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
    if (r) { work++; km += dist || 0; }
    const sub = r
      ? `${e(hm(r.start?.time) || '--:--')} → ${e(hm(r.end?.time) || '--:--')}${r.start && !r.end ? '<span class="tag">乗務後まだ</span>' : ''}`
      : '<span class="off">記録なし（休み）</span>';
    rows.push(`
      <button type="button" class="row ${r ? '' : 'is-off'}" data-action="open-day" data-date="${key}" data-back="list">
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
      <p class="info">日付をタップすると、記録を直したり、入れ忘れた日を追加したりできます。</p>
    </main>`;
}

// ---- 画面：書き出し・共有 ----

function renderExport() {
  const x = state.exp;
  const years = new Set([new Date().getFullYear(), ...state.records.map((r) => Number(r.date.slice(0, 4)))]);
  const yearOpts = [...years].sort((a, b) => b - a).map((y) => `<option value="${y}" ${y === x.y ? 'selected' : ''}>${y}年</option>`).join('');
  const monthOpts = Array.from({ length: 12 }, (_, i) => i + 1).map((m) => `<option value="${m}" ${m === x.m ? 'selected' : ''}>${m}月</option>`).join('');
  const notes = {
    xlsx: '事務所の年間ブックと同じ形（運転日報・点呼記録簿のシート）です。「1年分」にすると1月〜12月の24シートになります。',
    pdf: 'A4横で、運転日報と点呼記録簿を1か月1枚ずつにします。印刷やそのまま提出するときに。',
    csv: '記録のある日を1日1行にした表です。ほかのソフトに取り込むときに。'
  };
  const canShare = !!navigator.canShare;
  app.innerHTML = `
    <main class="screen form">
      ${head('書き出し・共有')}
      <section class="card fields">
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
      <button type="button" class="btn-text" data-action="preview">画面で確認する</button>
      <p class="info">${canShare ? '事務所に送るときは「共有する」を押して、LINEやメールを選んでください。' : '保存したファイルを、LINEやメールに添付して事務所に送ってください。'}</p>
      <p class="info">運転日報・点呼記録簿は<b>1年間</b>の保存が決まりです。毎月送って、事務所で保管してください。<button type="button" class="link-btn inline" data-action="go" data-view="rules">記録の決まり</button></p>
      <div id="preview" class="preview"></div>
    </main>`;
}

// ---- 画面：記録の決まり ----

function renderRules() {
  app.innerHTML = `
    <main class="screen">
      ${head('記録の決まり')}
      <p class="small">軽貨物（貨物軽自動車運送事業）の運転日報と点呼記録簿には、国の決まり（貨物自動車運送事業輸送安全規則）があります。</p>

      <h2 class="section-title">保存しておく期間</h2>
      <div class="card list rules">
        <div class="rule"><span class="rule-name">点呼記録簿</span><span class="rule-term">1年間</span></div>
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
          <li>記録はこのスマホの中だけにあります。<b>毎月「書き出し・共有」で事務所に送ってください。</b></li>
          <li>事務所は、受け取った Excel・PDF を<b>1年間</b>保管します。</li>
          <li>アプリの記録は、自分で消さないかぎり残ります。1年たっていない記録は消さないでください。</li>
          <li>スマホを替える・アプリを消す前に、設定から<b>バックアップ</b>を作ってください。</li>
        </ul>
      </div>

      <h2 class="section-title">事故が起きたら</h2>
      <div class="card pad">
        <p class="small">すぐに事務所（運行管理者）に連絡してください。事故の記録（概要・原因・再発防止策）は3年間保存します。けが人が出た事故など一定の事故は、国への報告が必要です（事務所が行います）。</p>
      </div>

      <p class="info">決まりは法令の改正で変わることがあります。くわしくは事務所か運輸支局に確かめてください。<br>
        出典：<a href="https://www.mlit.go.jp/report/press/jidosha02_hh_000665.html" target="_blank" rel="noopener">国土交通省「貨物軽自動車運送事業者に対する規制の適正化」</a></p>
    </main>`;
}

// ---- 描画 ----

function render() {
  if (state.view !== 'setup' && !state.settings.driverName) state.view = 'setup';
  const views = { rules: renderRules, setup: renderSetup, settings: renderSettings, home: renderHome, entry: renderEntry, list: renderList, export: renderExport };
  (views[state.view] || renderHome)();
}

function go(view, { push = true } = {}) {
  state.view = view;
  if (view === 'list' && !state.month) {
    const n = new Date();
    state.month = { y: n.getFullYear(), m: n.getMonth() + 1 };
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

window.addEventListener('popstate', () => {
  if (state.view === 'entry' && state.back === 'list') go('list', { push: false });
  else if (state.view !== 'home' && state.view !== 'setup') go('home', { push: false });
});

// ---- 入力の開始 ----

function openEntry(date, mode, back = 'home') {
  const s = state.settings;
  const rec = findRecord(date);
  const draft = structuredClone(rec || { date, start: null, end: null, rollcaller: s.rollcaller });
  if (mode === 'start' && !draft.start) draft.start = newStart(s, prevOdo(state.records, date, s), date === todayKey() ? nowTime() : '');
  if (mode === 'end' && !draft.end) {
    draft.end = newEnd(s, date === todayKey() ? nowTime() : '');
    if (!draft.start) draft.start = newStart(s, prevOdo(state.records, date, s), '');
  }
  if (mode === 'day' && !rec) {
    draft.start = newStart(s, prevOdo(state.records, date, s), '');
    draft.end = newEnd(s, '');
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
  if (!d.rollcaller) d.rollcaller = state.settings.rollcaller;
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
}

async function reload() {
  state.records = (await db.allRecords()).sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ---- 書き出し ----

const safeName = (s) => String(s || '').replace(/[\s　]/g, '').replace(/[\\/:*?"<>|]/g, '');

function checkPeriod() {
  const { period, y, m } = state.exp;
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
  const data = { app: 'nippo-sapo', version: 1, exportedAt: new Date().toISOString(), settings: state.settings, records: state.records };
  const d = new Date();
  const file = new File([JSON.stringify(data)], `日報サポート_バックアップ_${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}.json`, { type: 'application/json' });
  await deliver(file, 'share');
}

async function restore(file) {
  const data = JSON.parse(await file.text());
  if (data?.app !== 'nippo-sapo' || !Array.isArray(data.records)) throw new Error('日報サポートのバックアップではありません');
  if (!(await ask(`${data.records.length}日分の記録を戻します。同じ日の記録は、バックアップの内容に置きかわります。`, '戻す'))) return;
  await db.putRecords(data.records.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r?.date)));
  if (data.settings) await db.putSettings({ ...DEFAULT_SETTINGS, ...data.settings });
  state.settings = await db.getSettings();
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
  const setSeg = ev.target.closest('[data-setting-seg]');
  if (setSeg) {
    state.settings[setSeg.dataset.settingSeg] = setSeg.dataset.value;
    setSeg.parentElement.querySelectorAll('[data-setting-seg]').forEach((b) => b.setAttribute('aria-pressed', b === setSeg));
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
    if (el.dataset.view === 'home' || el.dataset.view === state.back) history.back();
    else go(el.dataset.view);
  } else if (action === 'open-start') openEntry(el.dataset.date, 'start');
  else if (action === 'open-end') openEntry(el.dataset.date, 'end');
  else if (action === 'open-day') openEntry(el.dataset.date, 'day', el.dataset.back || 'home');
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
    if (!String(s.driverName).trim()) { toast('運転者名を入れてください'); return; }
    s.restMin = num(s.restMin) ?? 60;
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
  } else if ('dist' in t.dataset) {
    const a = num(state.draft.start?.odo);
    const dist = num(t.value);
    const odo = a != null && dist != null ? a + dist : '';
    state.draft.end.odo = odo;
    const out = app.querySelector('[data-bind="end.odo"]');
    if (out) out.value = odo;
  } else if (t.dataset.setting) {
    state.settings[t.dataset.setting] = t.value;
  }
});

app.addEventListener('change', (ev) => {
  const t = ev.target;
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

// ---- 更新のお知らせ（確サポと同じ仕組み） ----

function setupServiceWorker() {
  if (!('serviceWorker' in navigator) || location.hostname === 'localhost' && location.search.includes('nosw')) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const show = () => { document.getElementById('update-banner').hidden = false; };
    if (reg.waiting && navigator.serviceWorker.controller) show();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) show();
      });
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
  document.getElementById('update-banner').addEventListener('click', async (ev) => {
    if (!ev.target.closest('[data-action="apply-update"]')) return;
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg?.waiting) reg.waiting.postMessage('skipWaiting');
    else location.reload();
  });
}

// 日付が変わったとき・アプリに戻ってきたときに、ホームの「今日」を新しくする
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.view === 'home') renderHome();
});

async function start() {
  state.settings = await db.getSettings();
  await reload();
  state.view = state.settings.driverName ? 'home' : 'setup';
  history.replaceState({ view: 'home' }, '');
  render();
  setupServiceWorker();
}

start();
