// 招待コード：所属ドライバーだけが使えるようにする
// 会社のパソコンの「招待コード発行.html」が、秘密の鍵で「番号と名前」に署名して 1人ずつのコードを作る。
// アプリは、下の公開鍵で署名を確かめるだけ（秘密の鍵はアプリにもGitHubにも置かない）。
// 運転者名は招待の名前に固定する（リンクを人に回しても、日報には招待された人の名前が出る）
// コードの形：「番号.名前（UTF-8 を base64url）.署名」。招待リンクは …/nissapo/?openExternalBrowser=1#invite=コード

export const PUBLIC_KEY = { kty: 'EC', crv: 'P-256', x: '5ANXpJWCUbeomfcuZApTIe0N9tIrwubXT-JZQBF8xjY', y: '-WF080IFphEmoz3cKy8BjKrxFfEfgYzyj1fkQQxWJZg' };

// 辞めた方の番号（ここに足してアプリを更新すると、その人は新しい記録をつけられなくなる。書き出しはできる）
export const REVOKED = [];

export const INVITE_URL = 'https://sioux1225.github.io/nissapo/';

// 署名するときの文（発行ページと同じにする）
export const inviteMessage = (no, name) => `nissapo-invite:${no}:${name}`;

function fromB64url(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
const toB64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const encodeName = (name) => toB64url(new TextEncoder().encode(name));

// 貼り付けられた文（招待リンクそのもの、前後の空白・改行・送る文ごとでもよい）からコードを取り出す
export function parseInvite(text) {
  const s = String(text ?? '').replace(/\s+/g, '');
  const m = s.match(/(\d{1,6})\.([A-Za-z0-9_-]{2,400})\.([A-Za-z0-9_-]{86})/);
  if (!m) return null;
  let name;
  try { name = new TextDecoder('utf-8', { fatal: true }).decode(fromB64url(m[2])); } catch { return null; }
  return name.trim() ? { no: Number(m[1]), name, sig: m[3], code: `${m[1]}.${m[2]}.${m[3]}` } : null;
}

// 正しいコードなら { no, name, code }、違えば null
export async function verifyInvite(text, jwk = PUBLIC_KEY) {
  const p = parseInvite(text);
  if (!p || !p.no) return null;
  try {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, fromB64url(p.sig), new TextEncoder().encode(inviteMessage(p.no, p.name)));
    return ok ? { no: p.no, name: p.name, code: p.code } : null;
  } catch {
    return null;
  }
}

// { status, no, name }。status は 'ok'（使える）・'none'（コードがない・正しくない）・'revoked'（止めた番号）
export async function inviteStatus(code, { revoked = REVOKED, jwk = PUBLIC_KEY } = {}) {
  const v = code ? await verifyInvite(code, jwk) : null;
  if (!v) return { status: 'none', no: 0, name: '' };
  return { status: revoked.includes(v.no) ? 'revoked' : 'ok', no: v.no, name: v.name };
}
