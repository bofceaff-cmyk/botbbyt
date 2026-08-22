const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const prisma = require('../db');
const { upload, absolutePath } = require('../upload');
const { hashPassword, verifyPassword, generateUid } = require('../password');
const { issueSession, clearSession, hashToken, newToken } = require('../session');
const {
  generateSecret, verifyTotp, encryptSecret, decryptSecret, otpauthUrl, makeBackupCodes,
} = require('../totp');
const { qrSvg } = require('../qr');
const { banMessage, transfersBlocked, conversionsBlocked, transferMessage, convertMessage } = require('../restrictions');
const MSG = require('../messages');

const router = express.Router();

const NETWORKS = {
  USDT: [
    { network: 'TRC20', label: 'TRC-20 (TRON)' },
    { network: 'ERC20', label: 'ERC-20 (Ethereum)' },
  ],
  BTC: [
    { network: 'BTC', label: 'Bitcoin' },
  ],
};

function toNum(d) {
  return Number(d);
}

const totpFails = new Map();

function totpIsLocked(userId) {
  const row = totpFails.get(userId);
  return Boolean(row && row.until > Date.now());
}
function totpMarkFail(userId) {
  const row = totpFails.get(userId) || { n: 0, until: 0 };
  row.n += 1;
  if (row.n >= 5) {
    row.until = Date.now() + 60_000;
    row.n = 0;
  }
  totpFails.set(userId, row);
}
function totpMarkOk(userId) {
  totpFails.delete(userId);
}

function serializeMe(user, extra = {}) {
  const tOff = transfersBlocked(user);
  const cOff = conversionsBlocked(user);
  return {
    id: user.id,
    uid: user.uid,
    registered: Boolean(user.registered),
    registeredAt: user.registeredAt,
    displayName: user.displayName,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    country: user.country,
    usernameTg: user.usernameTg,
    usdtBalance: toNum(user.usdtBalance),
    earnBalance: toNum(user.earnBalance),
    accountNumber: user.accountNumber,
    accountRequestStatus: user.accountRequestStatus,
    cardNumber: user.cardNumber,
    cardRequestStatus: user.cardRequestStatus,
    kycStatus: user.kycStatus,
    kycRejectReason: user.kycRejectReason,
    verified: user.verified || user.kycStatus === 'approved',
    banned: Boolean(user.banned),
    banReason: user.banned ? banMessage(user) : null,
    transfersDisabled: tOff,
    conversionsDisabled: cOff,
    transferLockReason: tOff ? transferMessage(user) : null,
    convertLockReason: cOff ? convertMessage(user) : null,
    totpEnabled: Boolean(user.totpEnabled),
    emailVerified: Boolean(user.emailVerified),
    avatarId: user.avatarId || '01',
    antiPhishCode: user.antiPhishCode || null,
    lastLoginAt: user.lastLoginAt || null,
    walletBranch: user.walletBranch || null,
    authEpoch: Number(user.authEpoch || 0),
    copy: {
      transfersDisabled: MSG.TRANSFERS_DISABLED,
      conversionsDisabled: MSG.CONVERSIONS_DISABLED,
    },
    ...extra,
  };
}

router.get('/me', async (req, res) => {
  if (!req.sessionOk || !req.user) {
    return res.json({ registered: false, needLogin: true });
  }

  const transfersCount = await prisma.transfer.count({
    where: { fromUserId: req.user.id },
  });
  const depositCount = await prisma.depositAddress.count({
    where: { userId: req.user.id },
  });
  const { listBalances } = require('../balances');
  const balances = await listBalances(prisma, req.user.id, req.user);

  res.json(serializeMe(req.user, { transfersCount, depositCount, balances }));
});

