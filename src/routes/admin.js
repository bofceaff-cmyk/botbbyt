const express = require('express');
const fs = require('fs');
const prisma = require('../db');
const { absolutePath } = require('../upload');

const router = express.Router();

function requireAdmin(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return res.status(503).json({ error: 'ADMIN_SECRET не настроен' });

  const header = req.header('X-Admin-Secret') || '';
  const query = req.query.secret || '';
  if (header !== secret && query !== secret) {
    return res.status(401).json({ error: 'неверный секрет' });
  }
  next();
}

router.use(requireAdmin);

function serializeUser(u) {
  return {
    id: u.id,
    telegramId: u.telegramId.toString(),
    usernameTg: u.usernameTg,
    firstNameTg: u.firstNameTg,
    displayName: u.displayName,
    fullName: u.fullName,
    email: u.email,
    phone: u.phone,
    country: u.country,
    usdtBalance: Number(u.usdtBalance),
    accountNumber: u.accountNumber,
    accountRequestStatus: u.accountRequestStatus,
    kycStatus: u.kycStatus,
    kycRejectReason: u.kycRejectReason,
    verified: u.verified || u.kycStatus === 'approved',
    createdAt: u.createdAt,
  };
}

router.get('/users', async (req, res) => {
  const q = (req.query.q || '').trim();
  const pendingOnly = req.query.pendingAccounts === '1';
  const kycPending = req.query.kycPending === '1';

  const where = {};
  if (pendingOnly) where.accountRequestStatus = 'pending';
  if (kycPending) where.kycStatus = 'pending';
  if (q) {
    where.OR = [
      { displayName: { contains: q, mode: 'insensitive' } },
      { fullName: { contains: q, mode: 'insensitive' } },
      { usernameTg: { contains: q, mode: 'insensitive' } },
      { accountNumber: { contains: q, mode: 'insensitive' } },
    ];
    if (/^\d+$/.test(q)) where.OR.push({ id: Number(q) });
  }

  const users = await prisma.user.findMany({
    where,
    orderBy: [{ kycStatus: 'desc' }, { accountRequestStatus: 'desc' }, { id: 'desc' }],
    take: 200,
  });
  res.json(users.map(serializeUser));
});

router.get('/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      depositAddresses: true,
      kycDocuments: true,
    },
  });
  if (!user) return res.status(404).json({ error: 'пользователь не найден' });

  res.json({
    ...serializeUser(user),
    depositAddresses: user.depositAddresses,
    kycDocuments: user.kycDocuments.map((d) => ({
      id: d.id,
      type: d.type,
      mimeType: d.mimeType,
      createdAt: d.createdAt,
      url: `/api/admin/users/${id}/kyc/docs/${d.type}/file`,
    })),
  });
});

router.patch('/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const {
    accountNumber, usdtBalance, accountRequestStatus, verified,
    kycStatus, kycRejectReason, fullName,
  } = req.body;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: 'пользователь не найден' });

  const data = {};

  if (accountNumber !== undefined) {
    const num = accountNumber === null || accountNumber === ''
      ? null
      : String(accountNumber).trim();
    if (num) {
      const taken = await prisma.user.findFirst({
        where: { accountNumber: num, NOT: { id } },
      });
      if (taken) return res.status(400).json({ error: 'этот номер счёта уже занят' });
      data.accountNumber = num;
      data.accountRequestStatus = 'assigned';
    } else {
      data.accountNumber = null;
      data.accountRequestStatus = 'none';
    }
  }

  if (accountRequestStatus !== undefined) data.accountRequestStatus = accountRequestStatus;
  if (fullName !== undefined) data.fullName = String(fullName || '').trim() || null;

  if (kycStatus !== undefined) {
    const st = String(kycStatus);
    if (!['none', 'pending', 'approved', 'rejected'].includes(st)) {
      return res.status(400).json({ error: 'неверный статус KYC' });
    }
    data.kycStatus = st;
    if (st === 'approved') {
      data.verified = true;
      data.verifiedAt = new Date();
      data.kycRejectReason = null;
    } else if (st === 'rejected') {
      data.verified = false;
      data.kycRejectReason = String(kycRejectReason || 'Отклонено').trim();
    } else if (st === 'none' || st === 'pending') {
      data.verified = false;
      if (st === 'pending') data.kycRejectReason = null;
    }
  } else if (verified !== undefined) {
    data.verified = Boolean(verified);
    if (data.verified) {
      data.verifiedAt = new Date();
      data.kycStatus = 'approved';
    }
  }

  if (kycRejectReason !== undefined && data.kycStatus === undefined) {
    data.kycRejectReason = String(kycRejectReason || '').trim() || null;
  }

  let balanceDelta = null;
  if (usdtBalance !== undefined) {
    const next = Number(usdtBalance);
    if (!Number.isFinite(next) || next < 0) {
      return res.status(400).json({ error: 'некорректный баланс' });
    }
    const rounded = Math.round(next * 1e6) / 1e6;
    balanceDelta = rounded - Number(user.usdtBalance);
    data.usdtBalance = rounded;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id }, data });
    if (balanceDelta !== null && balanceDelta !== 0) {
      await tx.balanceHistory.create({
        data: {
          userId: id,
          type: 'admin_adjust',
          amount: balanceDelta,
          balance: u.usdtBalance,
          meta: 'изменение баланса администратором',
        },
      });
    }
    return u;
  });

  const bot = req.app.get('bot');
  if (bot) {
    if (data.accountNumber && data.accountNumber !== user.accountNumber) {
      bot.telegram.sendMessage(
        updated.telegramId.toString(),
        `Вам назначен номер счёта: ${data.accountNumber}`
      ).catch(() => {});
    }
    if (data.kycStatus === 'approved' && user.kycStatus !== 'approved') {
      bot.telegram.sendMessage(
        updated.telegramId.toString(),
        'Верификация одобрена. Ваш профиль подтверждён.'
      ).catch(() => {});
    }
    if (data.kycStatus === 'rejected' && user.kycStatus !== 'rejected') {
      bot.telegram.sendMessage(
        updated.telegramId.toString(),
        `Верификация отклонена.\n${updated.kycRejectReason || ''}`
      ).catch(() => {});
    }
  }

  res.json(serializeUser(updated));
});

