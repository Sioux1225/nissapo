import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupReminder, DEFAULT_SETTINGS, newStart, newEnd, prevOdo, monthSheets, yearSheets, toCsv, timeToSerial, distanceOf } from '../js/model.js';
import { buildXlsx, colName, sheetXml } from '../js/xlsx.js';
import { buildPdf } from '../js/pdf.js';

const settings = { ...DEFAULT_SETTINGS, driverName: '配送 太郎', office: '○○', startPlace: '○○営業所', via: '○○町1,2丁目、△△町', restPlace: '○○公園駐車場', rollcaller: '配送 太郎', initialOdo: 12000 };

function rec(date, s, e, a, b) {
  return {
    date, rollcaller: '配送 太郎', // 点呼実施者名は運転者名と同じ
    start: { ...newStart(settings, a, s) },
    end: e ? { ...newEnd(settings, e), odo: b } : null
  };
}

const records = [
  rec('2026-10-01', '7:20', '19:55', 12000, 12110),
  rec('2026-10-02', '7:05', '20:01', 12110, 12230),
  rec('2026-10-05', '7:30', null, 12230)
];

test('時刻をExcelの値にする', () => {
  assert.equal(timeToSerial('12:00'), 0.5);
  assert.equal(timeToSerial('7:20'), 440 / 1440);
});

test('前の日の終了距離を次の開始距離にする', () => {
  assert.equal(prevOdo(records, '2026-10-03', settings), 12230);
  assert.equal(prevOdo(records, '2026-10-06', settings), 12230); // 乗務後がない日は開始距離
  assert.equal(prevOdo(records, '2026-09-30', settings), 12000); // 記録がなければ設定の距離
  assert.equal(distanceOf(records[0]), 110);
});

test('運転日報・点呼記録簿の行が事務所のブックと同じ列になる', () => {
  const [daily, roll] = monthSheets(records, 2026, 10, settings, '2026-10-06');
  assert.equal(daily.name, '運転日報10月');
  assert.equal(roll.name, '点呼記録簿10月');
  assert.equal(daily.rows.length, 31);
  assert.deepEqual(daily.rows[0], [1, '○○営業所', { time: '7:20' }, '○○営業所', { time: '19:55' }, '○○町1,2丁目、△△町', 12000, 12110, 110, '○○公園駐車場', 60, '無', '有', '無', '無', '無']);
  // 点呼方法は「自身」に固定
  assert.deepEqual(roll.rows[0], [1, { time: '7:20' }, '自身', '有', '無', '良好', '良好', '無', { time: '19:55' }, '自身', '有', '無', '無', '無', '配送 太郎', null]);
  // 記録のない過去の日（10/3）は自動で休み、今日以降（10/6・10/7）は空欄
  assert.deepEqual(daily.rows[2], [3, ...Array(14).fill(null), '休み']);
  assert.deepEqual(daily.rows[5].slice(1), Array(15).fill(null));
  assert.deepEqual(daily.rows[6].slice(1), Array(15).fill(null));
  // 乗務後がまだの日は乗務前だけ
  assert.deepEqual(roll.rows[4].slice(8, 14), [null, null, null, null, null, null]);
});

test('1年分は運転日報1〜12月、点呼記録簿1〜12月の24シート', () => {
  const specs = yearSheets(records, 2026, settings);
  assert.equal(specs.length, 24);
  assert.equal(specs[0].name, '運転日報1月');
  assert.equal(specs[12].name, '点呼記録簿1月');
  assert.equal(specs[1].rows.length, 28);
});

test('xlsx：列名・式・時刻の書式', () => {
  assert.equal(colName(0), 'A');
  assert.equal(colName(25), 'Z');
  assert.equal(colName(26), 'AA');
  const [daily, roll] = monthSheets(records, 2026, 10, settings);
  const x = sheetXml(daily);
  assert.match(x, /<c r="H4" s="6"><f>SUM\(G4,I4\)<\/f><v>12110<\/v><\/c>/);
  assert.match(x, /<c r="C4" s="5"><v>0\.30555/);
  assert.match(sheetXml(roll), /<mergeCell ref="B3:H3"\/>/);
  const bytes = buildXlsx([daily, roll]);
  assert.equal(String.fromCharCode(bytes[0], bytes[1]), 'PK');
});

test('CSV：記録のある日だけ、BOM付き', () => {
  const csv = toCsv(records, '2026-10-01', '2026-10-31', '2026-10-01');
  assert.ok(csv.startsWith('﻿日付,'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 4);
  assert.ok(lines[1].startsWith('2026/10/01,○○営業所,7:20,○○営業所,19:55,"○○町1,2丁目、△△町",12000,12110,110,'));
  assert.ok(lines[1].endsWith(',配送 太郎'));
});

test('PDF：ページ数と終わりの印', () => {
  const jpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xD9]);
  const pdf = new TextDecoder('latin1').decode(buildPdf([{ jpeg, width: 10, height: 10 }, { jpeg, width: 10, height: 10 }]));
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.match(pdf, /\/Count 2/);
  assert.ok(pdf.trimEnd().endsWith('%%EOF'));
  // xref の位置が正しい
  const start = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.equal(pdf.slice(start, start + 4), 'xref');
});