// Регистрация (первый вход) — ФИО, телефон, почта + пароль, UID генерируется сам
router.post('/me/register', async (req, res) => {
  const tg = req.tgUser;
  if (!tg) return res.status(401).json({ error: 'откройте через бота' });

  const fullName = String(req.body.fullName || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '');
  const country = String(req.body.country || '').trim();

  if (fullName.length < 3 || fullName.length > 80) {
    return res.status(400).json({ error: 'укажите ФИО полностью' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'некорректный email' });
  }
  if (!phone || phone.length < 8 || phone.length > 24) {
    return res.status(400).json({ error: 'укажите номер телефона' });
  }
  if (password.length < 6 || password.length > 64) {
    return res.status(400).json({ error: 'пароль от 6 до 64 символов' });
  }

  const emailTaken = await prisma.user.findFirst({
    where: { email, registered: true },
  });
  if (emailTaken) {
    return res.status(400).json({ error: 'этот email уже занят — войдите или восстановите пароль' });
  }

  const uid = await generateUid();
  const shortName = fullName.split(/\s+/)[0] || fullName;

  const created = await prisma.user.create({
    data: {
      telegramId: BigInt(tg.id),
      usernameTg: tg.username || null,
      firstNameTg: tg.first_name || null,
      uid,
      fullName,
      email,
      phone,
      country: country || null,
      displayName: tg.username || shortName,
      passwordHash: hashPassword(password),
      registered: true,
      registeredAt: new Date(),
    },
  });

  const sessionToken = await issueSession(prisma, created.id);
  const { notifyLogin } = require('../mail');
  notifyLogin(created.email, req);
  res.json(serializeMe(created, { sessionToken }));
});

// Вход в уже созданный аккаунт (email или телефон + пароль этого Telegram-пользователя)
function emailCanon(email) {
  const raw = String(email || '').trim().toLowerCase();
  const at = raw.indexOf('@');
  if (at < 1) return raw;
  let user = raw.slice(0, at);
  let domain = raw.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') {
    user = user.replace(/\./g, '').replace(/\+.*$/, '');
  }
  return `${user}@${domain}`;
}

async function findRegisteredByContact(contact, tg) {
  const raw = String(contact || '').trim();
  if (!raw) return null;

  if (raw.includes('@')) {
    const want = emailCanon(raw);
    const rows = await prisma.user.findMany({
      where: { NOT: { email: null } },
      take: 3000,
    });
    const hit = rows.find((u) => {
      const e = emailCanon(u.email);
      return e && e === want && (u.registered || u.passwordHash);
    });
    if (hit) return hit;
  } else {
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 8) {
      const tail = digits.slice(-10);
      const users = await prisma.user.findMany({
        where: { NOT: { phone: null } },
        take: 3000,
      });
      const hit = users.find((u) => (u.registered || u.passwordHash)
        && String(u.phone || '').replace(/\D/g, '').endsWith(tail));
      if (hit) return hit;
    }
  }

  if (tg?.id) {
    const mine = await prisma.user.findMany({
      where: { telegramId: BigInt(tg.id) },
      orderBy: { id: 'desc' },
      take: 30,
    });
    if (raw.includes('@')) {
      const want = emailCanon(raw);
      const hit = mine.find((u) => emailCanon(u.email) === want);
      if (hit) return hit;
    }
  }
  return null;
}

