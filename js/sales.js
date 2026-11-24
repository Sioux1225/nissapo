// 売上表（月報・前払い用）
// 佐川急便：その日の配達個数（宅配・商業・集荷）× 単価。法人：日極か、品目ごとの個数 × 単価。案件はいくつでも登録し、その日に選んだ案件の金額の合計。
// 前払いは月初めからの売上で計算するため、合計はその月の分だけ（前月の分は含めない）。

import { num, daysInMonth, dateKey, weekday, distanceOf, isOff, isOffDay, todayKey } from './model.js';

export const COUNT_KEYS = [['takuhai', '宅配'], ['shogyo', '商業'], ['shuka', '集荷']];

// 佐川急便の案件：営業所名は各自が入れ、種別（通常・代走・モーニング・ナイト・DRF）と支払い（単価・日極）を選ぶ（2026/10/28〜）
// 単価・日極・上乗せ・新人保証の金額は、ほかの営業所の方に見えないよう、ここには持たず、各自が設定で入れる
//   単価：宅配・商業・集荷の個数 × 単価。代走・DRF は、1日の上乗せ（保障など）を入れれば乗務した日ごとに足す
//   日極：金額は1日の金額だけ（個数も必ず入れるが、記録用で金額は変わらない）
export const SHIFTS = ['代走', 'モーニング', 'ナイト', 'DRF'];
const EXTRA_SHIFTS = ['代走', 'DRF'];
export const hasExtra = (shift) => EXTRA_SHIFTS.includes(shift);

// 以前の版（営業所を一覧から選んでいたころ）の、日極の営業所。読み替えに使う
const LEGACY_FIXED = ['江東（ナイト）', '世田谷（ナイト）', '墨田（ナイト）', '城北（ナイト）', '三多摩（モーニング）', '足立（ナイト）',
  '八王子（ナイト・日極）', '八王子（モーニング）', '川崎（ナイト4h）', '川崎（ナイト3h）', '所沢（ナイト）', '座間（ナイト）', '杉並（ナイト）', '中野（ナイト）'];
const OTHER_OFFICE = 'その他'; // 以前の版の「一覧にない営業所」

// 営業所名の空白と、最後の「営業所」を取る（「八王子営業所」も「八王子」も同じ営業所）
const cleanOffice = (name) => String(name || '').replace(/\s|　/g, '').replace(/営業所$/, '');

// 佐川急便の案件を { office, shift, pay } の形にする。以前の版の「江東（ナイト）」のような営業所名も読み替える
export function sagawaJob(job) {
  if ('pay' in job || 'shift' in job) return { ...job, shift: job.shift || '', pay: job.pay || '' };
  const out = { ...job, shift: '', pay: '' };
  delete out.officeName;
  if (job.office === OTHER_OFFICE) return { ...out, office: job.officeName || '', pay: job.officeName ? 'unit' : '' };
  let n = cleanOffice(job.office);
  if (!n) return { ...out, office: '' };
  if (/^三多摩[BＢ]$/.test(n)) n = '三多摩';
  if (n === '戸田') n = '戸田（代走）'; // 戸田は代走のみ
  const m = n.match(/^([^（]+)（(.+)）$/);
  let office = m ? m[1] : n;
  let shift = '';
  const rest = [];
  for (const part of m ? m[2].split('・') : []) {
    const sh = SHIFTS.find((x) => part.startsWith(x));
    if (sh && !shift) { shift = sh; if (part.length > sh.length) rest.push(part.slice(sh.length)); } else if (part !== '単価' && part !== '日極') rest.push(part);
  }
  if (rest.length) office += `（${rest.join('・')}）`;
  return { ...out, office, shift, pay: LEGACY_FIXED.includes(n) ? 'daily' : 'unit' };
}

// 設定（以前の形の salesOffice など）から、佐川急便の案件の形にする
const specOf = (settings) => sagawaJob({
  office: settings.salesOffice, officeName: settings.salesOfficeName,
  ...(settings.salesPay !== undefined || settings.salesShift !== undefined ? { shift: settings.salesShift, pay: settings.salesPay } : {})
});

