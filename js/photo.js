// 事故の記録の写真：縮小してスマホの中に保存する（外部には送らない）

const MAX_SIDE = 1600;  // 長い辺のピクセル数（現場の様子・車の傷が分かる大きさ）
const QUALITY = 0.82;

// 撮った・選んだ画像を縮小して JPEG にする（スマホの向きの情報も反映）
export async function shrinkImage(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('写真を読み込めませんでした'))), 'image/jpeg', QUALITY);
  });
}

export function newPhoto(accidentId, blob) {
  return {
    id: `pho-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    accidentId,
    createdAt: new Date().toISOString(),
    blob
  };
}

// バックアップ用（JSON に入れるため文字にする）
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(url) {
  return (await fetch(url)).blob();
}