router.post('/me/login', async (req, res) => {
  const contact = String(req.body.email || req.body.contact || req.body.phone || '').trim();
  const password = String(req.body.password || '');
  const tg = req.tgUser;

  if (!contact || !password) {
    return res.status(400).json({ error: 'укажите email/телефон и пароль' });
  }

  const account = await findRegisteredByContact(contact, tg);
  if (!account || !verifyPassword(password, account.passwordHash)) {
    return res.status(400).json({ error: 'неверный email/телефон или пароль' });
  }
  if (account.banned) {
    return res.status(403).json({
      error: banMessage(account),
      code: 'banned',
      banReason: banMessage(account),
    });
  }

  if (tg) {
    await prisma.user.update({
      where: { id: account.id },
      data: {
        telegramId: BigInt(tg.id),
        usernameTg: tg.username || account.usernameTg,
        firstNameTg: tg.first_name || account.firstNameTg,
      },
    });
  }

  if (account.totpEnabled) {
    const tmp = newToken();
    await prisma.user.update({
      where: { id: account.id },
      data: {
        totpTempTokenHash: hashToken(tmp),
        totpTempExpires: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    return res.json({ need2fa: true, totpToken: tmp });
  }

  const sessionToken = await issueSession(prisma, account.id);
  await prisma.user.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
  const fresh = await prisma.user.findUnique({ where: { id: account.id } });
  const { notifyLogin } = require('../mail');
  notifyLogin(fresh.email, req);
  res.json(serializeMe(fresh, { sessionToken }));
});

router.post('/me/login/2fa', async (req, res) => {
  const totpToken = String(req.body.totpToken || '');
  const code = String(req.body.code || '').trim();
  if (!totpToken) return res.status(400).json({ error: 'сессия подтверждения истекла, войдите снова' });

  const account = await prisma.user.findFirst({
    where: { totpTempTokenHash: hashToken(totpToken), registered: true },
  });
  if (!account || !account.totpEnabled) {
    return res.status(400).json({ error: 'сессия подтверждения истекла, войдите снова' });
  }
  if (account.banned) {
    return res.status(403).json({ error: banMessage(account), code: 'banned', banReason: banMessage(account) });
  }
  if (totpIsLocked(account.id)) {
    return res.status(429).json({ error: MSG.TOTP_LOCKED, code: 'totp_locked' });
  }

  const exp = account.totpTempExpires ? new Date(account.totpTempExpires).getTime() : 0;
  if (Date.now() > exp) {
    return res.status(400).json({ error: 'сессия подтверждения истекла, войдите снова' });
  }

  const secret = decryptSecret(account.totpSecret);
  const backups = (() => {
    try { return JSON.parse(account.totpBackupHashes || '[]'); } catch { return []; }
  })();
  const totpOk = secret && verifyTotp(secret, code);
  let backupIdx = -1;
  if (!totpOk) {
    backupIdx = backups.findIndex((h) => verifyPassword(code.toLowerCase(), h));
  }
  if (!totpOk && backupIdx < 0) {
    totpMarkFail(account.id);
    return res.status(400).json({ error: MSG.TOTP_INVALID, code: 'totp_invalid' });
  }
  totpMarkOk(account.id);

  const data = { totpTempTokenHash: null, totpTempExpires: null };
  if (backupIdx >= 0) {
    backups.splice(backupIdx, 1);
    data.totpBackupHashes = JSON.stringify(backups);
  }
  await prisma.user.update({ where: { id: account.id }, data });
  const sessionToken = await issueSession(prisma, account.id);
  await prisma.user.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
  const fresh = await prisma.user.findUnique({ where: { id: account.id } });
  const { notifyLogin } = require('../mail');
  notifyLogin(fresh.email, req);
  res.json(serializeMe(fresh, { sessionToken }));
});

async function sendAuthCode(req, user, code, kind) {
  const { smtpReady, sendResetCode, sendEmailVerify, sendTempPassword } = require('../mail');
  if (!smtpReady()) {
    throw new Error('Почта не настроена на сервере');
  }
  if (!user.email) {
    throw new Error('у аккаунта нет email');
  }
  try {
    if (kind === 'verify') await sendEmailVerify(user.email, code);
    else if (kind === 'temp') await sendTempPassword(user.email, code);
    else await sendResetCode(user.email, code);
    return { mail: true };
  } catch (e) {
    console.error('[mail]', e.message || e);
    throw new Error('не удалось отправить письмо на почту (Gmail с Railway часто даёт timeout). Проверьте спам или SMTP.');
  }
}

router.post('/me/logout', async (req, res) => {
  if (req.user?.id) await clearSession(prisma, req.user.id, true);
  res.json({ ok: true });
});

router.post('/me/email/send', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'войдите в аккаунт' });
  const email = String(req.user.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'сначала укажите email в профиле' });
  const code = String(100000 + Math.floor(Math.random() * 900000));
  await prisma.user.update({
    where: { id: req.user.id },
    data: {
      emailVerifyHash: hashToken(code),
      emailVerifyExpires: new Date(Date.now() + 5 * 60 * 1000),
    },
  });
  try {
    const via = await sendAuthCode(req, req.user, code, 'verify');
    res.json({
      ok: true,
      masked: email.replace(/(.{2}).+(@.+)/, '$1***$2'),
      viaTelegram: via.telegram,
      viaMail: via.mail,
    });
  } catch (e) {
    console.error('[mail-verify]', e);
    res.status(502).json({ error: e.message || 'не удалось отправить код' });
  }
});

router.post('/me/email/confirm', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'войдите в аккаунт' });
  const code = normalizeResetCode(req.body.code);
  if (code.length !== 6) return res.status(400).json({ error: 'введите 6-значный код из письма' });
  const u = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!u?.emailVerifyHash || !u.emailVerifyExpires) {
    return res.status(400).json({ error: 'сначала запросите код' });
  }
  if (Date.now() > new Date(u.emailVerifyExpires).getTime()) {
    return res.status(400).json({ error: 'код истёк' });
  }
  if (!hashesEqual(hashToken(code), u.emailVerifyHash)) {
    return res.status(400).json({ error: 'неверный код' });
  }
  const fresh = await prisma.user.update({
    where: { id: u.id },
    data: { emailVerified: true, emailVerifyHash: null, emailVerifyExpires: null },
  });
  res.json(serializeMe(fresh));
});

