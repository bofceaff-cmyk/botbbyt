const { Telegraf, Markup } = require('telegraf');
const prisma = require('./db');

function httpsUrl(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  if (/^https:\/\//i.test(v)) return v.replace(/\/$/, '');
  if (/^http:\/\//i.test(v)) return v.replace(/^http:\/\//i, 'https://').replace(/\/$/, '');
  return `https://${v.replace(/^\/+/, '')}`.replace(/\/$/, '');
}

function createBot() {
  const bot = new Telegraf(process.env.BOT_TOKEN);
  const webappUrl = httpsUrl(process.env.WEBAPP_URL);

  bot.start(async (ctx) => {
    try {
      if (!webappUrl) {
        await ctx.reply(
          'Приложение временно недоступно: WEBAPP_URL не задан на сервере.'
        );
        return;
      }
      await ctx.reply(
        'Добро пожаловать в Bybit Wallet — кошелёк USDT, рынки и переводы.',
        Markup.inlineKeyboard([
          Markup.button.webApp('Открыть приложение', webappUrl),
        ])
      );
    } catch (e) {
      console.error('[bot/start]', e.message || e);
      try {
        await ctx.reply('Не удалось открыть кнопку приложения. Проверьте WEBAPP_URL (нужен https://...).');
      } catch (_) { /* ignore */ }
    }
  });

  // Ответ админа на тикет поддержки: /reply_42 текст ответа
  // Работает только из чата админов (ADMIN_CHAT_ID)
  bot.hears(/^\/reply_(\d+)\s+([\s\S]+)/, async (ctx) => {
    if (String(ctx.chat.id) !== String(process.env.ADMIN_CHAT_ID)) return;

    const threadId = Number(ctx.match[1]);
    const text = ctx.match[2].trim();

    const thread = await prisma.supportThread.findUnique({
      where: { id: threadId },
      include: { user: true },
    });
    if (!thread) return ctx.reply('Тикет не найден');

    await prisma.supportMessage.create({
      data: { threadId, sender: 'admin', text },
    });

    // Уведомляем пользователя напрямую в Telegram, что ему пришёл ответ
    await bot.telegram.sendMessage(
      thread.user.telegramId.toString(),
      `Ответ поддержки по тикету #${threadId}:\n\n${text}`
    ).catch(() => {});

    ctx.reply(`Ответ по тикету #${threadId} отправлен`);
  });

  // /close_42 — закрыть тикет
  bot.hears(/^\/close_(\d+)/, async (ctx) => {
    if (String(ctx.chat.id) !== String(process.env.ADMIN_CHAT_ID)) return;
    const threadId = Number(ctx.match[1]);
    await prisma.supportThread.update({ where: { id: threadId }, data: { status: 'closed' } });
    ctx.reply(`Тикет #${threadId} закрыт`);
  });

  bot.catch((err) => {
    console.error('[bot]', err.message || err);
  });

  return bot;
}

module.exports = createBot;
module.exports.httpsUrl = httpsUrl;
