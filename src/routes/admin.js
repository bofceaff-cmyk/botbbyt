const express = require('express');
const fs = require('fs');
const prisma = require('../db');
const { absolutePath, supportAbsolutePath, supportUpload } = require('../upload');

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
    uid: u.uid,
    telegramId: u.telegramId.toString(),
    usernameTg: u.usernameTg,
    firstNameTg: u.firstNameTg,
    displayName: u.displayName,
    fullName: u.fullName,
    email: u.email,
    phone: u.phone,
    country: u.country,
    registered: Boolean(u.registered),
    usdtBalance: Number(u.usdtBalance),
    earnBalance: Number(u.earnBalance || 0),
    accountNumber: u.accountNumber,
    accountRequestStatus: u.accountRequestStatus,
    cardNumber: u.cardNumber,
    cardRequestStatus: u.cardRequestStatus,
    kycStatus: u.kycStatus,
    kycRejectReason: u.kycRejectReason,
    verified: u.verified || u.kycStatus === 'approved',
    createdAt: u.createdAt,
  };
}

router.get('/users', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const pendingOnly = req.query.pendingAccounts === '1';
    const pendingCards = req.query.pendingCards === '1';
    const kycPending = req.query.kycPending === '1';

    const where = {};
    if (pendingOnly) where.accountRequestStatus = 'pending';
    if (pendingCards) where.cardRequestStatus = 'pending';
    if (kycPending) where.kycStatus = 'pending';
    if (q) {
      where.OR = [
        { displayName: { contains: q, mode: 'insensitive' } },
        { fullName: { contains: q, mode: 'insensitive' } },
        { usernameTg: { contains: q, mode: 'insensitive' } },
        { accountNumber: { contains: q, mode: 'insensitive' } },
        { cardNumber: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { uid: { contains: q, mode: 'insensitive' } },
      ];
      if (/^\d+$/.test(q)) {
        where.OR.push({ id: Number(q) });
        where.OR.push({ uid: q });
      }
    }

    const users = await prisma.user.findMany({
      where,
      orderBy: [{ kycStatus: 'desc' }, { accountRequestStatus: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    res.json(users.map(serializeUser));
  } catch (e) {
    console.error('[admin/users]', e);
    res.status(500).json({
      error: /column|does not exist|P2022/i.test(String(e.message))
        ? 'База не обновлена. Перезадеплойте сервис (migrate deploy).'
        : (e.message || 'ошибка БД'),
    });
  }
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
    kycStatus, kycRejectReason, fullName, cardNumber, cardRequestStatus,
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

  if (cardNumber !== undefined) {
    const num = cardNumber === null || cardNumber === ''
      ? null
      : String(cardNumber).replace(/\s+/g, '');
    if (num) {
      if (!/^\d{12,19}$/.test(num)) {
        return res.status(400).json({ error: 'номер карты: 12–19 цифр' });
      }
      data.cardNumber = num;
      data.cardRequestStatus = 'assigned';
    } else {
      data.cardNumber = null;
      data.cardRequestStatus = 'none';
    }
  }

  if (cardRequestStatus !== undefined) data.cardRequestStatus = cardRequestStatus;
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

  const balanceComment = String(req.body.balanceComment || '').trim();

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({ where: { id }, data });
    if (balanceDelta !== null && balanceDelta !== 0) {
      await tx.balanceHistory.create({
        data: {
          userId: id,
          type: 'admin_adjust',
          amount: balanceDelta,
          balance: u.usdtBalance,
          meta: balanceComment || 'изменение баланса администратором',
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
    if (data.cardNumber && data.cardNumber !== user.cardNumber) {
      const tail = String(data.cardNumber).slice(-4);
      bot.telegram.sendMessage(
        updated.telegramId.toString(),
        `Ваша заявка на карту одобрена. Карта **** ${tail} доступна в приложении → Активы → Моя карта.`
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

// Начислить на баланс (+сумма + комментарий)
router.post('/users/:id/credit', async (req, res) => {
  const id = Number(req.params.id);
  const amount = Number(req.body.amount);
  const comment = String(req.body.comment || '').trim();
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'укажите сумму больше 0' });
  }
  if (!comment || comment.length < 2) {
    return res.status(400).json({ error: 'укажите комментарий (за что начисление)' });
  }
  if (comment.length > 200) {
    return res.status(400).json({ error: 'комментарий слишком длинный' });
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: 'пользователь не найден' });

  const add = Math.round(amount * 1e6) / 1e6;
  const updated = await prisma.$transaction(async (tx) => {
    const next = Math.round((Number(user.usdtBalance) + add) * 1e6) / 1e6;
    const u = await tx.user.update({
      where: { id },
      data: { usdtBalance: next },
    });
    await tx.balanceHistory.create({
      data: {
        userId: id,
        type: 'bonus',
        amount: add,
        balance: u.usdtBalance,
        meta: comment,
      },
    });
    return u;
  });

  const bot = req.app.get('bot');
  if (bot) {
    bot.telegram.sendMessage(
      updated.telegramId.toString(),
      `На ваш баланс зачислено +${add} USDT.\n${comment}`
    ).catch(() => {});
  }

  res.json(serializeUser(updated));
});

router.get('/users/:id/history', async (req, res) => {
  const id = Number(req.params.id);
  const rows = await prisma.balanceHistory.findMany({
    where: { userId: id },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  res.json(rows.map((h) => ({
    id: h.id,
    type: h.type,
    amount: Number(h.amount),
    balance: Number(h.balance),
    meta: h.meta,
    createdAt: h.createdAt,
  })));
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

  res.json(threads.map((t) => {
    const last = t.messages[0] || null;
    const unread = Boolean(
      last
      && last.sender === 'user'
      && (!t.adminReadAt || new Date(last.createdAt) > new Date(t.adminReadAt))
    );
    return {
      id: t.id,
      status: t.status,
      createdAt: t.createdAt,
      adminReadAt: t.adminReadAt,
      unread,
      user: serializeUser(t.user),
      lastMessage: last
        ? {
          sender: last.sender,
          text: last.text,
          createdAt: last.createdAt,
          hasFile: Boolean(last.filename),
        }
        : null,
    };
  }));
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

  // помечаем как прочитанное админом
  await prisma.supportThread.update({
    where: { id },
    data: { adminReadAt: new Date() },
  }).catch(() => {});

  res.json({
    id: thread.id,
    status: thread.status,
    createdAt: thread.createdAt,
    user: serializeUser(thread.user),
    messages: thread.messages.map((m) => ({
      id: m.id,
      sender: m.sender,
      text: m.text || '',
      filename: m.filename,
      originalName: m.originalName,
      mimeType: m.mimeType,
      createdAt: m.createdAt,
      hasFile: Boolean(m.filename),
      fileUrl: m.filename ? `/api/admin/support/messages/${m.id}/file` : null,
    })),
  });
});

router.get('/support/messages/:id/file', async (req, res) => {
  const id = Number(req.params.id);
  const msg = await prisma.supportMessage.findUnique({ where: { id } });
  if (!msg?.filename) return res.status(404).json({ error: 'файл не найден' });
  const filePath = supportAbsolutePath(msg.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'файл отсутствует' });
  res.setHeader('Content-Type', msg.mimeType || 'application/octet-stream');
  if (msg.originalName) {
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(msg.originalName)}"`);
  }
  fs.createReadStream(filePath).pipe(res);
});

router.post('/support/threads/:id/reply', (req, res) => {
  supportUpload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'ошибка загрузки' });
    try {
      const id = Number(req.params.id);
      const text = String(req.body.text || '').trim();
      if (!text && !req.file) {
        return res.status(400).json({ error: 'пустое сообщение' });
      }

      const thread = await prisma.supportThread.findUnique({
        where: { id },
        include: { user: true },
      });
      if (!thread) return res.status(404).json({ error: 'тикет не найден' });

      const message = await prisma.supportMessage.create({
        data: {
          threadId: id,
          sender: 'admin',
          text: text || (req.file ? '📎 Вложение' : ''),
          filename: req.file?.filename || null,
          originalName: req.file?.originalname || null,
          mimeType: req.file?.mimetype || null,
        },
      });

      await prisma.supportThread.update({
        where: { id },
        data: { adminReadAt: new Date() },
      }).catch(() => {});

      const bot = req.app.get('bot');
      if (bot) {
        bot.telegram.sendMessage(
          thread.user.telegramId.toString(),
          'Вы получили ответ от поддержки.\nОткройте приложение → Профиль → Поддержка.'
        ).catch(() => {});
      }

      res.json(message);
    } catch (e) {
      console.error('[admin/reply]', e);
      res.status(500).json({ error: 'не удалось ответить' });
    }
  });
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

// ---------- finance requests ----------
function serializeFinance(r) {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    amount: r.amount == null ? null : Number(r.amount),
    asset: r.asset,
    network: r.network,
    toAddress: r.toAddress,
    toAsset: r.toAsset,
    meta: r.meta,
    adminNote: r.adminNote,
    createdAt: r.createdAt,
    reviewedAt: r.reviewedAt,
    user: r.user ? serializeUser(r.user) : null,
  };
}

router.get('/finance/requests', async (req, res) => {
  const status = String(req.query.status || 'pending');
  const where = status === 'all' ? {} : { status };
  const rows = await prisma.financeRequest.findMany({
    where,
    include: { user: true },
    orderBy: { createdAt: 'desc' },
    take: 150,
  });
  res.json(rows.map(serializeFinance));
});

router.post('/finance/requests/:id/review', async (req, res) => {
  const id = Number(req.params.id);
  const action = String(req.body.action || '').toLowerCase(); // approve | reject
  const adminNote = String(req.body.adminNote || '').trim() || null;
  if (!['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'action: approve или reject' });
  }

  const row = await prisma.financeRequest.findUnique({
    where: { id },
    include: { user: true },
  });
  if (!row) return res.status(404).json({ error: 'заявка не найдена' });
  if (row.status !== 'pending') {
    return res.status(400).json({ error: 'заявка уже обработана' });
  }

  const status = action === 'approve' ? 'approved' : 'rejected';
  // Earn уже списан в earnBalance при подаче заявки
  const deductTypes = ['withdraw_onchain', 'withdraw_card', 'convert'];
  const shouldDeduct = action === 'approve' && deductTypes.includes(row.type) && row.amount;
  const shouldRefundEarn = action === 'reject' && row.type === 'earn' && row.amount;

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      if (shouldDeduct) {
        const user = await tx.user.findUnique({ where: { id: row.userId } });
        const bal = Number(user.usdtBalance);
        const amt = Number(row.amount);
        if (amt > bal) throw new Error('недостаточно средств у пользователя');
        const next = Math.round((bal - amt) * 1e6) / 1e6;
        const u = await tx.user.update({
          where: { id: row.userId },
          data: { usdtBalance: next },
        });
        await tx.balanceHistory.create({
          data: {
            userId: row.userId,
            type: row.type,
            amount: -amt,
            balance: u.usdtBalance,
            meta: adminNote || row.meta || row.type,
          },
        });
      }
      if (shouldRefundEarn) {
        const user = await tx.user.findUnique({ where: { id: row.userId } });
        const amt = Number(row.amount);
        const earn = Number(user.earnBalance || 0);
        if (amt > earn + 1e-9) throw new Error('некорректный Earn-баланс для возврата');
        const nextAvail = Math.round((Number(user.usdtBalance) + amt) * 1e6) / 1e6;
        const nextEarn = Math.round((earn - amt) * 1e6) / 1e6;
        const u = await tx.user.update({
          where: { id: row.userId },
          data: { usdtBalance: nextAvail, earnBalance: nextEarn },
        });
        await tx.balanceHistory.create({
          data: {
            userId: row.userId,
            type: 'earn',
            amount: amt,
            balance: u.usdtBalance,
            meta: adminNote || 'Возврат из Earn (отклонено)',
          },
        });
      }
      return tx.financeRequest.update({
        where: { id },
        data: { status, adminNote, reviewedAt: new Date() },
        include: { user: true },
      });
    });
  } catch (e) {
    return res.status(400).json({ error: e.message || 'ошибка обработки' });
  }

  const bot = req.app.get('bot');
  if (bot && updated.user) {
    const labels = {
      withdraw_onchain: 'вывод on-chain',
      withdraw_card: 'вывод на карту',
      convert: 'конвертация',
      earn: 'Earn',
    };
    const label = labels[updated.type] || updated.type;
    const msg = action === 'approve'
      ? (updated.type === 'earn'
        ? `Заявка Earn одобрена. ${Number(updated.amount)} USDT работают в продукте.`
        : `Заявка «${label}» одобрена.${updated.amount ? ` Сумма: ${Number(updated.amount)} USDT.` : ''}`)
      : `Заявка «${label}» отклонена.${updated.type === 'earn' ? ' Средства возвращены на доступный баланс.' : ''}${adminNote ? `\n${adminNote}` : ''}`;
    bot.telegram.sendMessage(updated.user.telegramId.toString(), msg).catch(() => {});
  }

  res.json(serializeFinance(updated));
});

module.exports = router;