router.post('/me/password', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'войдите в аккаунт' });
  const current = String(req.body.current || '');
  const next = String(req.body.next || '');
  if (next.length < 6 || next.length > 64) {
    return res.status(400).json({ error: 'новый пароль от 6 до 64 символов' });
  }
  const u = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!verifyPassword(current, u.passwordHash)) {
    return res.status(400).json({ error: 'текущий пароль неверный' });
  }
  await prisma.user.update({
    where: { id: u.id },
    data: {
      passwordHash: hashPassword(next),
      passwordHoldUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  res.json({ ok: true });
});

router.post('/me/avatar', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'войдите в аккаунт' });
  const avatarId = String(req.body.avatarId || '').replace(/[^0-9]/g, '').padStart(2, '0').slice(0, 2);
  if (!avatarId || Number(avatarId) < 1 || Number(avatarId) > 8) {
    return res.status(400).json({ error: 'выберите аватар' });
  }
  const fresh = await prisma.user.update({
    where: { id: req.user.id },
    data: { avatarId },
  });
  res.json(serializeMe(fresh));
});

router.post('/me/antiphish', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'войдите в аккаунт' });
  const code = String(req.body.code || '').trim();
  if (code.length < 4 || code.length > 16) {
    return res.status(400).json({ error: 'код от 4 до 16 символов' });
  }
  const fresh = await prisma.user.update({
    where: { id: req.user.id },
    data: { antiPhishCode: code },
  });
  res.json(serializeMe(fresh));
});

const forgotHits = new Map();
function forgotLocked(key) {
  const row = forgotHits.get(key);
  return Boolean(row && row.until > Date.now());
}
function forgotMark(key) {
  const row = forgotHits.get(key) || { n: 0, until: 0 };
  row.n += 1;
  if (row.n >= 5) {
    row.until = Date.now() + 10 * 60 * 1000;
    row.n = 0;
  }
  forgotHits.set(key, row);
}

function hashesEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length || x.length === 0) return false;
  return crypto.timingSafeEqual(x, y);
}

function normalizeResetCode(raw) {
  return String(raw || '').replace(/\D/g, '').slice(0, 6);
}

function maskEmail(email) {
  const raw = String(email || '');
  const at = raw.indexOf('@');
  if (at < 1) return '****@****';
  const name = raw.slice(0, at);
  const domain = raw.slice(at);
  const keep = Math.min(3, name.length);
  return `${name.slice(0, keep)}${'*'.repeat(Math.max(3, name.length - keep))}${domain}`;
}

function genTempPassword() {
  const raw = crypto.randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, 'x');
  return `Byb-${raw.slice(0, 10)}`;
}

router.post('/me/forgot/start', async (req, res) => {
  const contact = String(req.body.email || req.body.contact || req.body.phone || '').trim();
  if (!contact) return res.status(400).json({ error: 'укажите email или телефон' });
  const user = await findRegisteredByContact(contact, req.tgUser);
  const email = user?.email || (contact.includes('@') ? contact.toLowerCase() : '');
  res.json({
    ok: true,
    email: email || null,
    maskedEmail: email ? maskEmail(email) : '****@****',
    totpEnabled: Boolean(user?.totpEnabled),
  });
});

