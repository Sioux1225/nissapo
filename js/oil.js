// オイル交換：前回の交換からの走行距離で、交換の時期を知らせる。
// 3,000km・3,500km・4,000km・4,500km でお知らせし、5,000km までに必ず交換する。
// オイルエレメントは、オイル交換2〜3回に1回（10,000km〜15,000km）交換する。

import { num } from './model.js';

export const OIL_LIMIT = 5000;
export const OIL_STEPS = [3000, 3500, 4000, 4500, OIL_LIMIT];
// エレメント：オイル交換2回目（または10,000km）から交換の時期、3回目（または15,000km）は必ず交換
export const ELEMENT_FROM = { count: 2, km: 10000 };
export const ELEMENT_MUST = { count: 3, km: 15000 };

export function newOilChange(date, odo, element = false) {
  return { id: `oil-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, date, odo: num(odo), element: !!element };
}

// いまのメーターの距離（運転日報のいちばん新しい値。なければ設定の距離）
export function currentOdo(records, settings) {
  let best = null;
  for (const r of records) {
    for (const v of [num(r.start?.odo), num(r.end?.odo)]) {
      if (v != null && (best == null || v > best)) best = v;
    }
  }
  return best ?? num(settings.initialOdo);
}

const sortChanges = (list) => [...(list || [])].sort((a, b) => (a.date === b.date ? a.odo - b.odo : a.date < b.date ? -1 : 1));

// エレメントの状況
//   since：前回エレメントを交換してからのオイル交換の回数（エレメントの記録がなければ、記録したオイル交換の回数）
//   km：前回エレメントを交換してから走った距離（いまのメーターから。分からなければ null）
//   need：次のオイル交換で 'must'（必ず交換）・'suggest'（交換の時期）・''（まだ）
//   left：交換の時期になるまで、あと何回オイル交換をするか（次が時期なら 1）
export function elementStatus(changes, now = null) {
  const list = sortChanges(changes);
  const lastIdx = list.map((c) => !!c.element).lastIndexOf(true);
  const since = lastIdx < 0 ? list.length : list.length - 1 - lastIdx;
  const km = lastIdx >= 0 && now != null && list[lastIdx].odo != null ? Math.max(0, now - list[lastIdx].odo) : null;
  const next = since + 1; // 次のオイル交換は、エレメント交換から何回目か
  const need = next >= ELEMENT_MUST.count || (km != null && km >= ELEMENT_MUST.km) ? 'must'
    : next >= ELEMENT_FROM.count || (km != null && km >= ELEMENT_FROM.km) ? 'suggest' : '';
  const left = Math.max(1, ELEMENT_FROM.count - since);
  return { since, km, need, dueNext: need !== '', left, known: lastIdx >= 0 };
}

// 交換の状況。level はいま超えている目安（0・3000・3500・4000・4500・5000）
export function oilStatus(settings, records) {
  const changes = sortChanges(settings.oilChanges);
  const last = changes[changes.length - 1] || null;
  const now = currentOdo(records, settings);
  const element = elementStatus(changes, now);
  if (!last || last.odo == null || now == null) return { last, now, since: null, remaining: null, level: 0, element };
  const since = Math.max(0, now - last.odo);
  const level = [...OIL_STEPS].reverse().find((s) => since >= s) || 0;
  return { last, now, since, remaining: OIL_LIMIT - since, level, element };
}

const km = (v) => `${Number(v).toLocaleString('ja-JP')}km`;

// お知らせの文（次がエレメントも交換する回なら、そのことも書く）
export function oilMessage(status) {
  const msg = oilMessageBase(status);
  const need = status.element?.need;
  if (msg && need === 'must') msg.text += '今回は必ずオイルエレメントも交換してください（2〜3回に1回・10,000km〜15,000km）。';
  else if (msg && need === 'suggest') msg.text += 'オイルエレメントも交換の時期です（2〜3回に1回・10,000km〜15,000km）。';
  return msg;
}

function oilMessageBase(status) {
  const { level, since, remaining } = status;
  if (level >= OIL_LIMIT) return { title: 'すぐにオイル交換をしてください', text: `前回のオイル交換から ${km(since)} 走りました。5,000km を超えています。今日のうちにオイル交換をしてください。`, danger: true };
  if (level >= 4500) return { title: '5,000km までに必ずオイル交換を', text: `前回のオイル交換から ${km(since)} 走りました。あと ${km(remaining)} で 5,000km です。必ずオイル交換をしてください。`, danger: true };
  if (level >= 4000) return { title: '早めにオイル交換をしてください', text: `前回のオイル交換から ${km(since)} 走りました。あと ${km(remaining)} で 5,000km です。`, danger: false };
  if (level >= 3500) return { title: 'オイル交換の予約をしましょう', text: `前回のオイル交換から ${km(since)} 走りました。5,000km までに交換できるよう、予約をしておきましょう。`, danger: false };
  if (level >= 3000) return { title: 'そろそろオイル交換の時期です', text: `前回のオイル交換から ${km(since)} 走りました。5,000km までにオイル交換をしましょう。`, danger: false };
  return null;
}

// まだ見せていないお知らせがあるか（5,000km を超えていたら毎回見せる）
export function oilAlertToShow(settings, status) {
  if (!status.last || status.level === 0) return null;
  if (status.level >= OIL_LIMIT) return oilMessage(status);
  const ack = settings.oilAck || {};
  if (ack.changeId === status.last.id && ack.level >= status.level) return null;
  return oilMessage(status);
}

export { sortChanges as sortOilChanges };
