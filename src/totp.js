const crypto = require('crypto');

const ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPH[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPH[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPH.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(bin % 1e6).padStart(6, '0');
}

function totpNow(secret, at = Date.now()) {
  return hotp(secret, Math.floor(at / 1000 / 30));
}

function verifyTotp(secret, token, window = 1) {
  const code = String(token || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code) || !secret) return false;
  const now = Math.floor(Date.now() / 1000 / 30);
  const want = Buffer.from(code);
  for (let i = -window; i <= window; i++) {
    const got = Buffer.from(hotp(secret, now + i));
    if (got.length === want.length && crypto.timingSafeEqual(got, want)) return true;
  }
  return false;
}

function encKey() {
  return crypto.scryptSync(String(process.env.BOT_TOKEN || 'dev-totp-key'), 'byx-totp-v1', 32);
}

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decryptSecret(stored) {
  if (!stored || !String(stored).includes(':')) return null;
  try {
    const [ivH, tagH, dataH] = String(stored).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(ivH, 'hex'));
    decipher.setAuthTag(Buffer.from(tagH, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataH, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function otpauthUrl({ secret, account, issuer = 'Bybit Wallet' }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}

function makeBackupCodes(n = 8) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    codes.push(crypto.randomBytes(5).toString('hex'));
  }
  return codes;
}

module.exports = {
  generateSecret,
  verifyTotp,
  totpNow,
  encryptSecret,
  decryptSecret,
  otpauthUrl,
  makeBackupCodes,
};
