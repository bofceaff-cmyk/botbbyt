const crypto = require('crypto');
const prisma = require('./db');
const { hashToken } = require('./session');
const { banMessage } = require('./restrictions');
const MSG = require('./messages');

function checkTelegramAuth(initData, botToken) {
  if (!botToken) return null;

  const urlParams = new URLSearchParams(initData);
  const hash = urlParams.get('hash');
  urlParams.delete('hash');

  const dataCheckArr = [];
  for (const [key, value] of [...urlParams.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    dataCheckArr.push(`${key}=${value}`);
  }
  const dataCheckString = dataCheckArr.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return null;

  const authDate = Number(urlParams.get('auth_date') || 0);
  if (Date.now() / 1000 - authDate > 86400) return null;

  const userRaw = urlParams.get('user');
  if (!userRaw) return null;

  return JSON.parse(userRaw);
}

function pathOf(req) {
  return String(req.originalUrl || '').split('?')[0];
}

function isOpenAuthRoute(req) {
  const url = pathOf(req);
  if (req.method === 'POST' && /\/users\/me\/(login|register|login\/2fa|forgot|forgot\/start|reset)$/.test(url)) return true;
  if (req.method === 'GET' && /\/users\/me$/.test(url)) return true;
  return false;
}

function isSupportRoute(req) {
  return /\/support(\/|$)/.test(pathOf(req));
}

function isLogoutRoute(req) {
  return req.method === 'POST' && /\/users\/me\/logout$/.test(pathOf(req));
}

async function requireTelegramUser(req, res, next) {
  try {
    if (!process.env.BOT_TOKEN) {
      return res.status(500).json({ error: 'BOT_TOKEN не задан на сервере' });
    }

    const initData = req.header('X-Telegram-Init-Data') || req.query.initData || '';
    if (!initData) {
      return res.status(401).json({ error: 'нет данных Telegram (откройте через бота)' });
    }

    const tgUser = checkTelegramAuth(initData, process.env.BOT_TOKEN);
    if (!tgUser) {
      return res.status(401).json({
        error: 'неверная подпись Telegram — проверьте BOT_TOKEN (должен быть от этого же бота)',
      });
    }

    req.tgUser = tgUser;

    const token = req.header('X-Session-Token') || req.query.session || '';
    let user = null;
    let sessionOk = false;
    if (token) {
      user = await prisma.user.findFirst({
        where: { sessionTokenHash: hashToken(token), registered: true },
      });
      sessionOk = Boolean(user);
    }

    req.sessionOk = sessionOk;
    req.user = user;

    if (!sessionOk && !isOpenAuthRoute(req) && !isLogoutRoute(req)) {
      return res.status(401).json({ error: MSG.SESSION_REVOKED, code: 'session_revoked' });
    }

    const isMeGet = req.method === 'GET' && /\/users\/me$/.test(pathOf(req));
    if (user?.banned && !isOpenAuthRoute(req) && !isSupportRoute(req) && !isLogoutRoute(req) && !isMeGet) {
      return res.status(403).json({
        error: banMessage(user),
        code: 'banned',
        banReason: banMessage(user),
      });
    }

    next();
  } catch (e) {
    console.error('[auth]', e);
    res.status(500).json({
      error: e.code === 'P2022' || /column|does not exist/i.test(e.message || '')
        ? 'база не обновлена — выполните prisma migrate deploy'
        : (e.message || 'ошибка авторизации'),
    });
  }
}

module.exports = { checkTelegramAuth, requireTelegramUser };