test('事故の記録：様式の項目・別紙・報告が必要な事故・Excel・CSV', async () => {
  const { newAccident, normalizeAccident, needsReport, annexLines, wareki, planFromRecord, accidentSheet, accidentCsv, validateAccident } = await import('../js/accident.js');
  const a = { ...newAccident(settings, '2026-10-13', '14:05'), place: '○○市○○町', situation: '右折時に対向車と接触, けが人なし', kind: '物損', cause: '確認不足', prevention: '一時停止して確認' };
  assert.equal(validateAccident({ ...a, situation: '' }), '当時の状況を入れてください');
  assert.equal(validateAccident(a), null);
  assert.equal(wareki('2026-07-30'), '令和8年7月30日');
  assert.equal(wareki('2019-05-01'), '令和元年5月1日');

  // 報告が必要な事故：軽傷1人だけなら不要、重傷・転落・負傷者10人以上なら必要
  assert.equal(needsReport({ ...a, annex: { ...a.annex, light: '1' } }), false);
  assert.equal(needsReport({ ...a, annex: { ...a.annex, serious: '1' } }), true);
  assert.equal(needsReport({ ...a, annex: { ...a.annex, kinds: ['衝突', '転落'] } }), true);
  assert.equal(needsReport({ ...a, annex: { ...a.annex, light: '10' } }), true);
  assert.deepEqual(annexLines({ ...a, annex: { ...a.annex, kinds: ['衝突'], width: '3.1', light: '1' } }),
    [['事故の種類（区分）', '衝突'], ['道路の幅員', '3.1 m'], ['損害の程度（人）', '軽傷 1人（うち運転者 0人）']]);

  // 以前の版の記録（summary・injury）を読み替える
  const old = normalizeAccident({ id: 'x', date: '2026-10-01', time: '9:00', place: 'A', summary: '接触', injury: 'あり', updatedAt: '2026-10-02T00:00:00Z' });
  assert.equal(old.situation, '接触');
  assert.equal(old.created, '2026-10-02');
  assert.deepEqual(old.annex.kinds, []);

  assert.equal(planFromRecord(records[0]), '7:20 ○○営業所を出庫～○○町1,2丁目、△△町にて配送～19:55 ○○営業所に帰庫');

  const sheet = accidentSheet([a], settings);
  assert.equal(sheet.rows[0][1], '2026/10/13');
  assert.deepEqual(sheet.rows[0][2], { time: '14:05' });
  assert.equal(sheet.rows[0].length, sheet.widths.length);
  const csv = accidentCsv([a]).trim().split('\r\n');
  assert.equal(csv.length, 2);
  assert.ok(csv[1].includes('"右折時に対向車と接触, けが人なし"'));
  assert.ok(csv[1].includes(',14:05,'));
});

test('オイル交換：走行距離・お知らせの目安・5,000kmを超えたら毎回', async () => {
  const { oilStatus, oilAlertToShow, oilMessage, currentOdo, newOilChange } = await import('../js/oil.js');
  const recs = (odo) => [{ date: '2026-10-01', start: { odo: odo - 100 }, end: { odo } }];
  const change = { ...newOilChange('2026-09-01', 10000), id: 'oil-1' };
  const s = { ...settings, oilChanges: [change], oilAck: null };
  assert.equal(currentOdo(recs(12999), s), 12999);
  assert.equal(currentOdo([], { initialOdo: 5000 }), 5000);

  // 3,000km 未満はお知らせなし
  assert.equal(oilStatus(s, recs(12999)).level, 0);
  assert.equal(oilAlertToShow(s, oilStatus(s, recs(12999))), null);
  // 3,000km・3,500km・4,000km・4,500km・5,000km
  for (const [odo, level] of [[13000, 3000], [13600, 3500], [14000, 4000], [14500, 4500], [15000, 5000]]) {
    assert.equal(oilStatus(s, recs(odo)).level, level);
  }
  assert.equal(oilStatus(s, recs(14600)).remaining, 400);
  // 一度見せた目安は、次の目安を超えるまで見せない
  const st = oilStatus(s, recs(13100));
  assert.ok(oilAlertToShow(s, st));
  const acked = { ...s, oilAck: { changeId: 'oil-1', level: 3000 } };
  assert.equal(oilAlertToShow(acked, st), null);
  assert.ok(oilAlertToShow(acked, oilStatus(acked, recs(13500))));
  // 5,000km を超えたら毎回見せる
  const over = { ...s, oilAck: { changeId: 'oil-1', level: 5000 } };
  assert.equal(oilAlertToShow(over, oilStatus(over, recs(15200))).danger, true);
  assert.match(oilMessage(oilStatus(s, recs(14600))).text, /あと 400km/);
  // 交換を記録したら距離は0から
  const s2 = { ...s, oilChanges: [change, { ...newOilChange('2026-10-01', 15200), id: 'oil-2' }] };
  assert.equal(oilStatus(s2, recs(15300)).since, 100);
  assert.equal(oilStatus({ ...settings, oilChanges: [] }, recs(15300)).last, null);
});

