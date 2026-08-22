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
app.set('trust proxy', true);
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function startBot() {
  const webhookBase = httpsUrl(process.env.WEBHOOK_URL || '');
  if (process.env.NODE_ENV === 'production' && webhookBase) {
    app.use(bot.webhookCallback('/bot-webhook'));
    await bot.telegram.setWebhook(`${webhookBase}/bot-webhook`);
    console.log('[bot] webhook', `${webhookBase}/bot-webhook`);
    return;
  }

  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
  } catch (e) {
    console.warn('[bot] deleteWebhook', e.message || e);
  }

  for (let i = 0; i < 6; i++) {
    try {
      await bot.launch({ dropPendingUpdates: false });
      console.log('[bot] polling started');
      return;
    } catch (e) {
      const msg = String(e.message || e);
      const conflict = msg.includes('409') || /terminated by other getUpdates/i.test(msg);
      if (conflict && i < 5) {
        console.warn('[bot] 409 conflict (старый инстанс ещё жив), повтор через 3с…');
        await sleep(3000);
        continue;
      }
      console.error('[bot] launch error', msg);
      return;
    }
  }
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
startBot().catch((e) => console.error('[bot] start', e.message || e));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