router.post('/me/forgot', async (req, res) => {
  const contact = String(req.body.email || req.body.contact || req.body.phone || '').trim();
  const mode = String(req.body.mode || 'code') === 'temp' ? 'temp' : 'code';
  const user = await findRegisteredByContact(contact, req.tgUser);
  const email = user?.email || (contact.includes('@') ? contact.toLowerCase() : '');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'укажите корректный email' });
  }
  if (forgotLocked(email)) {
    return res.status(429).json({ error: 'слишком много попыток. Подождите 10 минут.' });
  }
  forgotMark(email);

  if (!user) {
    console.warn('[forgot] no registered user for this contact');
    return res.json({ ok: true, maskedEmail: maskEmail(email) });
  }

  try {
    if (mode === 'temp') {
      const pass = genTempPassword();
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: hashPassword(pass),
          resetCodeHash: null,
          resetExpires: null,
        },
      });
      const via = await sendAuthCode(req, user, pass, 'temp');
      return res.json({
        ok: true,
        mode,
        maskedEmail: maskEmail(user.email),
        totpEnabled: Boolean(user.totpEnabled),
        viaTelegram: via.telegram,
        viaMail: via.mail,
      });
    }
    const code = String(100000 + Math.floor(Math.random() * 900000));
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetCodeHash: hashToken(code),
        resetExpires: new Date(Date.now() + 5 * 60 * 1000),
      },
    });
    const via = await sendAuthCode(req, user, code, 'reset');
    res.json({
      ok: true,
      mode,
      maskedEmail: maskEmail(user.email),
      totpEnabled: Boolean(user.totpEnabled),
      viaTelegram: via.telegram,
      viaMail: via.mail,
    });
  } catch (e) {
    console.error('[mail]', e);
    res.status(502).json({ error: e.message || 'не удалось отправить код' });
  }
});

router.post('/me/forgot/verify', async (req, res) => {
  const contact = String(req.body.email || req.body.contact || '').trim();
  const code = normalizeResetCode(req.body.code);
  const totpCode = String(req.body.totpCode || '').trim();
  if (code.length !== 6) {
    return res.status(400).json({ error: 'введите 6-значный код из письма' });
  }
  const user = await findRegisteredByContact(contact, req.tgUser);
  if (!user?.resetCodeHash || !user.resetExpires) {
    return res.status(400).json({ error: 'код неверный или истёк. Сначала нажмите «Отправить код».' });
  }
  if (Date.now() > new Date(user.resetExpires).getTime()) {
    return res.status(400).json({ error: 'код истёк, запросите новый' });
  }
  if (!hashesEqual(hashToken(code), user.resetCodeHash)) {
    return res.status(400).json({ error: 'неверный код из письма' });
  }
  if (user.totpEnabled) {
    if (!totpCode) return res.status(400).json({ error: 'введите код Google Authenticator' });
    const secret = decryptSecret(user.totpSecret);
    if (!secret || !verifyTotp(secret, totpCode)) {
      return res.status(400).json({ error: MSG.TOTP_INVALID, code: 'totp_invalid' });
    }
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { resetExpires: new Date(Date.now() + 10 * 60 * 1000) },
  });
  res.json({ ok: true, email: user.email });
});

router.post('/me/reset', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = normalizeResetCode(req.body.code);
  const totpCode = String(req.body.totpCode || '').trim();
  const password = String(req.body.password || '');
  if (!email || code.length !== 6) return res.status(400).json({ error: 'укажите email и 6-значный код из письма' });
  if (password.length < 6 || password.length > 64) {
    return res.status(400).json({ error: 'пароль от 6 до 64 символов' });
  }
  const user = await prisma.user.findFirst({ where: { email, registered: true } });
  if (!user || !user.resetCodeHash || !user.resetExpires) {
    return res.status(400).json({ error: 'код неверный или истёк' });
  }
  if (Date.now() > new Date(user.resetExpires).getTime()) {
    return res.status(400).json({ error: 'код истёк, запросите новый' });
  }
  if (!hashesEqual(hashToken(code), user.resetCodeHash)) {
    return res.status(400).json({ error: 'неверный код из письма' });
  }
  if (user.totpEnabled) {
    if (!totpCode) return res.status(400).json({ error: 'введите код Google Authenticator' });
    const secret = decryptSecret(user.totpSecret);
    if (!secret || !verifyTotp(secret, totpCode)) {
      return res.status(400).json({ error: MSG.TOTP_INVALID, code: 'totp_invalid' });
    }
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hashPassword(password),
      resetCodeHash: null,
      resetExpires: null,
      passwordHoldUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  const sessionToken = await issueSession(prisma, user.id);
  const fresh = await prisma.user.findUnique({ where: { id: user.id } });
  const { notifyLogin } = require('../mail');
  notifyLogin(fresh.email, req);
  res.json(serializeMe(fresh, { sessionToken }));
});

