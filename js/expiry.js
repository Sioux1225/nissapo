// 車検・運転免許証の期限のお知らせ（日付の入力は任意）
// 60日前・30日前・14日前・7日前に1回ずつお知らせし、期限を過ぎたら毎回お知らせする。

export const EXPIRY_ITEMS = [
  { key: 'shaken', setting: 'shakenDate', label: '車検', dateLabel: '満了日' },
  { key: 'license', setting: 'licenseDate', label: '運転免許証', dateLabel: '有効期限' }
];

// お知らせの段階：1＝60日前・2＝30日前・3＝14日前・4＝7日前・5＝期限切れ
const STAGES = [60, 30, 14, 7];
export const EXPIRED = 5;

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// 期限まであと何日か（当日は0。期限の日までは有効）
export function daysUntil(dateStr, today) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

export function stageOf(days) {
  if (days < 0) return EXPIRED;
  let stage = 0;
  STAGES.forEach((limit, i) => { if (days <= limit) stage = i + 1; });
  return stage;
}

const slash = (s) => s.replace(/-/g, '/');

// 入力されている期限の状況 [{ item, date, days, stage }]
export function expiryStatus(settings, today) {
  return EXPIRY_ITEMS
    .filter((it) => isDate(settings[it.setting]))
    .map((it) => {
      const date = settings[it.setting];
      const days = daysUntil(date, today);
      return { item: it, date, days, stage: stageOf(days) };
    });
}

export function expiryMessage(st) {
  const { item, date, days, stage } = st;
  const when = `${item.dateLabel}（${slash(date)}）`;
  if (item.key === 'shaken') {
    if (stage === EXPIRED) return { title: '車検が切れています', text: `車検の${when}を過ぎています。車検切れの車は運転できません。すぐに事務所に連絡してください。`, danger: true };
    if (stage >= 3) return { title: `車検まで あと${days}日`, text: `車検の${when}まで あと${days}日です。必ず満了日までに車検を受けてください。`, danger: true };
    if (stage === 2) return { title: `車検まで あと${days}日`, text: `車検の${when}まで あと${days}日です。車検を受ける日を決めましょう。`, danger: false };
    return { title: `車検まで あと${days}日`, text: `車検の${when}まで あと${days}日です。早めに車検の予約をしましょう。`, danger: false };
  }
  if (stage === EXPIRED) return { title: '運転免許証の有効期限が過ぎています', text: `運転免許証の${when}を過ぎています。免許が切れたまま運転すると無免許運転になります。運転せずに、すぐに警察署や運転免許センターに相談してください。`, danger: true };
  if (stage >= 3) return { title: `免許証の更新まで あと${days}日`, text: `運転免許証の${when}まで あと${days}日です。必ず期限までに更新してください。`, danger: true };
  return { title: `免許証の更新まで あと${days}日`, text: `運転免許証の${when}まで あと${days}日です。更新の手続きを忘れずに（はがきのお知らせも確かめましょう）。`, danger: false };
}

// まだ見せていないお知らせ（期限切れは毎回）。見せたら ack に { date, stage } を残す
export function expiryAlertsToShow(settings, today) {
  const ack = settings.expiryAck || {};
  return expiryStatus(settings, today)
    .filter((st) => st.stage > 0)
    .filter((st) => st.stage === EXPIRED || !(ack[st.item.key]?.date === st.date && ack[st.item.key]?.stage >= st.stage));
}
