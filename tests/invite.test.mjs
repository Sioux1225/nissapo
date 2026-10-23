import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { parseInvite, verifyInvite, inviteStatus, inviteMessage, PUBLIC_KEY } from '../js/invite.js';

// 発行ページと同じやり方でコードを作る（テスト用の鍵）
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
const issue = async (no) => `${no}.${b64url(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(inviteMessage(no))))}`;

test('招待コード：正しいコード・リンク・送る文ごと貼り付けても通る', async () => {
  const code = await issue(12);
  assert.deepEqual(await verifyInvite(code, jwk), { no: 12, code });
  assert.equal((await verifyInvite(`https://sioux1225.github.io/nissapo/#invite=${code}`, jwk)).no, 12);
  assert.equal((await verifyInvite(`見本 太郎さん\n招待リンクです\n https://x/#invite=${code.slice(0, 40)}\n${code.slice(40)} `, jwk)).no, 12);
});

test('招待コード：番号を書きかえたもの・ほかの鍵・でたらめは通らない', async () => {
  const code = await issue(12);
  assert.equal(await verifyInvite(code.replace(/^12/, '13'), jwk), null);
  assert.equal(await verifyInvite(code, PUBLIC_KEY), null);
  assert.equal(await verifyInvite('12.abc', jwk), null);
  assert.equal(await verifyInvite('', jwk), null);
  assert.equal(parseInvite('こんにちは'), null);
});

test('招待コード：止めた番号は revoked、ないときは none', async () => {
  assert.equal(await inviteStatus(await issue(3), { jwk, revoked: [] }), 'ok');
  assert.equal(await inviteStatus(await issue(3), { jwk, revoked: [3] }), 'revoked');
  assert.equal(await inviteStatus(await issue(4), { jwk, revoked: [3] }), 'ok');
  assert.equal(await inviteStatus('', { jwk }), 'none');
});