router.put('/me/profile', async (req, res) => {
  const { displayName, fullName, email, phone, country } = req.body;
  const data = {};

  if (displayName !== undefined) {
    const name = String(displayName || '').trim();
    if (name.length < 2 || name.length > 32) {
      return res.status(400).json({ error: 'ник должен быть от 2 до 32 символов' });
    }
    data.displayName = name;
  }
  if (fullName !== undefined) {
    const fio = String(fullName || '').trim();
    if (fio && (fio.length < 3 || fio.length > 80)) {
      return res.status(400).json({ error: 'ФИО: от 3 до 80 символов' });
    }
    data.fullName = fio || null;
  }
  if (email !== undefined) {
    const mail = String(email || '').trim().toLowerCase();
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      return res.status(400).json({ error: 'некорректный email' });
    }
    data.email = mail || null;
    const prev = String(req.user.email || '').trim().toLowerCase();
    if (data.email !== prev) {
      data.emailVerified = false;
      data.emailVerifyHash = null;
      data.emailVerifyExpires = null;
    }
  }
  if (phone !== undefined) {
    const ph = String(phone || '').trim();
    if (ph && ph.length > 24) return res.status(400).json({ error: 'телефон слишком длинный' });
    data.phone = ph || null;
  }
  if (country !== undefined) {
    const c = String(country || '').trim();
    if (c && c.length > 56) return res.status(400).json({ error: 'страна слишком длинная' });
    data.country = c || null;
  }

  if (!Object.keys(data).length) {
    return res.status(400).json({ error: 'нет данных для обновления' });
  }

  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data,
  });
  res.json(serializeMe(updated));
});

// совместимость
router.put('/me/name', async (req, res) => {
  const { displayName } = req.body;
  const name = String(displayName || '').trim();
  if (name.length < 2 || name.length > 32) {
    return res.status(400).json({ error: 'ник должен быть от 2 до 32 символов' });
  }
  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: { displayName: name },
  });
  res.json({ displayName: updated.displayName });
});

router.get('/me/history', async (req, res) => {
  const history = await prisma.balanceHistory.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(history.map((h) => ({
    ...h,
    amount: toNum(h.amount),
    balance: toNum(h.balance),
  })));
});

router.post('/me/account-request', async (req, res) => {
  if (req.user.accountNumber) {
    return res.json({
      accountNumber: req.user.accountNumber,
      accountRequestStatus: 'assigned',
    });
  }
  if (req.user.accountRequestStatus === 'pending') {
    return res.json({ accountNumber: null, accountRequestStatus: 'pending' });
  }

  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: { accountRequestStatus: 'pending' },
  });

  const bot = req.app.get('bot');
  const adminChatId = process.env.ADMIN_CHAT_ID;
  if (bot && adminChatId) {
    bot.telegram.sendMessage(
      adminChatId,
      `Заявка на номер счёта\nОт: ${req.user.displayName} (@${req.user.usernameTg || '—'})\nID: ${req.user.id}`
    ).catch(() => {});
  }

  res.json({
    accountNumber: null,
    accountRequestStatus: updated.accountRequestStatus,
  });
});

// ---------- депозит ----------
async function assignBranchWallets(user, asset, network) {
  let code = user.walletBranch;
  if (!code) {
    const have = await prisma.depositAddress.findMany({ where: { userId: user.id } });
    const labeled = have.find((e) => e.label);
    if (labeled?.label) code = labeled.label;
    if (!code && have.length) {
      const hit = await prisma.walletPool.findFirst({
        where: { address: { in: have.map((h) => h.address) } },
        select: { code: true },
      });
      if (hit?.code) code = hit.code;
    }
  }
  if (!code) {
    const rows = await prisma.walletPool.findMany({
      where: { active: true, asset, network },
      select: { code: true },
    });
    const codes = [...new Set(rows.map((r) => r.code).filter(Boolean))];
    if (!codes.length) return null;
    code = codes[Math.floor(Math.random() * codes.length)];
  }
  if (code && code !== user.walletBranch) {
    await prisma.user.update({
      where: { id: user.id },
      data: { walletBranch: code },
    });
    user.walletBranch = code;
  }

  if (!code) return null;

  const branchRows = await prisma.walletPool.findMany({
    where: { code, active: true },
  });
  for (const p of branchRows) {
    try {
      await prisma.depositAddress.upsert({
        where: { userId_asset_network: { userId: user.id, asset: p.asset, network: p.network } },
        create: {
          userId: user.id,
          asset: p.asset,
          network: p.network,
          address: p.address,
          label: code,
        },
        update: {},
      });
    } catch { /* already assigned */ }
  }

  return prisma.depositAddress.findUnique({
    where: { userId_asset_network: { userId: user.id, asset, network } },
  });
}

