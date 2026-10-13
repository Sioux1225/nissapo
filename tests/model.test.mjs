import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, newStart, newEnd, prevOdo, monthSheets, yearSheets, toCsv, timeToSerial, distanceOf } from '../js/model.js';
import { buildXlsx, colName, sheetXml } from '../js/xlsx.js';
import { buildPdf } from '../js/pdf.js';

const settings = { ...DEFAULT_SETTINGS, driverName: '伊藤 孝', office: '八王子', startPlace: '八王子営業所', via: '中沢1,2、唐木田1', restPlace: '唐木田1-21-1', rollcaller: '神野', initialOdo: 56000 };

function rec(date, s, e, a, b) {
  return {
    date, rollcaller: '神野',
    start: { ...newStart(settings, a, s) },
    end: e ? { ...newEnd(settings, e), odo: b } : null
  };
}

const records = [
  rec('2026-10-01', '7:20', '19:55', 56000, 56110),
  rec('2026-10-02', '7:05', '20:01', 56110, 56230),
  rec('2026-10-05', '7:30', null, 56230)
];

test('時刻をExcelの値にする', () => {
  assert.equal(timeToSerial('12:00'), 0.5);
  assert.equal(timeToSerial('7:20'), 440 / 1440);
});

test('前の日の終了距離を次の開始距離にする', () => {
  assert.equal(prevOdo(records, '2026-10-03', settings), 56230);
  assert.equal(prevOdo(records, '2026-10-06', settings), 56230); // 乗務後がない日は開始距離
  assert.equal(prevOdo(records, '2026-09-30', settings), 56000); // 記録がなければ設定の距離
  assert.equal(distanceOf(records[0]), 110);
});

test('運転日報・点呼記録簿の行が事務所のブックと同じ列になる', () => {
  const [daily, roll] = monthSheets(records, 2026, 10, settings);
  assert.equal(daily.name, '運転日報10月');
  assert.equal(roll.name, '点呼記録簿10月');
  assert.equal(daily.rows.length, 31);
  assert.deepEqual(daily.rows[0], [1, '八王子営業所', { time: '7:20' }, '八王子営業所', { time: '19:55' }, '中沢1,2、唐木田1', 56000, 56110, 110, '唐木田1-21-1', 60, '無', '有', '無', '無', '無']);
  assert.deepEqual(roll.rows[0], [1, { time: '7:20' }, 'LINE', '有', '無', '良好', '良好', '無', { time: '19:55' }, 'LINE', '有', '無', '無', '無', '神野', null]);
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
  assert.match(x, /<c r="H4" s="6"><f>SUM\(G4,I4\)<\/f><v>56110<\/v><\/c>/);
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
  assert.ok(lines[1].startsWith('2026/10/01,八王子営業所,7:20,八王子営業所,19:55,"中沢1,2、唐木田1",56000,56110,110,'));
  assert.ok(lines[1].endsWith(',神野'));
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
