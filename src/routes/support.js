const express = require('express');
const prisma = require('../db');
const router = express.Router();

// Получить (или создать) открытый тикет пользователя со всей перепиской
router.get('/thread', async (req, res) => {
  let thread = await prisma.supportThread.findFirst({
    where: { userId: req.user.id, status: 'open' },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!thread) {
    thread = await prisma.supportThread.create({
      data: { userId: req.user.id },
      include: { messages: true },
    });
  }
  res.json(thread);
});

// Пользователь отправляет сообщение в поддержку
router.post('/thread/:id/messages', async (req, res) => {
  const threadId = Number(req.params.id);
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'пустое сообщение' });

  const thread = await prisma.supportThread.findUnique({ where: { id: threadId } });
  if (!thread || thread.userId !== req.user.id) return res.status(404).json({ error: 'тикет не найден' });

  const message = await prisma.supportMessage.create({
    data: { threadId, sender: 'user', text: text.trim() },
  });

  // Уведомляем админов в Telegram — они отвечают прямо в чате бота
  const bot = req.app.get('bot');
  const adminChatId = process.env.ADMIN_CHAT_ID;
  if (bot && adminChatId) {
    bot.telegram.sendMessage(
      adminChatId,
      `Новое сообщение в поддержку\nОт: ${req.user.displayName} (@${req.user.usernameTg || '—'})\nТикет #${threadId}\n\n${text.trim()}\n\nОтветить: /reply_${threadId} текст_ответа`
    ).catch(() => {});
  }

  res.json(message);
});

module.exports = router;