// 保証（新人保証・年末保証。新規稼働の方で、営業所から案内があった場合だけ各自が入れる。いくつでも）
//   job.guards：[{ name: '新人保証' | '年末保証', type: 'daily' | 'extra', from, to, amount }]
//   daily（日極保証）：期間中は個数に関係なく1日の金額。extra（一部保証）：いつもの金額に1日の金額を足す
//   期間が重なる日は年末保証だけ（年末保証がなければ、先に登録したもの）。個数は期間中も必ず入れる
export const GUARD_DEFAULT_NAME = '新人保証'; // 保証を追加したときに、はじめに選ばれている名前
export const GUARD_NAMES = ['新人保証', '年末保証']; // 保証の名前（設定のプルダウン）
const guardName = (g) => String(g?.name || '').trim() || GUARD_DEFAULT_NAME;
function validGuard(g) {
  const amount = num(g?.amount);
  if (!g || (g.type !== 'daily' && g.type !== 'extra') || !isDate(g.from) || !isDate(g.to) || g.from > g.to || amount == null) return null;
  return { name: guardName(g), type: g.type, from: g.from, to: g.to, amount };
}
// 入力が足りている保証だけ
export const guardsOf = (job) => (job?.kind === 'sagawa' && Array.isArray(job.guards) ? job.guards.map(validGuard).filter(Boolean) : []);
// その日の保証（なければ null）
export function guardOn(job, date) {
  const on = guardsOf(job).filter((g) => date >= g.from && date <= g.to);
  return on.find((g) => g.name === '年末保証') || on[0] || null;
}
// 保証の書き方（「年末保証：日極18,000円（11/1〜12/31）」）
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
export const guardText = (g) => `${g.name}：${g.type === 'daily' ? `日極${yen(g.amount)}` : `1日+${yen(g.amount)}`}（${md(g.from)}〜${md(g.to)}）`;

// 佐川急便の日極の案件：金額は1日の金額だけ（個数は記録用）
export const isFixedSagawa = (job) => job?.kind === 'sagawa' && sagawaJob(job).pay === 'daily';

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const pad = (n) => String(n).padStart(2, '0');