test('オイルエレメント：2〜3回に1回（10,000km〜15,000km）', async () => {
  const { elementStatus, oilStatus, oilMessage } = await import('../js/oil.js');
  const ch = (id, date, odo, element) => ({ id, date, odo, element });
  const base = [ch('a', '2026-01-01', 1000, true)];
  // エレメント交換のあと、次（1回目）はまだ
  assert.equal(elementStatus(base, 4000).need, '');
  // 次が2回目なら交換の時期
  const two = [...base, ch('b', '2026-04-01', 5000, false)];
  assert.equal(elementStatus(two, 8000).need, 'suggest');
  // 次が3回目なら必ず交換
  const three = [...two, ch('c', '2026-07-01', 9000, false)];
  assert.equal(elementStatus(three, 12000).need, 'must');
  // 距離でも：10,000km で時期、15,000km で必ず
  assert.equal(elementStatus(base, 11000).need, 'suggest');
  assert.equal(elementStatus(base, 16000).need, 'must');
  assert.equal(elementStatus(base, 11000).km, 10000);
  // エレメントを交換したら数え直し
  assert.equal(elementStatus([...three, ch('d', '2026-10-01', 13000, true)], 14000).need, '');
  // 並び順に関係なく数える
  assert.equal(elementStatus([three[2], three[0], three[1]], 12000).need, 'must');
  // お知らせにもエレメントのことが入る
  const st = oilStatus({ ...settings, oilChanges: three }, [{ date: '2026-10-01', end: { odo: 12100 } }]);
  assert.match(oilMessage(st).text, /必ずオイルエレメントも交換/);
  const st2 = oilStatus({ ...settings, oilChanges: two }, [{ date: '2026-10-01', end: { odo: 8100 } }]);
  assert.match(oilMessage(st2).text, /エレメントも交換の時期/);
});

test('休み：一覧・帳票の備考に「休み」', () => {
  const recs = [...records, { date: '2026-10-03', off: true, start: null, end: null }];
  const [daily, roll] = monthSheets(recs, 2026, 10, settings);
  assert.deepEqual(daily.rows[2], [3, ...Array(14).fill(null), '休み']);
  assert.deepEqual(roll.rows[2], [3, ...Array(14).fill(null), '休み']);
  const csv = toCsv(recs, '2026-10-01', '2026-10-31').trim().split('\r\n');
  assert.ok(csv.some((l) => l.startsWith('2026/10/03,') && l.includes(',休み,')));
  // 休みの日はメーターの引き継ぎに影響しない
  assert.equal(prevOdo(recs, '2026-10-04', settings), 12230);
});

test('車検・免許証の期限：60・30・14・7日前と期限切れ', async () => {
  const { daysUntil, stageOf, expiryStatus, expiryAlertsToShow, expiryMessage, EXPIRED } = await import('../js/expiry.js');
  assert.equal(daysUntil('2026-11-12', '2026-10-13'), 30);
  assert.equal(daysUntil('2026-10-13', '2026-10-13'), 0);
  assert.equal(stageOf(61), 0);
  assert.equal(stageOf(60), 1);
  assert.equal(stageOf(30), 2);
  assert.equal(stageOf(14), 3);
  assert.equal(stageOf(7), 4);
  assert.equal(stageOf(0), 4);
  assert.equal(stageOf(-1), EXPIRED);
  // 入れていなければ何もしない
  assert.deepEqual(expiryStatus({ shakenDate: '', licenseDate: '' }, '2026-10-13'), []);
  const s = { shakenDate: '2026-11-10', licenseDate: '2027-05-01', expiryAck: {} };
  const alerts = expiryAlertsToShow(s, '2026-10-13');
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].item.key, 'shaken');
  assert.match(expiryMessage(alerts[0]).text, /あと28日/);
  // 一度見せた段階は出さない。日付を入れ直したら出る
  const acked = { ...s, expiryAck: { shaken: { date: '2026-11-10', stage: 2 } } };
  assert.equal(expiryAlertsToShow(acked, '2026-10-13').length, 0);
  assert.equal(expiryAlertsToShow(acked, '2026-10-30').length, 1);
  // 期限切れは毎回
  const over = { ...s, expiryAck: { shaken: { date: '2026-11-10', stage: EXPIRED } } };
  const a2 = expiryAlertsToShow(over, '2026-11-11');
  assert.equal(a2.length, 1);
  assert.equal(expiryMessage(a2[0]).danger, true);
  assert.match(expiryMessage({ ...expiryStatus({ licenseDate: '2026-10-01' }, '2026-10-13')[0] }).text, /無免許運転/);
});

