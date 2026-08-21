const crypto = require('crypto');
const prisma = require('./db');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(String(password), salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
  } catch {
    return false;
  }
}

async function generateUid() {
  // Реальный Bybit UID — обычно 8 цифр (иногда 7–10 у старых/новых аккаунтов).
  // Генерируем ровно 8 цифр, без ведущего нуля.
  for (let i = 0; i < 40; i++) {
    let uid = String(Math.floor(Math.random() * 9) + 1);
    while (uid.length < 8) {
      uid += String(Math.floor(Math.random() * 10));
    }
    const exists = await prisma.user.findUnique({ where: { uid } });
    if (!exists) return uid;
  }
  return String(10000000 + (Date.now() % 89999999));
}

module.exports = { hashPassword, verifyPassword, generateUid };
