const { Telegraf, Markup } = require('telegraf');
const prisma = require('./db');

function createBot() {
  const bot = new Telegraf(process.env.BOT_TOKEN);

  bot.start((ctx) => {
    ctx.reply(
      'Добро пожаловать в BYX — кошелёк USDT, рынки и переводы между пользователями.',
      Markup.inlineKeyboard([
        Markup.button.webApp('Открыть приложение', process.env.WEBAPP_URL),
      ])
    );
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

  return bot;
}

module.exports = createBot;