test('売上表：佐川急便は個数×単価、日極は乗務した日×日極、月初めから今日まで', async () => {
  const { monthSales, dayAmount, unitPrices, salesReady } = await import('../js/sales.js');
  const sg = { ...settings, salesType: 'sagawa', salesOffice: 'その他', salesOfficeName: '○○', priceTakuhai: '150', priceShogyo: '150', priceShuka: '50' };
  assert.deepEqual(unitPrices(sg), { takuhai: 150, shogyo: 150, shuka: 50, daily: 0 });
  // 営業所を選ぶだけ：宅配は単価表の「一般」、商業100円（三多摩・八王子80円）、集荷100円（台東70円）
  assert.deepEqual(unitPrices({ salesType: 'sagawa', salesOffice: '練馬' }), { takuhai: 180, shogyo: 100, shuka: 100, daily: 0 });
  assert.deepEqual(unitPrices({ salesType: 'sagawa', salesOffice: '八王子' }), { takuhai: 178, shogyo: 80, shuka: 100, daily: 0 });
  assert.deepEqual(unitPrices({ salesType: 'sagawa', salesOffice: '三多摩' }), { takuhai: 165, shogyo: 80, shuka: 100, daily: 0 });
  assert.deepEqual(unitPrices({ salesType: 'sagawa', salesOffice: '三多摩（山単価）' }), { takuhai: 186, shogyo: 80, shuka: 100, daily: 0 });
  // 三多摩B は一覧に出さず、三多摩として扱う
  assert.deepEqual(unitPrices({ salesType: 'sagawa', salesOffice: '三多摩B営業所' }), { takuhai: 165, shogyo: 80, shuka: 100, daily: 0 });
  assert.deepEqual(unitPrices({ salesType: 'sagawa', salesOffice: '台東' }), { takuhai: 173, shogyo: 100, shuka: 70, daily: 0 });
  // 以前の版の入力（「八王子営業所」）も読み替える。表の営業所なら入力した単価は使わない
  assert.deepEqual(unitPrices({ salesType: 'sagawa', salesOffice: '八王子営業所', priceTakuhai: '150' }), { takuhai: 178, shogyo: 80, shuka: 100, daily: 0 });
  // 一覧にない営業所は入力した単価。商業・集荷が空なら営業所名で決まる
  const other = { salesType: 'sagawa', salesOffice: 'その他', salesOfficeName: '三多摩B', priceTakuhai: '170', priceShogyo: '', priceShuka: '' };
  assert.deepEqual(unitPrices(other), { takuhai: 170, shogyo: 80, shuka: 100, daily: 0 });
  assert.equal(salesReady({ ...other, priceTakuhai: '' }), false);
  assert.equal(salesReady({ salesType: 'sagawa', salesOffice: '八王子' }), true);
  assert.equal(salesReady(sg), true);
  assert.equal(salesReady({ ...settings, salesType: 'daily', dailyRate: '' }), false);
  const recs = [
    { date: '2026-09-30', start: { time: '7:00', odo: 100 }, end: { time: '19:00', odo: 200 }, sales: { takuhai: 100 } },
    { date: '2026-10-01', start: { time: '7:00', odo: 200 }, end: { time: '19:00', odo: 300 }, sales: { takuhai: 100, shogyo: 10, shuka: 20, daily: 0 } },
    { date: '2026-10-02', start: { time: '7:00', odo: 300 }, end: { time: '19:00', odo: 410 } },
    { date: '2026-10-03', off: true, start: null, end: null },
    { date: '2026-10-20', start: { time: '7:00', odo: 500 }, end: { time: '19:00', odo: 600 }, sales: { takuhai: 50 } }
  ];
  assert.equal(dayAmount(recs[1], sg), 100 * 150 + 10 * 150 + 20 * 50);
  assert.equal(dayAmount(recs[2], sg), null); // 個数がまだ
  // 10月13日まで：前月（9/30）と、今日より後（10/20）は含めない
  const { total, rows } = monthSales(recs, 2026, 10, sg, '2026-10-13');
  assert.equal(total.amount, 17500);
  assert.equal(total.days, 2);
  assert.equal(total.missing, 1);
  assert.equal(total.km, 210);
  assert.equal(rows.length, 31);
  assert.equal(rows[2].off, true);
  // 月全体なら 10/20 も含む
  assert.equal(monthSales(recs, 2026, 10, sg).total.amount, 17500 + 7500);
  // 日極
  const dl = { ...settings, salesType: 'daily', dailyRate: '15000' };
  assert.equal(monthSales(recs, 2026, 10, dl, '2026-10-13').total.amount, 30000);
});

test('希望する前払い額は月ごと', async () => {
  const { advanceOf, advanceKey } = await import('../js/sales.js');
  assert.equal(advanceKey(2026, 9), '2026-09');
  const s = { advance: { '2026-10': 50000, '2026-09': '' } };
  assert.equal(advanceOf(s, 2026, 10), 50000);
  assert.equal(advanceOf(s, 2026, 9), null);
  assert.equal(advanceOf({}, 2026, 10), null);
});

test('川口（DRF）は個数の金額に1日10,000円を足す', async () => {
  const { unitPrices, monthSales } = await import('../js/sales.js');
  const drf = { salesType: 'sagawa', salesOffice: '川口（DRF）' };
  assert.deepEqual(unitPrices(drf), { takuhai: 167, shogyo: 100, shuka: 100, daily: 10000 });
  assert.equal(unitPrices({ salesType: 'sagawa', salesOffice: '川口' }).daily, 0);
  const recs = [
    { date: '2026-10-01', start: { time: '8:00' }, end: { time: '18:00' }, sales: { takuhai: 100 } },
    { date: '2026-10-02', start: { time: '8:00' }, end: { time: '18:00' } }
  ];
  const { total, rows } = monthSales(recs, 2026, 10, drf, '2026-10-13');
  // 1日目：100個×167円＋10,000円、2日目：個数まだでも10,000円
  assert.equal(rows[0].amount, 26700);
  assert.equal(rows[1].amount, 10000);
  assert.equal(rows[1].missing, true);
  assert.equal(total.amount, 36700);
  assert.equal(total.missing, 1);
});