router.get('/me/deposit/options', async (_req, res) => {
  res.json(NETWORKS);
});

router.get('/me/deposit/address', async (req, res) => {
  const asset = String(req.query.asset || 'USDT').toUpperCase();
  const network = String(req.query.network || '').toUpperCase();
  if (!NETWORKS[asset]) return res.status(400).json({ error: 'неизвестная валюта' });
  if (!network || !NETWORKS[asset].some((n) => n.network === network)) {
    return res.status(400).json({ error: 'неизвестная сеть' });
  }

  let row = await prisma.depositAddress.findUnique({
    where: {
      userId_asset_network: {
        userId: req.user.id,
        asset,
        network,
      },
    },
  });

  if (!row) {
    try {
      row = await assignBranchWallets(req.user, asset, network);
    } catch (e) {
      if (!/WalletPool|walletBranch|does not exist|P2021|P2022/i.test(String(e.message || e))) throw e;
    }
  }

  if (!row) {
    return res.json({
      asset,
      network,
      address: null,
      assigned: false,
      message: 'Кошелёк генерируется. Обычно это занимает немного времени — ожидайте.',
      generating: true,
    });
  }

  res.json({
    asset: row.asset,
    network: row.network,
    address: row.address,
    label: row.label,
    assigned: true,
  });
});

router.get('/me/deposit/addresses', async (req, res) => {
  const rows = await prisma.depositAddress.findMany({
    where: { userId: req.user.id },
    orderBy: [{ asset: 'asc' }, { network: 'asc' }],
  });
  res.json(rows);
});

// ---------- KYC ----------
router.get('/me/kyc', async (req, res) => {
  const docs = await prisma.kycDocument.findMany({
    where: { userId: req.user.id },
  });
  res.json({
    status: req.user.kycStatus,
    rejectReason: req.user.kycRejectReason,
    fullName: req.user.fullName,
    country: req.user.country,
    documents: docs.map((d) => ({
      id: d.id,
      type: d.type,
      uploadedAt: d.createdAt,
      url: `/api/users/me/kyc/docs/${d.type}/file`,
    })),
  });
});

router.post('/me/kyc/docs/:type', (req, res) => {
  const type = req.params.type;
  if (!['id_front', 'id_back', 'selfie'].includes(type)) {
    return res.status(400).json({ error: 'неверный тип документа' });
  }
  if (req.user.kycStatus === 'approved') {
    return res.status(400).json({ error: 'верификация уже одобрена' });
  }
  if (req.user.kycStatus === 'pending') {
    return res.status(400).json({ error: 'заявка уже на проверке' });
  }

  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'ошибка загрузки' });
    if (!req.file) return res.status(400).json({ error: 'файл не получен' });

    try {
      const existing = await prisma.kycDocument.findUnique({
        where: { userId_type: { userId: req.user.id, type } },
      });
      if (existing) {
        const oldPath = absolutePath(existing.filename);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }

      const doc = await prisma.kycDocument.upsert({
        where: { userId_type: { userId: req.user.id, type } },
        create: {
          userId: req.user.id,
          type,
          filename: req.file.filename,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
        },
        update: {
          filename: req.file.filename,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
        },
      });

      res.json({
        id: doc.id,
        type: doc.type,
        url: `/api/users/me/kyc/docs/${doc.type}/file`,
      });
    } catch (e) {
      res.status(500).json({ error: 'не удалось сохранить документ' });
    }
  });
});

router.get('/me/kyc/docs/:type/file', async (req, res) => {
  const type = req.params.type;
  const doc = await prisma.kycDocument.findUnique({
    where: { userId_type: { userId: req.user.id, type } },
  });
  if (!doc) return res.status(404).json({ error: 'документ не найден' });
  const filePath = absolutePath(doc.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'файл отсутствует' });
  res.setHeader('Content-Type', doc.mimeType || 'image/jpeg');
  fs.createReadStream(filePath).pipe(res);
});

