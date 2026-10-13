// 売上表（月報・前払い用）
// 佐川急便：その日の配達個数（宅配・商業・集荷）× 単価。日当の案件：乗務した日 × 日当。
// 前払いは月初めからの売上で計算するため、合計はその月の分だけ（前月の分は含めない）。

import { num, daysInMonth, dateKey, weekday, distanceOf, isOff } from './model.js';

export const SALES_TYPES = [['sagawa', '佐川急便'], ['daily', '日当の案件']];
export const COUNT_KEYS = [['takuhai', '宅配'], ['shogyo', '商業'], ['shuka', '集荷']];

// 単価（商業・集荷が空なら宅配と同じ）
export function unitPrices(settings) {
  const t = num(settings.priceTakuhai);
  return {
    takuhai: t,
    shogyo: num(settings.priceShogyo) ?? t,
    shuka: num(settings.priceShuka) ?? t
  };
}

export function salesReady(settings) {
  if (settings.salesType === 'sagawa') return num(settings.priceTakuhai) != null;
  if (settings.salesType === 'daily') return num(settings.dailyRate) != null;
  return false;
}

const worked = (rec) => !!rec?.start && !isOff(rec);

// 1日の金額（売上がない日は null）
export function dayAmount(rec, settings) {
  if (!worked(rec)) return null;
  if (settings.salesType === 'daily') return num(settings.dailyRate);
  if (settings.salesType !== 'sagawa') return null;
  const p = unitPrices(settings);
  const c = rec.sales || {};
  const counts = COUNT_KEYS.map(([k]) => num(c[k]));
  if (counts.every((v) => v == null)) return null;
  return COUNT_KEYS.reduce((sum, [k], i) => sum + (counts[i] || 0) * (p[k] || 0), 0);
}

// その月の売上表。upto（'YYYY-MM-DD'）までの日を数える（前払いは今日まで）
export function monthSales(records, y, m, settings, upto = null) {
  const byDate = new Map(records.map((r) => [r.date, r]));
  const days = daysInMonth(y, m);
  const rows = [];
  const total = { days: 0, takuhai: 0, shogyo: 0, shuka: 0, km: 0, amount: 0, missing: 0 };
  for (let d = 1; d <= days; d++) {
    const key = dateKey(y, m, d);
    const rec = byDate.get(key);
    const inRange = !upto || key <= upto;
    const amount = inRange ? dayAmount(rec, settings) : null;
    const counts = Object.fromEntries(COUNT_KEYS.map(([k]) => [k, num(rec?.sales?.[k])]));
    const km = distanceOf(rec);
    rows.push({ date: key, day: d, week: weekday(key), rec, worked: worked(rec), off: isOff(rec), start: rec?.start?.time || '', end: rec?.end?.time || '', counts, km, amount, inRange });
    if (inRange && worked(rec)) {
      total.days++;
      for (const [k] of COUNT_KEYS) total[k] += counts[k] || 0;
      total.km += km || 0;
      total.amount += amount || 0;
      // 佐川急便で個数がまだ入っていない日
      if (settings.salesType === 'sagawa' && amount == null) total.missing++;
    }
  }
  return { rows, total };
}

export const yen = (v) => `${Number(v || 0).toLocaleString('ja-JP')}円`;
