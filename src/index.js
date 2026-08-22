require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const createBot = require('./bot');
const httpsUrl = createBot.httpsUrl;
const { requireTelegramUser } = require('./auth');
const prisma = require('./db');

function assertEnv() {
  const required = ['BOT_TOKEN', 'DATABASE_URL', 'WEBAPP_URL'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('[boot] Нет обязательных переменных:', missing.join(', '));
  }
  if (!process.env.ADMIN_SECRET) {
    console.error('[boot] ADMIN_SECRET не задан — админка не откроется');
  }
}

assertEnv();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const bot = createBot();
app.set('bot', bot);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      ok: true,
      db: true,
      hasBotToken: Boolean(process.env.BOT_TOKEN),
      hasAdminSecret: Boolean(process.env.ADMIN_SECRET),
      webapp: process.env.WEBAPP_URL || null,
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      db: false,
      error: e.message || 'db error',
    });
  }
});

app.use('/api/admin', require('./routes/admin'));
app.use('/api/market', require('./routes/market'));

app.use('/api', requireTelegramUser);
app.use('/api/users', require('./routes/users'));
app.use('/api/transfers', require('./routes/transfers'));
app.use('/api/support', require('./routes/support'));
app.use('/api/finance', require('./routes/finance'));

const { startDepositWatch } = require('./deposit-watch');
startDepositWatch(bot);

app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  res.status(500).json({ error: err.message || 'внутренняя ошибка сервера' });
});

const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV === 'production' && process.env.WEBHOOK_URL) {
  app.use(bot.webhookCallback('/bot-webhook'));
  bot.telegram.setWebhook(`${httpsUrl(process.env.WEBHOOK_URL)}/bot-webhook`).catch((e) => {
    console.error('[bot] webhook error', e.message);
  });
} else {
  bot.launch().catch((e) => console.error('[bot] launch error', e.message));
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
