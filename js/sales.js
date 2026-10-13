// 売上表（月報・前払い用）
// 佐川急便：その日の配達個数（宅配・商業・集荷）× 単価。日当の案件：乗務した日 × 日当。
// 前払いは月初めからの売上で計算するため、合計はその月の分だけ（前月の分は含めない）。

import { num, daysInMonth, dateKey, weekday, distanceOf, isOff, isOffDay, todayKey } from './model.js';

export const SALES_TYPES = [['sagawa', '佐川急便'], ['daily', 'その他']];
export const COUNT_KEYS = [['takuhai', '宅配'], ['shogyo', '商業'], ['shuka', '集荷']];

// 佐川急便の商業・集荷の決まった単価（営業所で変わる）
//   商業：100円（三多摩・八王子は80円）　集荷：100円（台東は70円）
export function defaultShogyo(office) {
  return /三多摩|八王子/.test(office || '') ? 80 : 100;
}
export function defaultShuka(office) {
  return /台東/.test(office || '') ? 70 : 100;
}

// 佐川急便の営業所と宅配の単価（佐川単価表 2026年5月27日更新の「一般」）
// 3つ目の数字は、乗務した日ごとに足す金額（川口（DRF）は個建＋1日10,000円の保障）
// 4つ目は新人保証：稼働を開始した日から months か月のあいだ、乗務した日ごとに perDay 円を足す
// 三多摩B は三多摩と同じ営業所をエリアで分けたものなので、三多摩を選ぶ（以前の入力の「三多摩B」も三多摩に読み替える）
export const PRICE_TABLE_DATE = '2026年5月27日';
export const OFFICES = [
  ['東京', 173], ['江東', 173], ['台東', 173], ['世田谷', 176], ['墨田', 175], ['横浜', 176], ['湘南', 170],
  ['千葉南', 170], ['千葉北', 170], ['城北', 177], ['三多摩（山単価）', 186], ['三多摩', 165], ['練馬', 180],
  ['越谷', 167], ['足立', 175], ['八王子', 178, 0, { perDay: 5000, months: 1 }], ['八王子（代走）', 190], ['川崎', 173], ['さいたま', 180], ['川口', 180], ['川口（DRF）', 167, 10000],
  ['所沢', 180], ['赤羽', 177], ['座間', 173], ['横須賀', 178], ['横浜北', 175], ['杉並', 177], ['木更津', 168],
  ['茂原', 168], ['横浜鶴見', 176], ['城南', 174], ['目黒', 173], ['横浜緑', 171], ['佐倉', 166], ['町田', 159],
  ['千葉', 168], ['中野', 173], ['相模原', 169], ['戸田', 167]
];
export const OTHER_OFFICE = 'その他';

// 選んだ営業所（表にあればその行、「その他」や表にない名前なら null）
// 以前の版で「八王子営業所」のように入力した名前も、表の営業所に読み替える
export function officeEntry(name) {
  let n = String(name || '').replace(/\s|　/g, '').replace(/営業所$/, '');
  if (/^三多摩[BＢ]$/.test(n)) n = '三多摩';
  const hit = OFFICES.find(([o]) => o === n);
  return hit ? { name: hit[0], takuhai: hit[1], daily: hit[2] || 0, newbie: hit[3] || null } : null;
}

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const pad = (n) => String(n).padStart(2, '0');

