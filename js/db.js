// 端末内データベース（IndexedDB）。外部には一切送信しない。
// records: 1日1件（キーは日付 'YYYY-MM-DD'） / settings: 設定（1件） / accidents: 事故の記録 / photos: 事故の写真

import { DEFAULT_SETTINGS } from './model.js';

const DB_NAME = 'nippo';
const DB_VERSION = 3;
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      // v2：事故の記録
      if (!db.objectStoreNames.contains('accidents')) db.createObjectStore('accidents', { keyPath: 'id' });
      // v3：事故の写真（どの事故の写真かで探せるようにする）
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' }).createIndex('accidentId', 'accidentId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(stores, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const req = fn(tx);
    let result;
    if (req && 'onsuccess' in req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const db = {
  allRecords: () => run('records', 'readonly', (tx) => tx.objectStore('records').getAll()),
  putRecord: (r) => run('records', 'readwrite', (tx) => tx.objectStore('records').put({ ...r, updatedAt: new Date().toISOString() })),
  deleteRecord: (date) => run('records', 'readwrite', (tx) => tx.objectStore('records').delete(date)),
  putRecords: (list) => run('records', 'readwrite', (tx) => {
    const store = tx.objectStore('records');
    for (const r of list) store.put(r);
  }),

  allAccidents: () => run('accidents', 'readonly', (tx) => tx.objectStore('accidents').getAll()),
  putAccident: (a) => run('accidents', 'readwrite', (tx) => tx.objectStore('accidents').put({ ...a, updatedAt: new Date().toISOString() })),
  deleteAccident: (id) => run('accidents', 'readwrite', (tx) => tx.objectStore('accidents').delete(id)),
  putAccidents: (list) => run('accidents', 'readwrite', (tx) => {
    const store = tx.objectStore('accidents');
    for (const a of list) store.put(a);
  }),

  photosOf: (accidentId) => run('photos', 'readonly', (tx) => tx.objectStore('photos').index('accidentId').getAll(accidentId)),
  allPhotos: () => run('photos', 'readonly', (tx) => tx.objectStore('photos').getAll()),
  putPhoto: (p) => run('photos', 'readwrite', (tx) => tx.objectStore('photos').put(p)),
  putPhotos: (list) => run('photos', 'readwrite', (tx) => {
    const store = tx.objectStore('photos');
    for (const p of list) store.put(p);
  }),
  deletePhoto: (id) => run('photos', 'readwrite', (tx) => tx.objectStore('photos').delete(id)),
  deletePhotos: (ids) => run('photos', 'readwrite', (tx) => {
    const store = tx.objectStore('photos');
    for (const id of ids) store.delete(id);
  }),
  // 写真の一覧 [{ id, accidentId }]（画像そのものは読まない）
  async photoIndex() {
    const dbh = await openDb();
    return new Promise((resolve, reject) => {
      const out = [];
      const req = dbh.transaction('photos').objectStore('photos').index('accidentId').openKeyCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) { resolve(out); return; }
        out.push({ id: c.primaryKey, accidentId: c.key });
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },

  async getSettings() {
    const s = await run('settings', 'readonly', (tx) => tx.objectStore('settings').get('settings'));
    return { ...DEFAULT_SETTINGS, ...(s || {}) };
  },
  putSettings: (s) => run('settings', 'readwrite', (tx) => tx.objectStore('settings').put(s, 'settings'))
};

// スマホの空き容量が少ないときに、ブラウザがデータを消さないようにお願いする
export async function requestPersist() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* 対応していないブラウザでは何もしない */ }
}