// 以前の版の新人保証（営業所ごとに期間が決まっていて、働き始めた日から自動で数えた）。保証の一覧に読み替えるのに使う
const NEWBIE = { 東京: { months: 1 }, 世田谷: { months: 3 }, 城北: { months: 3 }, 三多摩: { days: 14 }, 練馬: { months: 1 }, 八王子: { months: 1 }, 所沢: { months: 1 }, 赤羽: { months: 3 } };
function legacyNewbie(j, start) {
  const nb = !j.shift && j.pay === 'unit' ? NEWBIE[cleanOffice(j.office)] : null;
  const amount = num(j.newbiePerDay);
  if (!nb || !(amount > 0) || !isDate(start)) return null;
  const [y, m, d] = start.split('-').map(Number);
  let end;
  if (nb.days) end = new Date(y, m - 1, d + nb.days - 1);
  else {
    const last = new Date(y, m - 1 + nb.months + 1, 0).getDate();
    end = new Date(y, m - 1 + nb.months, Math.min(d, last));
    end.setDate(end.getDate() - 1);
  }
  return { name: '新人保証', type: 'extra', from: start, to: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`, amount: String(amount) };
}

// 佐川急便の案件の保証を一覧の形にする（以前の版の新人保証（自動の期間）と、v0.25 の保証1つも読み替える）
function withGuards(j, settings) {
  if (Array.isArray(j.guards)) return j;
  const guards = [];
  const nb = legacyNewbie(j, j.startDate || settings?.salesStartDate);
  if (nb) guards.push(nb);
  if (j.guard === 'daily' || j.guard === 'extra') guards.push({ name: j.guardName || '年末保証', type: j.guard, from: j.guardFrom || '', to: j.guardTo || '', amount: j.guardAmount ?? '' });
  const out = { ...j, guards };
  for (const k of ['newbiePerDay', 'startDate', 'guard', 'guardName', 'guardFrom', 'guardTo', 'guardAmount']) delete out[k];
  return out;
}

// 営業所名に種別を付ける（「江東」と「ナイト」→「江東（ナイト）」、「川崎（4h）」と「ナイト」→「川崎（4h・ナイト）」）
const withShift = (name, shift) => (!shift ? name : /）$/.test(name) ? name.replace(/）$/, `・${shift}）`) : `${name}（${shift}）`);

// 売上表に出す営業所名
export function officeName(settings) {
  const j = specOf(settings);
  return withShift(String(j.office || '').trim(), j.shift);
}

// 単価・日極・1日の上乗せ：どの営業所も、各自が設定で入れたもの
//   daily：その日に個数の金額とは別に足す金額（日極は日極の金額、代走・DRF は上乗せ）
export function unitPrices(settings) {
  const j = specOf(settings);
  return {
    takuhai: num(settings.priceTakuhai),
    shogyo: num(settings.priceShogyo),
    shuka: num(settings.priceShuka),
    daily: j.pay === 'daily' ? num(settings.priceDaily) || 0 : hasExtra(j.shift) ? num(settings.priceExtra) || 0 : 0
  };
}

// 希望する前払い額（月ごと。キーは 'YYYY-MM'）
export const advanceKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
export function advanceOf(settings, y, m) {
  return num((settings.advance || {})[advanceKey(y, m)]);
}

// 受けた前払いの履歴（月ごと。キーは 'YYYY-MM'）[{ id, date, amount }]
// このアプリを使う前に、その月にすでに受けた前払い（設定で入れた分）は prior: true として先頭に入れる
export function priorAdvance(settings, y, m) {
  if (settings.priorAdvanceMonth !== advanceKey(y, m)) return null;
  const amount = num(settings.priorAdvance);
  return amount > 0 ? { id: 'prior', date: `${advanceKey(y, m)}-01`, amount, prior: true } : null;
}
export function advanceHistory(settings, y, m) {
  const list = [...((settings.advanceHistory || {})[advanceKey(y, m)] || [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const prior = priorAdvance(settings, y, m);
  return prior ? [prior, ...list] : list;
}
export function advanceTotal(settings, y, m) {
  return advanceHistory(settings, y, m).reduce((t, a) => t + (num(a.amount) || 0), 0);
}

// ---- 前払いの対象額 ----
// 前払い可能額 ＝（その月の売上 − 留保額）× 50% − その月にすでに受けた前払い
//   はじめての前払いの月（稼働を開始した月だけ）：リース車両を利用している方は10万円、それ以外の方（車両持ち込み）は6万円を留保
//   2回目以降の月：前月の売上が40万円未満なら5万円を留保（前月の記録がないときも念のため）。リース車両も5万円
export const ADVANCE_RATE = 0.5;

// 以前から稼働していた方が設定で選んだ、前月（アプリを使う前）の売上：'over'（40万円以上）・'under'（40万円未満）・null
// 選んだときの前月（prevSalesMonth）の分だけに使う
export function prevSalesLevel(settings, y, m) {
  const pd = new Date(y, m - 2, 1);
  const pk = advanceKey(pd.getFullYear(), pd.getMonth() + 1);
  return settings.prevSalesMonth === pk && ['over', 'under'].includes(settings.prevSalesLevel) ? settings.prevSalesLevel : null;
}

// はじめての前払いの月か（以前から稼働していて前月の売上を選んだ方は、はじめてではない）
// 支払いは2か月サイトなので、稼働を開始した月より後の月は、まだ支払われていない売上があり、はじめての留保はいらない
export function isFirstAdvanceMonth(settings, y, m) {
  if (prevSalesLevel(settings, y, m)) return false;
  const key = advanceKey(y, m);
  if (isDate(settings.salesStartDate) && key > settings.salesStartDate.slice(0, 7)) return false;
  return !Object.entries(settings.advanceHistory || {}).some(([k, list]) => k < key && (list || []).length > 0);
}

// sales：その月の売上、advanced：その月にすでに受けた前払い、prevSales：前月の売上（記録がなければ null）
// prevLevel：前月の記録がないときに、設定で選んだ前月の売上（'over'・'under'）
export function advanceLimit({ sales, advanced = 0, prevSales, prevLevel = null, first, lease }) {
  let reserve = 0;
  let reason = '';
  if (first) {
    reserve = lease ? 100000 : 60000;
    reason = lease ? 'はじめての前払い（リース車両）' : 'はじめての前払い（車両持ち込み）';
  } else if (prevSales == null && prevLevel === 'over') {
    // 留保なし
  } else if (prevSales == null && prevLevel === 'under') {
    reserve = 50000;
    reason = '前月の売上が40万円未満';
  } else if (prevSales == null) {
    reserve = 50000;
    reason = '前月の記録がないため';
  } else if (prevSales < 400000) {
    reserve = 50000;
    reason = '前月の売上が40万円未満';
  }
  // 前払い可能額 ＝（売上 − 留保）× 50% − すでに受けた前払い
  const base = Math.max(0, sales - reserve);
  const half = Math.floor(base * ADVANCE_RATE);
  // 前払い可能額は千円未満を切り捨てる（例：104,230円 → 104,000円）。exact は切り捨てる前の額（計算の式に出す）
  const exact = Math.max(0, half - advanced);
  return { reserve, reason, base, half, exact, target: Math.floor(exact / 1000) * 1000 };
}

// ---- 案件（佐川急便・法人をまとめて登録する） ----
// 佐川急便から法人へ移った方や、朝は法人・午後は佐川急便のように組み合わせる方のため、案件をいくつでも登録し、
// 乗務後点呼でその日の案件を選ぶ。その日の金額は、選んだ案件の金額の合計。
//   佐川急便：営業所名を入れ、種別（通常・代走・モーニング・ナイト・DRF）と支払い（単価・日極）を選ぶ。
//             単価（日極・上乗せ）と保証（新人保証・年末保証の期間・金額）は各自が入れる
//   法人：会社名・営業所名。支払いは「日極」（1日いくら。空なら毎回入力）か「単価」（品目と単価を3つまで）
// settings.jobs：[{ id, kind: 'sagawa', office, shift, pay: 'unit' | 'daily', priceTakuhai, priceShogyo, priceShuka, priceDaily, priceExtra, guards: [{ name, type, from, to, amount }] }
//                 | { id, kind: 'corp', company, branch, pay: 'daily' | 'unit', price, units: [{ label, price }] }]
export const UNIT_SLOTS = 3;

// 以前の版の案件（法人（日極）の { name, price }）を、いまの形に読み替える
function normalizeJob(j, settings) {
  if (j.kind === 'sagawa') return withGuards(sagawaJob(j), settings); // 以前の版の「江東（ナイト）」のような営業所も、営業所名・種別・支払いに分ける
  // 種類（佐川急便・法人）を選ぶ前の新しい案件は、そのまま（以前の版の案件だけ読み替える）
  if (j.kind === 'sagawa' || j.kind === 'corp' || ('kind' in j && !('name' in j))) return j;
  return { id: j.id, kind: 'corp', company: j.name || '', branch: '', pay: 'daily', price: j.price ?? '', units: [] };
}

// 登録した案件の一覧（入力中のものも含む）。以前の版の設定（佐川急便の営業所1つ・法人（日極）の所属1つ）も読み替える
export function jobList(settings) {
  if (Array.isArray(settings.jobs) && settings.jobs.length) return settings.jobs.map((j) => normalizeJob(j, settings));
  if (settings.salesType === 'sagawa' && settings.salesOffice) {
    return [normalizeJob({ id: 'job-sagawa', kind: 'sagawa', office: settings.salesOffice, officeName: settings.salesOfficeName || '', priceTakuhai: settings.priceTakuhai ?? '', priceShogyo: settings.priceShogyo ?? '', priceShuka: settings.priceShuka ?? '', priceDaily: settings.priceDaily ?? '', priceExtra: settings.priceExtra ?? '', newbiePerDay: settings.newbiePerDay ?? '', startDate: settings.salesStartDate || '' }, settings)];
  }
  if (settings.salesProject || num(settings.dailyRate) != null) {
    return [{ id: 'j1', kind: 'corp', company: settings.salesProject || '案件', branch: '', pay: 'daily', price: settings.dailyRate ?? '', units: [] }];
  }
  return [];
}

// 単価の案件の品目（名前と単価が入っているもの）
export const jobUnits = (job) => (job.units || []).map((u, i) => ({ ...u, i })).filter((u) => String(u.label || '').trim() && num(u.price) != null);

// 入力が足りている案件だけ
export function jobReady(job) {
  if (job.kind === 'sagawa') return sagawaMissing(job).length === 0;
  if (!String(job.company || '').trim()) return false;
  if (job.pay === 'unit') return jobUnits(job).length > 0;
  return job.pay === 'daily';
}
// 佐川急便の案件で、まだ入っていない項目（営業所名・単価か日極か・単価・日極。上乗せ・新人保証は入れなければなし）
export function sagawaMissing(job) {
  const j = sagawaJob(job);
  if (!String(j.office || '').trim()) return ['営業所名'];
  if (j.pay !== 'unit' && j.pay !== 'daily') return ['単価か日極か'];
  const miss = [];
  if (j.pay === 'daily') { if (num(j.priceDaily) == null) miss.push('日極（円/日）'); } else {
    const prices = [['priceTakuhai', '宅配'], ['priceShogyo', '商業'], ['priceShuka', '集荷']].filter(([k]) => num(j[k]) == null).map(([, t]) => t);
    if (prices.length) miss.push(`単価：${prices.join('・')}`);
  }
  for (const g of Array.isArray(j.guards) ? j.guards : []) {
    if (g.type !== 'daily' && g.type !== 'extra') miss.push(`${guardName(g)}の種類`);
    else if (!validGuard(g)) miss.push(`${guardName(g)}の期間・金額`);
  }
  return miss;
}

export function jobsOf(settings) {
  return jobList(settings).filter(jobReady);
}
export const hasSagawa = (settings) => jobsOf(settings).some((j) => j.kind === 'sagawa');

// 案件の名前（佐川急便 八王子営業所／○○運送 △△営業所）
const officeLabel = (name) => (!name || /営業所/.test(name) ? name || '' : name.replace(/^([^（]+)(（.*）)?$/, '$1営業所$2'));
export function jobLabel(job) {
  if (job.kind === 'sagawa') { const j = sagawaJob(job); return `佐川急便 ${withShift(officeLabel(cleanOffice(j.office)), j.shift)}`.trim(); }
  return [job.company, job.branch].map((v) => String(v || '').trim()).filter(Boolean).join(' ');
}

// 佐川急便の案件を、以前の設定の形に置きかえる（単価・新人保証の計算をそのまま使う）
export function sagawaSettings(job, settings) {
  const j = sagawaJob(job);
  return { ...settings, salesType: 'sagawa', salesOffice: j.office || '', salesOfficeName: '', salesShift: j.shift, salesPay: j.pay, priceTakuhai: job.priceTakuhai ?? '', priceShogyo: job.priceShogyo ?? '', priceShuka: job.priceShuka ?? '', priceDaily: job.priceDaily ?? '', priceExtra: job.priceExtra ?? '' };
}

const findJob = (settings, e) => {
  const jobs = jobsOf(settings);
  return jobs.find((j) => e.id && j.id === e.id) || jobs.find((j) => jobLabel(j) === e.name) || null;
};

// その日の案件 [{ id, name, job, counts, amount, memo, missing, guard, guardExtra }]
// amount：その案件の金額（null は金額まだ）、guard：その日の保証、guardExtra：金額に含まれる一部保証の額
// 記録で案件を選んでいない日（以前の版の記録）は、そのころの案件（佐川急便は記録の配達個数を使う）
export function dayJobs(rec, settings) {
  let list;
  if (Array.isArray(rec?.jobs)) list = rec.jobs;
  else {
    // 案件を選ぶ前の版の記録：そのころの案件（佐川急便／法人（日極））の分として数える
    const jobs = jobsOf(settings);
    const j = settings.salesType === 'sagawa' ? jobs.find((x) => x.kind === 'sagawa')
      : settings.salesType === 'daily' ? jobs.find((x) => x.kind === 'corp' && x.pay === 'daily')
        : jobs.length === 1 ? jobs[0] : null;
    if (!j) return [];
    list = [j.kind === 'sagawa' ? { id: j.id, counts: rec?.sales || {} } : { id: j.id, amount: j.pay === 'daily' ? num(j.price) : null, counts: [] }];
  }
  return list.map((e) => {
    const job = findJob(settings, e);
    const out = { id: e.id || job?.id || '', name: job ? jobLabel(job) : e.name || '', job, counts: e.counts ?? (job?.kind === 'sagawa' ? {} : []), memo: e.memo || '', amount: null, missing: false, guard: null, guardExtra: 0 };
    if (!job) { out.amount = num(e.amount); out.missing = out.amount == null; return out; }
    if (job.kind === 'sagawa') {
      const ss = sagawaSettings(job, settings);
      const p = unitPrices(ss);
      const g = guardOn(normalizeJob(job, settings), rec.date);
      out.guard = g; // その日の保証（新人保証・年末保証）
      out.guardExtra = g?.type === 'extra' ? g.amount : 0;
      const bonus = (p.daily || 0) + out.guardExtra;
      const c = out.counts || {};
      out.missing = COUNT_KEYS.every(([k]) => num(c[k]) == null);
      if (g?.type === 'daily') out.amount = g.amount; // 日極保証：期間中は個数に関係なく1日の金額
      else if (isFixedSagawa(job)) out.amount = bonus; // 日極：個数を入れても金額は変わらない
      else out.amount = out.missing ? (bonus || null) : COUNT_KEYS.reduce((t, [k]) => t + (num(c[k]) || 0) * (p[k] || 0), 0) + bonus;
    } else if (job.pay === 'unit') {
      const c = Array.isArray(out.counts) ? out.counts : [];
      const units = jobUnits(job);
      out.missing = units.every((u) => num(c[u.i]) == null);
      out.amount = out.missing ? null : units.reduce((t, u) => t + (num(c[u.i]) || 0) * num(u.price), 0);
    } else {
      out.amount = num(e.amount);
      out.missing = out.amount == null;
    }
    return out;
  });
}

export function salesReady(settings) {
  return jobsOf(settings).length > 0;
}

const worked = (rec) => !!rec?.start && !isOff(rec);

// 乗務した日なのに、売上の入力がまだか（案件を選んでいない／個数や金額が入っていない案件がある）
export function countsMissing(rec, settings) {
  if (!worked(rec)) return false;
  const js = dayJobs(rec, settings);
  return !js.length || js.some((j) => j.missing);
}

// 1日の金額（売上がない日は null）。1日ごとに足す金額（川口（DRF）・新人保証など）は個数がまだでも入れる
export function dayAmount(rec, settings) {
  if (!worked(rec)) return null;
  const js = dayJobs(rec, settings);
  if (!js.length || js.every((j) => j.amount == null)) return null;
  return js.reduce((t, j) => t + (j.amount || 0), 0);
}

// その月の売上表。upto（'YYYY-MM-DD'）までの日を数える（前払いは今日まで）
export function monthSales(records, y, m, settings, upto = null, today = todayKey()) {
  const byDate = new Map(records.map((r) => [r.date, r]));
  const days = daysInMonth(y, m);
  const rows = [];
  const total = { days: 0, takuhai: 0, shogyo: 0, shuka: 0, km: 0, amount: 0, missing: 0, guardExtra: 0 };
  for (let d = 1; d <= days; d++) {
    const key = dateKey(y, m, d);
    const rec = byDate.get(key);
    const inRange = !upto || key <= upto;
    const jobs = worked(rec) ? dayJobs(rec, settings) : [];
    const amount = inRange ? dayAmount(rec, settings) : null;
    // 佐川急便の配達個数（その日の佐川急便の案件の合計）
    const sag = jobs.filter((j) => j.job?.kind === 'sagawa');
    const counts = Object.fromEntries(COUNT_KEYS.map(([k]) => [k, sag.length && sag.some((j) => num(j.counts?.[k]) != null) ? sag.reduce((t, j) => t + (num(j.counts?.[k]) || 0), 0) : null]));
    const km = distanceOf(rec);
    const missing = inRange && countsMissing(rec, settings);
    // その日の保証（一部保証の分は金額に含まれている）
    const guard = inRange ? jobs.find((j) => j.guard)?.guard || null : null;
    const guardExtra = inRange ? jobs.reduce((t, j) => t + (j.guardExtra || 0), 0) : 0;
    rows.push({ jobs, guard, guardExtra, date: key, day: d, week: weekday(key), rec, worked: worked(rec), off: isOffDay(rec, key, today), start: rec?.start?.time || '', end: rec?.end?.time || '', counts, km, amount, inRange, missing });
    if (inRange && worked(rec)) {
      total.days++;
      for (const [k] of COUNT_KEYS) total[k] += counts[k] || 0;
      total.km += km || 0;
      total.amount += amount || 0;
      if (missing) total.missing++;
      total.guardExtra += guardExtra;
    }
  }
  // その月に保証の期間がかかっているか（表に保証の列を出す）
  const hasGuard = monthGuards(settings, y, m).length > 0;
  return { rows, total, hasGuard };
}

// その月に期間がかかっている保証 [{ job, guard }]
export function monthGuards(settings, y, m) {
  const from = dateKey(y, m, 1);
  const to = dateKey(y, m, daysInMonth(y, m));
  return jobsOf(settings).flatMap((j) => guardsOf(j).filter((g) => g.from <= to && g.to >= from).map((g) => ({ job: j, guard: g })));
}

export const yen = (v) => `${Number(v || 0).toLocaleString('ja-JP')}円`;