// Адреса депозита
router.put('/users/:id/deposit-addresses', async (req, res) => {
  const id = Number(req.params.id);
  const { asset, network, address, label } = req.body;
  const a = String(asset || '').toUpperCase();
  const n = String(network || '').toUpperCase();
  const addr = String(address || '').trim();

  const allowed = {
    USDT: ['TRC20', 'ERC20'],
    BTC: ['BTC'],
  };
  if (!allowed[a] || !allowed[a].includes(n)) {
    return res.status(400).json({ error: 'неверная пара asset/network' });
  }
  if (!addr || addr.length < 10 || addr.length > 128) {
    return res.status(400).json({ error: 'некорректный адрес' });
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: 'пользователь не найден' });

  const row = await prisma.depositAddress.upsert({
    where: { userId_asset_network: { userId: id, asset: a, network: n } },
    create: { userId: id, asset: a, network: n, address: addr, label: label || null },
    update: { address: addr, label: label || null },
  });

  const bot = req.app.get('bot');
  if (bot) {
    bot.telegram.sendMessage(
      user.telegramId.toString(),
      `Вам выдан депозитный адрес\n${a} · ${n}\n${addr}`
    ).catch(() => {});
  }

  res.json(row);
});

router.delete('/users/:id/deposit-addresses/:addrId', async (req, res) => {
  const id = Number(req.params.id);
  const addrId = Number(req.params.addrId);
  await prisma.depositAddress.deleteMany({ where: { id: addrId, userId: id } });
  res.json({ ok: true });
});

router.get('/users/:id/kyc/docs/:type/file', async (req, res) => {
  const id = Number(req.params.id);
  const type = req.params.type;
  const doc = await prisma.kycDocument.findUnique({
    where: { userId_type: { userId: id, type } },
  });
  if (!doc) return res.status(404).json({ error: 'документ не найден' });
  const filePath = absolutePath(doc.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'файл отсутствует' });
  res.setHeader('Content-Type', doc.mimeType || 'image/jpeg');
  fs.createReadStream(filePath).pipe(res);
});

router.get('/support/threads', async (_req, res) => {
  const threads = await prisma.supportThread.findMany({
    where: { status: 'open' },
    include: {
      user: true,
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  res.json(threads.map((t) => ({
    id: t.id,
    status: t.status,
    createdAt: t.createdAt,
    user: serializeUser(t.user),
    lastMessage: t.messages[0]
      ? { sender: t.messages[0].sender, text: t.messages[0].text, createdAt: t.messages[0].createdAt }
      : null,
  })));
});

router.get('/support/threads/:id', async (req, res) => {
  const id = Number(req.params.id);
  const thread = await prisma.supportThread.findUnique({
    where: { id },
    include: {
      user: true,
      messages: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!thread) return res.status(404).json({ error: 'тикет не найден' });

  res.json({
    id: thread.id,
    status: thread.status,
    createdAt: thread.createdAt,
    user: serializeUser(thread.user),
    messages: thread.messages,
  });
});

router.post('/support/threads/:id/reply', async (req, res) => {
  const id = Number(req.params.id);
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'пустое сообщение' });

  const thread = await prisma.supportThread.findUnique({
    where: { id },
    include: { user: true },
  });
  if (!thread) return res.status(404).json({ error: 'тикет не найден' });

  const message = await prisma.supportMessage.create({
    data: { threadId: id, sender: 'admin', text },
  });

  const bot = req.app.get('bot');
  if (bot) {
    bot.telegram.sendMessage(
      thread.user.telegramId.toString(),
      `Ответ поддержки по тикету #${id}:\n\n${text}`
    ).catch(() => {});
  }

  res.json(message);
});

router.post('/support/threads/:id/close', async (req, res) => {
  const id = Number(req.params.id);
  const thread = await prisma.supportThread.update({
    where: { id },
    data: { status: 'closed' },
  }).catch(() => null);
  if (!thread) return res.status(404).json({ error: 'тикет не найден' });
  res.json({ ok: true });
});

module.exports = router;
