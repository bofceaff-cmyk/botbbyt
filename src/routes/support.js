const express = require('express');
const fs = require('fs');
const prisma = require('../db');
const { supportUpload, supportAbsolutePath } = require('../upload');

const router = express.Router();

function serializeMessage(m) {
  return {
    id: m.id,
    threadId: m.threadId,
    sender: m.sender,
    text: m.text || '',
    filename: m.filename,
    originalName: m.originalName,
    mimeType: m.mimeType,
    createdAt: m.createdAt,
    hasFile: Boolean(m.filename),
    fileUrl: m.filename ? `/api/support/messages/${m.id}/file` : null,
  };
}

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
  res.json({
    ...thread,
    messages: thread.messages.map(serializeMessage),
  });
});

// Пользователь отправляет сообщение (текст и/или файл)
router.post('/thread/:id/messages', (req, res) => {
  supportUpload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'ошибка загрузки' });

    try {
      const threadId = Number(req.params.id);
      const text = String(req.body.text || '').trim();
      if (!text && !req.file) {
        return res.status(400).json({ error: 'напишите сообщение или прикрепите файл' });
      }

      const thread = await prisma.supportThread.findUnique({ where: { id: threadId } });
      if (!thread || thread.userId !== req.user.id) {
        return res.status(404).json({ error: 'тикет не найден' });
      }

      const message = await prisma.supportMessage.create({
        data: {
          threadId,
          sender: 'user',
          text: text || (req.file ? '📎 Вложение' : ''),
          filename: req.file?.filename || null,
          originalName: req.file?.originalname || null,
          mimeType: req.file?.mimetype || null,
        },
      });

      const bot = req.app.get('bot');
      const adminChatId = process.env.ADMIN_CHAT_ID;
      if (bot && adminChatId) {
        const preview = text || (req.file ? `[файл: ${req.file.originalname}]` : '');
        bot.telegram.sendMessage(
          adminChatId,
          `Новое сообщение в поддержку\nОт: ${req.user.displayName} (@${req.user.usernameTg || '—'})\nТикет #${threadId}\n\n${preview}\n\nОтветить: /reply_${threadId} текст_ответа`
        ).catch(() => {});
      }

      res.json(serializeMessage(message));
    } catch (e) {
      console.error('[support/msg]', e);
      res.status(500).json({ error: 'не удалось отправить' });
    }
  });
});

router.get('/messages/:id/file', async (req, res) => {
  const id = Number(req.params.id);
  const msg = await prisma.supportMessage.findUnique({
    where: { id },
    include: { thread: true },
  });
  if (!msg?.filename || !msg.thread || msg.thread.userId !== req.user.id) {
    return res.status(404).json({ error: 'файл не найден' });
  }
  const filePath = supportAbsolutePath(msg.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'файл отсутствует' });
  res.setHeader('Content-Type', msg.mimeType || 'application/octet-stream');
  if (msg.originalName) {
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(msg.originalName)}"`);
  }
  fs.createReadStream(filePath).pipe(res);
});

module.exports = router;
