// オイル交換：前回の交換からの走行距離で、交換の時期を知らせる。
// 3,000km・3,500km・4,000km・4,500km でお知らせし、5,000km までに必ず交換する。

import { num } from './model.js';

export const OIL_LIMIT = 5000;
export const OIL_STEPS = [3000, 3500, 4000, 4500, OIL_LIMIT];

export function newOilChange(date, odo, note = '') {
  return { id: `oil-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, date, odo: num(odo), note };
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

// 交換の状況。level はいま超えている目安（0・3000・3500・4000・4500・5000）
export function oilStatus(settings, records) {
  const changes = sortChanges(settings.oilChanges);
  const last = changes[changes.length - 1] || null;
  const now = currentOdo(records, settings);
  if (!last || last.odo == null || now == null) return { last, now, since: null, remaining: null, level: 0 };
  const since = Math.max(0, now - last.odo);
  const level = [...OIL_STEPS].reverse().find((s) => since >= s) || 0;
  return { last, now, since, remaining: OIL_LIMIT - since, level };
}

const km = (v) => `${Number(v).toLocaleString('ja-JP')}km`;

// お知らせの文
export function oilMessage(status) {
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
