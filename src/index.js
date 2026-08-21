require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const createBot = require('./bot');
const { requireTelegramUser } = require('./auth');

const app = express();
app.use(cors());
app.use(express.json());

const bot = createBot();
app.set('bot', bot);

app.use(express.static(path.join(__dirname, '..', 'public')));

// Админ API — отдельная авторизация по ADMIN_SECRET (не через Telegram)
app.use('/api/admin', require('./routes/admin'));

// Публичные рыночные данные (котировки / новости) — без Telegram-auth
app.use('/api/market', require('./routes/market'));

// Пользовательские API — initData из Telegram
app.use('/api', requireTelegramUser);
app.use('/api/users', require('./routes/users'));
app.use('/api/transfers', require('./routes/transfers'));
app.use('/api/support', require('./routes/support'));

const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV === 'production' && process.env.WEBHOOK_URL) {
  app.use(bot.webhookCallback('/bot-webhook'));
  bot.telegram.setWebhook(`${process.env.WEBHOOK_URL}/bot-webhook`);
} else {
  bot.launch();
}

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