router.post('/me/kyc/submit', async (req, res) => {
  if (req.user.kycStatus === 'approved') {
    return res.status(400).json({ error: 'уже верифицирован' });
  }
  if (req.user.kycStatus === 'pending') {
    return res.status(400).json({ error: 'заявка уже на проверке' });
  }

  const { fullName, country } = req.body;
  const fio = String(fullName || req.user.fullName || '').trim();
  const c = String(country || req.user.country || '').trim();
  if (fio.length < 3) return res.status(400).json({ error: 'укажите ФИО' });
  if (!c) return res.status(400).json({ error: 'укажите страну' });

  const docs = await prisma.kycDocument.findMany({ where: { userId: req.user.id } });
  const types = new Set(docs.map((d) => d.type));
  if (!types.has('id_front') || !types.has('selfie')) {
    return res.status(400).json({ error: 'загрузите фото документа и селфи' });
  }

  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      fullName: fio,
      country: c,
      kycStatus: 'pending',
      kycRejectReason: null,
    },
  });

  const bot = req.app.get('bot');
  const adminChatId = process.env.ADMIN_CHAT_ID;
  if (bot && adminChatId) {
    bot.telegram.sendMessage(
      adminChatId,
      `Новая KYC-заявка\nОт: ${fio}\n@${req.user.usernameTg || '—'} · ID ${req.user.id}\nСтрана: ${c}\n\nПроверить: админ-панель → KYC`
    ).catch(() => {});
  }

  res.json({ status: updated.kycStatus });
});

router.post('/me/2fa/setup', async (req, res) => {
  if (!req.sessionOk) return res.status(401).json({ error: MSG.SESSION_REVOKED, code: 'session_revoked' });
  if (req.user.totpEnabled) return res.status(400).json({ error: '2FA уже включена' });
  const secret = generateSecret();
  await prisma.user.update({
    where: { id: req.user.id },
    data: { totpPendingSecret: encryptSecret(secret) },
  });
  const account = req.user.email || req.user.uid || `user${req.user.id}`;
  const otpauth = otpauthUrl({ secret, account });
  const svg = await qrSvg(otpauth);
  res.json({ secret, otpauth, qrSvg: svg });
});

router.post('/me/2fa/enable', async (req, res) => {
  if (!req.sessionOk) return res.status(401).json({ error: MSG.SESSION_REVOKED, code: 'session_revoked' });
  if (totpIsLocked(req.user.id)) return res.status(429).json({ error: MSG.TOTP_LOCKED });
  const pending = decryptSecret(req.user.totpPendingSecret);
  if (!pending) return res.status(400).json({ error: 'сначала начните подключение 2FA' });
  if (!verifyTotp(pending, req.body.code)) {
    totpMarkFail(req.user.id);
    return res.status(400).json({ error: MSG.TOTP_INVALID });
  }
  totpMarkOk(req.user.id);
  const codes = makeBackupCodes();
  await prisma.user.update({
    where: { id: req.user.id },
    data: {
      totpEnabled: true,
      totpSecret: encryptSecret(pending),
      totpPendingSecret: null,
      totpBackupHashes: JSON.stringify(codes.map((c) => hashPassword(c))),
    },
  });
  res.json({ ok: true, backupCodes: codes, totpEnabled: true });
});

router.post('/me/2fa/disable', async (req, res) => {
  if (!req.sessionOk) return res.status(401).json({ error: MSG.SESSION_REVOKED, code: 'session_revoked' });
  if (!req.user.totpEnabled) return res.json({ ok: true, totpEnabled: false });
  if (totpIsLocked(req.user.id)) return res.status(429).json({ error: MSG.TOTP_LOCKED });
  const code = String(req.body.code || '').trim();
  const secret = decryptSecret(req.user.totpSecret);
  const backups = (() => {
    try { return JSON.parse(req.user.totpBackupHashes || '[]'); } catch { return []; }
  })();
  const ok = (secret && verifyTotp(secret, code))
    || backups.some((h) => verifyPassword(code.toLowerCase(), h));
  if (!ok) {
    totpMarkFail(req.user.id);
    return res.status(400).json({ error: MSG.TOTP_INVALID });
  }
  totpMarkOk(req.user.id);
  await prisma.user.update({
    where: { id: req.user.id },
    data: {
      totpEnabled: false,
      totpSecret: null,
      totpPendingSecret: null,
      totpBackupHashes: null,
    },
  });
  res.json({ ok: true, totpEnabled: false });
});

module.exports = router;