// 新人保証の期間 { from, to, perDay }（to はその日まで。稼働を開始した日が入っていなければ null）
// 例：10月13日に開始して1か月なら、11月12日まで（月末をまたぐときは、次の月の末日を上限にする）
export function newbiePeriod(settings) {
  if (settings.salesType !== 'sagawa') return null;
  const nb = officeEntry(settings.salesOffice)?.newbie;
  if (!nb || !isDate(settings.salesStartDate)) return null;
  const [y, m, d] = settings.salesStartDate.split('-').map(Number);
  const last = new Date(y, m - 1 + nb.months + 1, 0).getDate(); // 期間の終わりの月の末日
  const end = new Date(y, m - 1 + nb.months, Math.min(d, last));
  end.setDate(end.getDate() - 1);
  return { from: settings.salesStartDate, to: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`, perDay: nb.perDay };
}

// その日に、個数の金額とは別に足す金額（1日の保障・新人保証）
export function dayBonus(settings, date) {
  const p = unitPrices(settings);
  const nb = newbiePeriod(settings);
  return (p.daily || 0) + (nb && date >= nb.from && date <= nb.to ? nb.perDay : 0);
}

// 売上表に出す営業所名
export function officeName(settings) {
  if (settings.salesOffice === OTHER_OFFICE) return settings.salesOfficeName || '';
  return officeEntry(settings.salesOffice)?.name || settings.salesOffice || '';
}

// 単価：表の営業所なら宅配は表の「一般」、商業・集荷は営業所で決まった単価。
// 一覧にない営業所は、入力した単価（商業・集荷は空なら営業所名で決まった単価）
export function unitPrices(settings) {
  const entry = officeEntry(settings.salesOffice);
  const name = officeName(settings);
  if (entry) return { takuhai: entry.takuhai, shogyo: defaultShogyo(entry.name), shuka: defaultShuka(entry.name), daily: entry.daily };
  return {
    takuhai: num(settings.priceTakuhai),
    shogyo: num(settings.priceShogyo) ?? defaultShogyo(name),
    shuka: num(settings.priceShuka) ?? defaultShuka(name),
    daily: 0
  };
}

// 希望する前払い額（月ごと。キーは 'YYYY-MM'）
export const advanceKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
export function advanceOf(settings, y, m) {
  return num((settings.advance || {})[advanceKey(y, m)]);
}

export function salesReady(settings) {
  if (settings.salesType === 'sagawa') return unitPrices(settings).takuhai != null;
  if (settings.salesType === 'daily') return num(settings.dailyRate) != null;
  return false;
}

const worked = (rec) => !!rec?.start && !isOff(rec);

// 佐川急便で、乗務した日なのに配達個数がまだ入っていないか
export function countsMissing(rec, settings) {
  if (settings.salesType !== 'sagawa' || !worked(rec)) return false;
  return COUNT_KEYS.every(([k]) => num(rec.sales?.[k]) == null);
}

// 1日の金額（売上がない日は null）。1日ごとに足す金額（川口（DRF）など）は個数がまだでも入れる
export function dayAmount(rec, settings) {
  if (!worked(rec)) return null;
  if (settings.salesType === 'daily') return num(settings.dailyRate);
  if (settings.salesType !== 'sagawa') return null;
  const p = unitPrices(settings);
  const bonus = dayBonus(settings, rec.date);
  if (countsMissing(rec, settings)) return bonus ? bonus : null;
  const c = rec.sales || {};
  return COUNT_KEYS.reduce((sum, [k]) => sum + (num(c[k]) || 0) * (p[k] || 0), 0) + bonus;
}

// その月の売上表。upto（'YYYY-MM-DD'）までの日を数える（前払いは今日まで）
export function monthSales(records, y, m, settings, upto = null, today = todayKey()) {
  const byDate = new Map(records.map((r) => [r.date, r]));
  const days = daysInMonth(y, m);
  const rows = [];
  const total = { days: 0, takuhai: 0, shogyo: 0, shuka: 0, km: 0, amount: 0, missing: 0, newbie: 0 };
  const nb = newbiePeriod(settings);
  for (let d = 1; d <= days; d++) {
    const key = dateKey(y, m, d);
    const rec = byDate.get(key);
    const inRange = !upto || key <= upto;
    const amount = inRange ? dayAmount(rec, settings) : null;
    const counts = Object.fromEntries(COUNT_KEYS.map(([k]) => [k, num(rec?.sales?.[k])]));
    const km = distanceOf(rec);
    const missing = inRange && countsMissing(rec, settings);
    // 新人保証の分（金額に含まれている）
    const newbie = inRange && worked(rec) && nb && key >= nb.from && key <= nb.to ? nb.perDay : 0;
    rows.push({ newbie, date: key, day: d, week: weekday(key), rec, worked: worked(rec), off: isOffDay(rec, key, today), start: rec?.start?.time || '', end: rec?.end?.time || '', counts, km, amount, inRange, missing });
    if (inRange && worked(rec)) {
      total.days++;
      for (const [k] of COUNT_KEYS) total[k] += counts[k] || 0;
      total.km += km || 0;
      total.amount += amount || 0;
      // 佐川急便で個数がまだ入っていない日
      if (missing) total.missing++;
      total.newbie += newbie;
    }
  }
  // その月に新人保証の期間がかかっているか（表に新人保証の列を出す）
  const monthFrom = dateKey(y, m, 1);
  const monthTo = dateKey(y, m, days);
  const hasNewbie = !!nb && nb.from <= monthTo && nb.to >= monthFrom;
  return { rows, total, hasNewbie };
}

export const yen = (v) => `${Number(v || 0).toLocaleString('ja-JP')}円`;
