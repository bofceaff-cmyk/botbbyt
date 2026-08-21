// Проверка initData, который Telegram WebApp передаёт на фронте.
// Это единственный надёжный способ понять, что запрос реально пришёл
// от Telegram, а не подделан кем-то через devtools.
// Документация: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

const crypto = require('crypto');
const prisma = require('./db');

function checkTelegramAuth(initData, botToken) {
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

  // initData валиден не дольше 24 часов, чтобы старые сессии нельзя было переиспользовать
  const authDate = Number(urlParams.get('auth_date') || 0);
  if (Date.now() / 1000 - authDate > 86400) return null;

  const userRaw = urlParams.get('user');
  if (!userRaw) return null;

  return JSON.parse(userRaw); // { id, first_name, username, ... }
}

// middleware: достаёт пользователя из initData, создаёт в БД при первом заходе
async function requireTelegramUser(req, res, next) {
  const initData = req.header('X-Telegram-Init-Data');
  if (!initData) return res.status(401).json({ error: 'no init data' });

  const tgUser = checkTelegramAuth(initData, process.env.BOT_TOKEN);
  if (!tgUser) return res.status(401).json({ error: 'invalid init data' });

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
}

module.exports = { checkTelegramAuth, requireTelegramUser };
