import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, newStart, newEnd, prevOdo, monthSheets, yearSheets, toCsv, timeToSerial, distanceOf } from '../js/model.js';
import { buildXlsx, colName, sheetXml } from '../js/xlsx.js';
import { buildPdf } from '../js/pdf.js';

const settings = { ...DEFAULT_SETTINGS, driverName: '配送 太郎', office: '○○', startPlace: '○○営業所', via: '○○町1,2丁目、△△町', restPlace: '○○公園駐車場', rollcaller: '運行 花子', initialOdo: 12000 };

function rec(date, s, e, a, b) {
  return {
    date, rollcaller: '運行 花子',
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
  const [daily, roll] = monthSheets(records, 2026, 10, settings);
  assert.equal(daily.name, '運転日報10月');
  assert.equal(roll.name, '点呼記録簿10月');
  assert.equal(daily.rows.length, 31);
  assert.deepEqual(daily.rows[0], [1, '○○営業所', { time: '7:20' }, '○○営業所', { time: '19:55' }, '○○町1,2丁目、△△町', 12000, 12110, 110, '○○公園駐車場', 60, '無', '有', '無', '無', '無']);
  assert.deepEqual(roll.rows[0], [1, { time: '7:20' }, 'LINE', '有', '無', '良好', '良好', '無', { time: '19:55' }, 'LINE', '有', '無', '無', '無', '運行 花子', null]);
  // 休みの日は空欄
  assert.deepEqual(daily.rows[2].slice(1), Array(15).fill(null));
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
  const csv = toCsv(records, '2026-10-01', '2026-10-31');
  assert.ok(csv.startsWith('﻿日付,'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 4);
  assert.ok(lines[1].startsWith('2026/10/01,○○営業所,7:20,○○営業所,19:55,"○○町1,2丁目、△△町",12000,12110,110,'));
  assert.ok(lines[1].endsWith(',運行 花子'));
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

test('売上表：佐川急便は個数×単価、日当は乗務した日×日当、月初めから今日まで', async () => {
  const { monthSales, dayAmount, unitPrices, salesReady } = await import('../js/sales.js');
  const sg = { ...settings, salesType: 'sagawa', salesOffice: '○○営業所', priceTakuhai: '150', priceShogyo: '150', priceShuka: '50' };
  assert.deepEqual(unitPrices(sg), { takuhai: 150, shogyo: 150, shuka: 50 });
  // 商業・集荷の決まった単価：商業100円（三多摩・八王子80円）、集荷100円（台東70円）
  const base = { salesType: 'sagawa', priceTakuhai: '150', priceShogyo: '', priceShuka: '' };
  assert.deepEqual(unitPrices({ ...base, salesOffice: '練馬営業所' }), { takuhai: 150, shogyo: 100, shuka: 100 });
  assert.deepEqual(unitPrices({ ...base, salesOffice: '八王子営業所' }), { takuhai: 150, shogyo: 80, shuka: 100 });
  assert.deepEqual(unitPrices({ ...base, salesOffice: '三多摩' }), { takuhai: 150, shogyo: 80, shuka: 100 });
  assert.deepEqual(unitPrices({ ...base, salesOffice: '台東営業所' }), { takuhai: 150, shogyo: 100, shuka: 70 });
  assert.deepEqual(unitPrices({ ...base, salesOffice: '台東営業所', priceShuka: '90' }).shuka, 90);
  assert.equal(salesReady(sg), true);
  assert.equal(salesReady({ ...settings, salesType: 'daily', dailyRate: '' }), false);
  const recs = [
    { date: '2026-09-30', start: { time: '7:00', odo: 100 }, end: { time: '19:00', odo: 200 }, sales: { takuhai: 100 } },
    { date: '2026-10-01', start: { time: '7:00', odo: 200 }, end: { time: '19:00', odo: 300 }, sales: { takuhai: 100, shogyo: 10, shuka: 20 } },
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
  // 日当
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
