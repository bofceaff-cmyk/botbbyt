const crypto = require('crypto');
const prisma = require('./db');

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

    let user = await prisma.user.findUnique({ where: { telegramId: BigInt(tgUser.id) } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          telegramId: BigInt(tgUser.id),
          usernameTg: tgUser.username || null,
          firstNameTg: tgUser.first_name || null,
          displayName: tgUser.username || tgUser.first_name || `user${tgUser.id}`,
        },
      });
    }

    req.user = user;
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