test('走行距離を入れなかった過去の日は自動で休み（今日は休みにしない）', async () => {
  const { isOffDay } = await import('../js/model.js');
  assert.equal(isOffDay(undefined, '2026-10-05', '2026-10-06'), true);
  assert.equal(isOffDay(undefined, '2026-10-06', '2026-10-06'), false);
  assert.equal(isOffDay({ date: '2026-10-05', start: { time: '7:00' }, end: null }, '2026-10-05', '2026-10-06'), false); // 乗務後まだは休みではない
  const csv = toCsv(records, '2026-10-01', '2026-10-31', '2026-10-06').trim().split('\r\n').map((l) => l.split(',')[0]);
  assert.deepEqual(csv.slice(1), ['2026/10/01', '2026/10/02', '2026/10/03', '2026/10/04', '2026/10/05']);
  const { monthSales } = await import('../js/sales.js');
  const { rows } = monthSales(records, 2026, 10, { salesType: 'daily', dailyRate: '10000' }, '2026-10-06', '2026-10-06');
  assert.equal(rows[2].off, true);
  assert.equal(rows[6].off, false);
});

test('八王子の新人保証（稼働開始から1か月は1日5,000円）と八王子（代走）', async () => {
  const { unitPrices, newbiePeriod, dayBonus, monthSales } = await import('../js/sales.js');
  const hj = { salesType: 'sagawa', salesOffice: '八王子', salesStartDate: '2026-10-13' };
  assert.deepEqual(newbiePeriod(hj), { from: '2026-10-13', to: '2026-11-12', perDay: 5000 });
  assert.equal(newbiePeriod({ ...hj, salesStartDate: '2026-01-31' }).to, '2026-02-27'); // 月末をまたぐとき
  assert.equal(newbiePeriod({ ...hj, salesStartDate: '' }), null); // 開始日がなければ保証なし
  assert.equal(newbiePeriod({ ...hj, salesOffice: '湘南' }), null); // 保証のない営業所
  assert.equal(dayBonus(hj, '2026-10-12'), 0);
  assert.equal(dayBonus(hj, '2026-10-13'), 5000);
  assert.equal(dayBonus(hj, '2026-11-12'), 5000);
  assert.equal(dayBonus(hj, '2026-11-13'), 0);
  // 代走：宅配190円、商業・集荷は八王子と同じ、新人保証なし
  const dai = { salesType: 'sagawa', salesOffice: '八王子（代走）', salesStartDate: '2026-10-13' };
  assert.deepEqual(unitPrices(dai), { takuhai: 190, shogyo: 80, shuka: 100, daily: 0 });
  assert.equal(newbiePeriod(dai), null);
  // 売上：保証期間の日は個数の金額＋5,000円、個数がまだでも5,000円
  const recs = [
    { date: '2026-11-12', start: { time: '8:00' }, end: { time: '18:00' }, sales: { takuhai: 100 } },
    { date: '2026-11-13', start: { time: '8:00' }, end: { time: '18:00' }, sales: { takuhai: 100 } },
    { date: '2026-11-11', start: { time: '8:00' }, end: { time: '18:00' } }
  ];
  const { rows, total } = monthSales(recs, 2026, 11, hj, '2026-11-30', '2026-12-01');
  assert.equal(rows[11].amount, 100 * 178 + 5000);
  assert.equal(rows[12].amount, 100 * 178);
  assert.equal(rows[10].amount, 5000);
  assert.equal(total.amount, 17800 * 2 + 10000);
  // 新人保証の分（表の「新人保証」の列）
  assert.equal(rows[11].newbie, 5000);
  assert.equal(rows[12].newbie, 0);
  assert.equal(total.newbie, 10000);
  assert.equal(monthSales(recs, 2026, 11, hj, '2026-11-30', '2026-12-01').hasNewbie, true);
  assert.equal(monthSales(recs, 2026, 12, hj, null, '2027-01-01').hasNewbie, false);
  assert.equal(monthSales(recs, 2026, 11, dai, null, '2026-12-01').hasNewbie, false);
});

test('三多摩の新人保証は2週間・1日5,000円、山単価は保証なし', async () => {
  const { newbiePeriod, dayBonus, newbieSpan, officeEntry } = await import('../js/sales.js');
  const tm = { salesType: 'sagawa', salesOffice: '三多摩', salesStartDate: '2026-10-13' };
  assert.deepEqual(newbiePeriod(tm), { from: '2026-10-13', to: '2026-10-26', perDay: 5000 });
  assert.equal(dayBonus(tm, '2026-10-26'), 5000);
  assert.equal(dayBonus(tm, '2026-10-27'), 0);
  assert.equal(newbiePeriod({ ...tm, salesStartDate: '2026-12-25' }).to, '2027-01-07'); // 年をまたぐ
  assert.equal(newbiePeriod({ ...tm, salesOffice: '三多摩（山単価）' }), null);
  assert.equal(newbiePeriod({ ...tm, salesOffice: '三多摩B' }).to, '2026-10-26'); // 三多摩Bは三多摩として扱う
  assert.equal(newbieSpan(officeEntry('三多摩').newbie), '2週間');
  assert.equal(newbieSpan(officeEntry('八王子').newbie), '1か月間');
});

test('各営業所の新人保証と代走', async () => {
  const { newbiePeriod, unitPrices, dayBonus } = await import('../js/sales.js');
  const nb = (office, start = '2026-10-13') => newbiePeriod({ salesType: 'sagawa', salesOffice: office, salesStartDate: start });
  for (const o of ['世田谷', '城北', '赤羽']) assert.deepEqual(nb(o), { from: '2026-10-13', to: '2027-01-12', perDay: 3000 });
  assert.deepEqual(nb('練馬'), { from: '2026-10-13', to: '2026-11-12', perDay: 5000 });
  for (const o of ['東京', '所沢']) assert.deepEqual(nb(o), { from: '2026-10-13', to: '2026-11-12', perDay: 3000 });
  // 代走は新人保証なし。所沢（代走）は1日5,000円、戸田（代走）は1日10,000円をずっと足す
  const so = { salesType: 'sagawa', salesOffice: '所沢（代走）', salesStartDate: '2026-10-13' };
  assert.equal(nb('所沢（代走）'), null);
  assert.deepEqual(unitPrices(so), { takuhai: 180, shogyo: 100, shuka: 100, daily: 5000 });
  assert.equal(dayBonus(so, '2027-06-01'), 5000);
  assert.deepEqual(unitPrices({ salesType: 'sagawa', salesOffice: '杉並（代走）' }), { takuhai: 191, shogyo: 100, shuka: 100, daily: 0 });
  assert.deepEqual(unitPrices({ salesType: 'sagawa', salesOffice: '戸田（代走）' }), { takuhai: 167, shogyo: 100, shuka: 100, daily: 10000 });
  assert.equal(unitPrices({ salesType: 'sagawa', salesOffice: '戸田' }).daily, 10000); // 以前の「戸田」も代走として扱う
});

test('前払いの履歴と合計（月ごと）', async () => {
  const { advanceHistory, advanceTotal } = await import('../js/sales.js');
  const s = { advanceHistory: { '2026-10': [{ id: 'b', date: '2026-10-20', amount: 30000 }, { id: 'a', date: '2026-10-05', amount: 50000 }], '2026-09': [{ id: 'c', date: '2026-09-10', amount: 70000 }] } };
  assert.deepEqual(advanceHistory(s, 2026, 10).map((a) => a.id), ['a', 'b']);
  assert.equal(advanceTotal(s, 2026, 10), 80000);
  assert.equal(advanceTotal(s, 2026, 9), 70000);
  assert.equal(advanceTotal(s, 2026, 11), 0);
  assert.equal(advanceTotal({}, 2026, 10), 0);
});

test('前払いの対象額：留保額と50%', async () => {
  const { advanceLimit, isFirstAdvanceMonth } = await import('../js/sales.js');
  // はじめて：リース車両は10万円、車両持ち込みは6万円を留保
  assert.deepEqual(advanceLimit({ sales: 300000, prevSales: null, first: true, lease: true }), { reserve: 100000, reason: 'はじめての前払い（リース車両）', base: 200000, half: 100000, exact: 100000, target: 100000 });
  assert.equal(advanceLimit({ sales: 300000, prevSales: null, first: true, lease: false }).target, 120000);
  // 2回目以降：前月40万円以上は留保なし、未満・記録なしは5万円
  assert.equal(advanceLimit({ sales: 300000, prevSales: 400000, first: false }).target, 150000);
  assert.equal(advanceLimit({ sales: 300000, prevSales: 399999, first: false }).target, 125000);
  assert.equal(advanceLimit({ sales: 300000, prevSales: null, first: false }).reserve, 50000);
  // リース車両も、2か月目以降（前月の売上が40万円未満・記録なし）は5万円を留保
  assert.equal(advanceLimit({ sales: 300000, prevSales: 399999, first: false, lease: true }).reserve, 50000);
  assert.equal(advanceLimit({ sales: 300000, prevSales: null, first: false, lease: true }).target, 125000);
  assert.equal(advanceLimit({ sales: 300000, prevSales: 400000, first: false, lease: true }).reserve, 0);
  // 前払い可能額 ＝（売上 − 留保）× 50% − すでに受けた前払い：（304,000 − 100,000）× 50% − 20,000 ＝ 82,000
  assert.equal(advanceLimit({ sales: 304000, advanced: 20000, prevSales: null, first: true, lease: true }).target, 82000);
  // 前払いが50%を超えていたら0
  assert.equal(advanceLimit({ sales: 300000, advanced: 200000, prevSales: 500000, first: false }).target, 0);
  // 売上が留保額より少なければ0
  assert.equal(advanceLimit({ sales: 40000, prevSales: null, first: true, lease: false }).target, 0);
  assert.equal(advanceLimit({ sales: 100001, prevSales: 500000, first: false }).target, 50000); // 千円未満は切り捨て
  // 例：（348,460 − 100,000）× 50% − 20,000 ＝ 104,230 → 104,000円
  assert.equal(advanceLimit({ sales: 348460, advanced: 20000, prevSales: null, first: true, lease: true }).target, 104000);
  // はじめての月の判断
  const h = { advanceHistory: { '2026-09': [{ id: 'a', date: '2026-09-10', amount: 10000 }] } };
  assert.equal(isFirstAdvanceMonth(h, 2026, 9), true); // 9月が最初の前払いの月
  assert.equal(isFirstAdvanceMonth(h, 2026, 10), false);
  assert.equal(isFirstAdvanceMonth({}, 2026, 10), true);
  // 以前から稼働していて前月の売上を選んだ方は、はじめてではない
  assert.equal(isFirstAdvanceMonth({ prevSalesLevel: 'over', prevSalesMonth: '2026-09' }, 2026, 10), false);
  assert.equal(isFirstAdvanceMonth({ prevSalesLevel: 'over', prevSalesMonth: '2026-08' }, 2026, 10), true); // 選んだ月が古ければ使わない
  // 稼働を開始した月だけがはじめての留保の対象（2か月サイトのため、翌月以降は留保なし）
  const st = { salesStartDate: '2026-10-13' };
  assert.equal(isFirstAdvanceMonth(st, 2026, 10), true);
  assert.equal(isFirstAdvanceMonth(st, 2026, 11), false);
  assert.equal(isFirstAdvanceMonth({ ...st, advanceHistory: { '2026-10': [{ id: 'a', date: '2026-10-20', amount: 10000 }] } }, 2026, 10), true);
  assert.equal(isFirstAdvanceMonth({ salesStartDate: '2026-08-01' }, 2026, 10), false);
});

test('このアプリを使う前に受けた前払い：入れた月の合計に入る', async () => {
  const { advanceHistory, advanceTotal } = await import('../js/sales.js');
  const s = { priorAdvance: '20000', priorAdvanceMonth: '2026-10', advanceHistory: { '2026-10': [{ id: 'a', date: '2026-10-20', amount: 30000 }] } };
  assert.equal(advanceTotal(s, 2026, 10), 50000);
  assert.equal(advanceHistory(s, 2026, 10)[0].prior, true);
  assert.equal(advanceTotal(s, 2026, 11), 0); // 次の月には入らない
});

test('前月の記録がないとき：設定で選んだ前月の売上で留保を決める', async () => {
  const { advanceLimit } = await import('../js/sales.js');
  assert.equal(advanceLimit({ sales: 300000, prevSales: null, prevLevel: 'over', first: false, lease: true }).reserve, 0);
  assert.equal(advanceLimit({ sales: 300000, prevSales: null, prevLevel: 'under', first: false, lease: false }).reserve, 50000);
  assert.equal(advanceLimit({ sales: 300000, prevSales: null, prevLevel: 'under', first: false, lease: true }).reserve, 50000);
  // アプリに前月の記録があれば、記録の売上を使う
  assert.equal(advanceLimit({ sales: 300000, prevSales: 300000, prevLevel: 'over', first: false }).reserve, 50000);
});

test('数字：全角・カンマ入りも読む', async () => {
  const { num } = await import('../js/model.js');
  assert.equal(num('２００００'), 20000);
  assert.equal(num('20,000'), 20000);
  assert.equal(num(''), null);
  assert.equal(num('abc'), null);
});

test('法人（日極）：その日に選んだ案件の金額の合計', async () => {
  const { dayAmount, countsMissing, jobsOf, monthSales } = await import('../js/sales.js');
  const s = { salesType: 'daily', jobs: [{ id: 'a', name: 'チャーター便', price: '' }, { id: 'b', name: '医薬品配達', price: 9000 }, { id: 'c', name: '', price: '' }] };
  assert.equal(jobsOf(s).length, 2); // 名前のない行は数えない
  const start = { time: '08:00' };
  const rec = { date: '2026-10-01', start, jobs: [{ name: 'チャーター便', amount: 15000, memo: '横浜' }, { name: '医薬品配達', amount: 9000 }] };
  assert.equal(dayAmount(rec, s), 24000);
  assert.equal(countsMissing(rec, s), false);
  // 金額が空の案件があれば「金額まだ」（入っている分だけ数える）
  const rec2 = { date: '2026-10-02', start, jobs: [{ name: 'チャーター便', amount: null }, { name: '医薬品配達', amount: 9000 }] };
  assert.equal(dayAmount(rec2, s), 9000);
  assert.equal(countsMissing(rec2, s), true);
  // 案件を選んでいない日は、案件が2つ以上なら売上なし（金額まだ）
  const rec3 = { date: '2026-10-03', start };
  assert.equal(dayAmount(rec3, s), null);
  assert.equal(countsMissing(rec3, s), true);
  const t = monthSales([rec, rec2, rec3], 2026, 10, s, '2026-10-31', '2026-10-31').total;
  assert.equal(t.amount, 33000);
  assert.equal(t.missing, 2);
});

test('法人（日極）：以前の版の「所属・日極」は1つ目の案件として読む', async () => {
  const { dayAmount, jobsOf, jobLabel } = await import('../js/sales.js');
  const s = { salesType: 'daily', salesProject: 'Amazon', dailyRate: 19000, jobs: [] };
  assert.deepEqual(jobsOf(s).map(jobLabel), ['Amazon']);
  assert.equal(dayAmount({ date: '2026-10-01', start: { time: '08:00' } }, s), 19000);
});


test('前月の売上「なし」：はじめて稼働する方は、はじめての前払いの留保のまま', async () => {
  const { prevSalesLevel, isFirstAdvanceMonth } = await import('../js/sales.js');
  const s = { prevSalesLevel: 'none', prevSalesMonth: '2026-09', salesStartDate: '2026-10-01' };
  assert.equal(prevSalesLevel(s, 2026, 10), null); // 留保の判断には使わない
  assert.equal(isFirstAdvanceMonth(s, 2026, 10), true);
});

test('案件をまとめて登録：佐川急便と法人（日極・単価）を1日に組み合わせる', async () => {
  const { dayAmount, countsMissing, monthSales, jobLabel, jobsOf } = await import('../js/sales.js');
  const s = { salesStartDate: '2026-09-01', jobs: [
    { id: 's', kind: 'sagawa', office: '八王子', startDate: '2026-09-01' },
    { id: 'c', kind: 'corp', company: '○○運送', branch: '△△営業所', pay: 'unit', units: [{ label: '宅配', price: '170' }, { label: 'ネコポス', price: '40' }, { label: '', price: '' }] },
    { id: 'd', kind: 'corp', company: '□□便', branch: '', pay: 'daily', price: '' }
  ] };
  assert.deepEqual(jobsOf(s).map(jobLabel), ['佐川急便 八王子営業所', '○○運送 △△営業所', '□□便']);
  const start = { time: '07:00' };
  // 朝は法人の単価（宅配10個・ネコポス20個）、午後は佐川急便（宅配50・商業1・集荷2）
  const rec = { date: '2026-10-05', start, jobs: [{ id: 'c', counts: [10, 20] }, { id: 's', counts: { takuhai: 50, shogyo: 1, shuka: 2 } }] };
  assert.equal(dayAmount(rec, s), 10 * 170 + 20 * 40 + (50 * 178 + 1 * 80 + 2 * 100));
  assert.equal(countsMissing(rec, s), false);
  // 日極の金額が空なら入力まだ
  const rec2 = { date: '2026-10-06', start, jobs: [{ id: 'd', amount: null }] };
  assert.equal(countsMissing(rec2, s), true);
  // 佐川急便の個数は、表の宅配・商業・集荷に数える（法人の分は数えない）
  const t = monthSales([rec, rec2], 2026, 10, s, '2026-10-31', '2026-10-31').total;
  assert.equal(t.takuhai, 50);
  assert.equal(t.missing, 1);
});

test('以前の版の佐川急便の設定と配達個数は、そのまま数える', async () => {
  const { dayAmount, jobsOf } = await import('../js/sales.js');
  const s = { salesType: 'sagawa', salesOffice: '八王子', salesStartDate: '2026-09-01', jobs: [] };
  assert.equal(jobsOf(s).length, 1);
  const rec = { date: '2026-10-05', start: { time: '07:00' }, sales: { takuhai: 100, shogyo: 1, shuka: 2 } };
  assert.equal(dayAmount(rec, s), 100 * 178 + 80 + 200);
});

test('以前の版の佐川急便の記録は、あとから法人の案件を足しても佐川急便の分として数える', async () => {
  const { dayAmount, jobsOf } = await import('../js/sales.js');
  const s = { salesType: 'sagawa', salesStartDate: '2026-09-01', jobs: [
    { id: 'job-sagawa', kind: 'sagawa', office: '八王子' },
    { id: 'c', kind: 'corp', company: '○○運送', pay: 'daily', price: '15000' }
  ] };
  assert.equal(jobsOf(s).length, 2);
  const rec = { date: '2026-10-20', start: { time: '07:00' }, sales: { takuhai: 100, shogyo: 1, shuka: 2 } };
  assert.equal(dayAmount(rec, s), 100 * 178 + 80 + 200);
});


test('月末のバックアップのお知らせ：月末の3日前から翌月5日まで、作るまで出す', () => {
  assert.equal(backupReminder('2026-10-28', {}), null);
  assert.equal(backupReminder('2026-10-29', {}), '2026-10');
  assert.equal(backupReminder('2026-10-31', {}), '2026-10');
  assert.equal(backupReminder('2026-11-03', {}), '2026-10');
  assert.equal(backupReminder('2026-11-06', {}), null);
  assert.equal(backupReminder('2027-01-02', {}), '2026-12');
  assert.equal(backupReminder('2026-02-26', {}), '2026-02'); // 2月は28日まで
  assert.equal(backupReminder('2026-10-30', { lastBackup: '2026-10-29' }), null);
  assert.equal(backupReminder('2026-11-02', { lastBackup: '2026-10-20' }), '2026-10');
  assert.equal(backupReminder('2026-10-30', { backupLater: '2026-10-30' }), null);
  assert.equal(backupReminder('2026-10-31', { backupLater: '2026-10-30' }), '2026-10');
});
