const express = require('express');
const fs = require('fs');
const prisma = require('../db');
const MSG = require('../messages');
const { transfersBlocked, conversionsBlocked } = require('../restrictions');
const { clearSession } = require('../session');
const { absolutePath, supportAbsolutePath, supportUpload } = require('../upload');

const router = express.Router();

function requireAdmin(req, res, next) {
  const admin = String(process.env.ADMIN_SECRET || '');
  const staff = String(process.env.ADMIN_STAFF_SECRET || '');
  const given = String(req.header('X-Admin-Secret') || req.query.secret || '');
  if (!admin && !staff) return res.status(503).json({ error: 'ADMIN_SECRET не настроен' });
  if (admin && given && given === admin) {
    req.adminRole = 'admin';
    return next();
  }
  if (staff && given && given === staff) {
    req.adminRole = 'staff';
    return next();
  }
  return res.status(401).json({ error: 'неверный секрет' });
}

function requireFullAdmin(req, res, next) {
  if (req.adminRole !== 'admin') {
    return res.status(403).json({ error: 'недостаточно прав: кошельки пользователям выдаёт только админ' });
  }
  next();
}

router.use(requireAdmin);

router.get('/session', (req, res) => {
  res.json({
    role: req.adminRole,
    canAssignWallets: req.adminRole === 'admin',
  });
});

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
    banned: Boolean(u.banned),
    banReason: u.banReason || null,
    opsLocked: Boolean(u.opsLocked),
    opsLockReason: u.opsLockReason || null,
    transfersDisabled: Boolean(u.transfersDisabled),
    conversionsDisabled: Boolean(u.conversionsDisabled),
    transferLockReason: u.transferLockReason || null,
    convertLockReason: u.convertLockReason || null,
    passwordHoldUntil: u.passwordHoldUntil || null,
    passwordHoldActive: Boolean(u.passwordHoldUntil && new Date(u.passwordHoldUntil).getTime() > Date.now()),
    totpEnabled: Boolean(u.totpEnabled),
    authEpoch: Number(u.authEpoch || 0),
    walletBranch: u.walletBranch || null,
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
    banned, banReason, opsLocked, opsLockReason,
    transfersDisabled, conversionsDisabled, transferLockReason, convertLockReason,
    passwordHoldUntil, clearRestrictions,
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

  if (banned !== undefined) {
    data.banned = Boolean(banned);
    if (data.banned) {
      const reason = String(banReason != null ? banReason : '').trim();
      if (!reason) return res.status(400).json({ error: MSG.BAN_REASON_REQUIRED });
      data.banReason = reason;
      data.authEpoch = Number(user.authEpoch || 0) + 1;
      data.sessionTokenHash = null;
    } else {
      data.banReason = null;
    }
  } else if (banReason !== undefined) {
    data.banReason = String(banReason || '').trim() || null;
  }

  if (opsLocked !== undefined) {
    data.opsLocked = Boolean(opsLocked);
    if (data.opsLocked) {
      const reason = String(opsLockReason != null ? opsLockReason : '').trim();
      data.opsLockReason = reason || MSG.TRANSFERS_DISABLED;
    } else {
      data.opsLockReason = null;
    }
  } else if (opsLockReason !== undefined) {
    data.opsLockReason = String(opsLockReason || '').trim() || null;
  }

  if (transfersDisabled !== undefined) {
    data.transfersDisabled = Boolean(transfersDisabled);
    if (!data.transfersDisabled) data.transferLockReason = null;
  }
  if (transferLockReason !== undefined) {
    data.transferLockReason = String(transferLockReason || '').trim() || null;
  }
  if (conversionsDisabled !== undefined) {
    data.conversionsDisabled = Boolean(conversionsDisabled);
    if (!data.conversionsDisabled) data.convertLockReason = null;
  }
  if (convertLockReason !== undefined) {
    data.convertLockReason = String(convertLockReason || '').trim() || null;
  }
  if (passwordHoldUntil !== undefined) {
    if (passwordHoldUntil === null || passwordHoldUntil === '' || passwordHoldUntil === false) {
      data.passwordHoldUntil = null;
    } else {
      const d = new Date(passwordHoldUntil);
      data.passwordHoldUntil = Number.isNaN(d.getTime()) ? null : d;
    }
  }
  if (clearRestrictions) {
    data.banned = false;
    data.banReason = null;
    data.opsLocked = false;
    data.opsLockReason = null;
    data.transfersDisabled = false;
    data.transferLockReason = null;
    data.conversionsDisabled = false;
    data.convertLockReason = null;
    data.passwordHoldUntil = null;
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

  res.json(serializeUser(updated));
});

router.post('/users/:id/kick', async (req, res) => {
  const id = Number(req.params.id);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: 'пользователь не найден' });
  const updated = await clearSession(prisma, id, true);
  res.json(serializeUser(updated));
});

router.delete('/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: 'пользователь не найден' });
  try {
    await prisma.$transaction(async (tx) => {
      const threads = await tx.supportThread.findMany({ where: { userId: id }, select: { id: true } });
      const tids = threads.map((t) => t.id);
      if (tids.length) {
        await tx.supportMessage.deleteMany({ where: { threadId: { in: tids } } });
      }
      await tx.supportThread.deleteMany({ where: { userId: id } });
      await tx.kycDocument.deleteMany({ where: { userId: id } });
      await tx.depositAddress.deleteMany({ where: { userId: id } });
      await tx.assetBalance.deleteMany({ where: { userId: id } });
      await tx.financeRequest.deleteMany({ where: { userId: id } });
      await tx.balanceHistory.deleteMany({ where: { userId: id } });
      await tx.transfer.deleteMany({ where: { OR: [{ fromUserId: id }, { toUserId: id }] } });
      await tx.$executeRaw`DELETE FROM "PaperPosition" WHERE "userId" = ${id}`;
      await tx.user.delete({ where: { id } });
    });
    res.json({ ok: true, id });
  } catch (e) {
    console.error('[admin-delete-user]', e);
    res.status(500).json({ error: 'не удалось удалить аккаунт: ' + (e.message || 'ошибка БД') });
  }
});

// Изменить баланс: credit (внести) / debit (списать) / adjust (установить итог)
router.post('/users/:id/credit', async (req, res) => {
  const id = Number(req.params.id);
  const mode = String(req.body.mode || req.body.action || 'credit')
    .toLowerCase()
    .trim(); // credit | debit | adjust
  const amountRaw = Number(req.body.amount);
  const amount = Math.abs(amountRaw);
  const comment = String(req.body.comment || '').trim();

  if (!['credit', 'debit', 'adjust'].includes(mode)) {
    return res.status(400).json({ error: 'mode: credit, debit или adjust' });
  }
  if (!Number.isFinite(amountRaw) || amountRaw < 0) {
    return res.status(400).json({ error: 'укажите корректную сумму' });
  }
  if (mode !== 'adjust' && amount <= 0) {
    return res.status(400).json({ error: 'укажите сумму больше 0' });
  }
  if (!comment || comment.length < 2) {
    return res.status(400).json({ error: 'укажите комментарий' });
  }
  if (comment.length > 200) {
    return res.status(400).json({ error: 'комментарий слишком длинный' });
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: 'пользователь не найден' });

  const current = Number(user.usdtBalance);
  let next;
  let delta;
  let type;

  if (mode === 'credit') {
    delta = Math.round(amount * 1e6) / 1e6;
    next = Math.round((current + delta) * 1e6) / 1e6;
    type = 'deposit';
  } else if (mode === 'debit') {
    delta = -Math.round(amount * 1e6) / 1e6;
    next = Math.round((current + delta) * 1e6) / 1e6;
    if (next < -1e-9) {
      return res.status(400).json({ error: 'недостаточно средств для списания' });
    }
    if (next < 0) next = 0;
    type = 'withdraw_admin';
  } else {
    next = Math.round(amount * 1e6) / 1e6;
    delta = Math.round((next - current) * 1e6) / 1e6;
    if (delta === 0) return res.status(400).json({ error: 'баланс уже такой' });
    type = 'admin_adjust';
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id },
      data: { usdtBalance: next },
    });
    await tx.balanceHistory.create({
      data: {
        userId: id,
        type,
        amount: delta,
        balance: u.usdtBalance,
        meta: comment,
      },
    });
    return u;
  });

  res.json({ ...serializeUser(updated), appliedMode: mode, appliedDelta: delta });
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
router.put('/users/:id/deposit-addresses', requireFullAdmin, async (req, res) => {
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

  res.json(row);
});

router.delete('/users/:id/deposit-addresses/:addrId', requireFullAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const addrId = Number(req.params.addrId);
  await prisma.depositAddress.deleteMany({ where: { id: addrId, userId: id } });
  res.json({ ok: true });
});

const POOL_SLOTS = [
  { asset: 'USDT', network: 'TRC20', key: 'usdtTrc20' },
  { asset: 'USDT', network: 'ERC20', key: 'usdtErc20' },
  { asset: 'BTC', network: 'BTC', key: 'btc' },
];

function serializePool(row) {
  return {
    id: row.id,
    code: row.code,
    asset: row.asset,
    network: row.network,
    address: row.address,
    label: row.label || row.code,
    active: row.active,
    createdAt: row.createdAt,
  };
}

function groupBranches(rows) {
  const map = new Map();
  for (const r of rows) {
    const code = r.code || r.label || '—';
    if (!map.has(code)) map.set(code, { code, items: [] });
    map.get(code).items.push(serializePool(r));
  }
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

async function nextBranchCode() {
  const rows = await prisma.walletPool.findMany({ select: { code: true } });
  const nums = rows
    .map((r) => Number(String(r.code || '').replace(/^BO/i, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
  const max = nums.length ? Math.max(...nums) : 0;
  return `BO${max + 1}`;
}

router.get('/wallet-pool', async (_req, res) => {
  const rows = await prisma.walletPool.findMany({
    orderBy: [{ code: 'asc' }, { asset: 'asc' }, { network: 'asc' }],
  });
  res.json({ branches: groupBranches(rows), nextCode: await nextBranchCode() });
});

router.post('/wallet-pool', requireFullAdmin, async (req, res) => {
  let code = String(req.body.code || '').trim().toUpperCase();
  if (!code) code = await nextBranchCode();
  if (!/^BO[A-Z0-9_-]{1,12}$/i.test(code)) {
    return res.status(400).json({ error: 'название ветки: BO1, BO2…' });
  }

  const body = req.body || {};
  const slots = [
    { asset: 'USDT', network: 'TRC20', address: body.usdtTrc20 || body.trc20 },
    { asset: 'USDT', network: 'ERC20', address: body.usdtErc20 || body.erc20 },
    { asset: 'BTC', network: 'BTC', address: body.btc },
  ].map((s) => ({ ...s, address: String(s.address || '').trim() }))
    .filter((s) => s.address);

  if (!slots.length) {
    return res.status(400).json({ error: 'укажите хотя бы один адрес: USDT TRC-20 или BTC' });
  }

  const created = [];
  try {
    for (const s of slots) {
      if (s.address.length < 10 || s.address.length > 128) {
        return res.status(400).json({ error: `некорректный адрес ${s.asset} ${s.network}` });
      }
      const row = await prisma.walletPool.upsert({
        where: { code_asset_network: { code, asset: s.asset, network: s.network } },
        create: { code, asset: s.asset, network: s.network, address: s.address, label: code, active: true },
        update: { address: s.address, label: code, active: true },
      });
      created.push(serializePool(row));
    }
  } catch (e) {
    if (/unique|P2002/i.test(String(e.message || e))) {
      return res.status(400).json({ error: 'этот адрес уже есть в другой ветке' });
    }
    throw e;
  }
  res.json({ ok: true, code, items: created });
});

router.delete('/wallet-pool/:id', requireFullAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await prisma.walletPool.deleteMany({ where: { id } });
  res.json({ ok: true });
});

router.delete('/wallet-pool/branch/:code', requireFullAdmin, async (req, res) => {
  const code = String(req.params.code || '').trim();
  await prisma.walletPool.deleteMany({ where: { code } });
  res.json({ ok: true });
});

function explorerUrl(network, hash) {
  if (network === 'TRC20') return `https://tronscan.org/#/transaction/${hash}`;
  if (network === 'ERC20') return `https://etherscan.io/tx/${hash}`;
  if (network === 'BTC') return `https://blockstream.info/tx/${hash}`;
  return '';
}

router.get('/deposits', async (_req, res) => {
  const rows = await prisma.incomingDeposit.findMany({
    orderBy: { seenAt: 'desc' },
    take: 200,
  });
  res.json(rows.map((r) => ({
    id: r.id,
    branchCode: r.branchCode,
    asset: r.asset,
    network: r.network,
    amount: Number(r.amount),
    usdAmount: r.usdAmount == null ? null : Number(r.usdAmount),
    fromAddress: r.fromAddress,
    toAddress: r.toAddress,
    txHash: r.txHash,
    confirmed: r.confirmed,
    seenAt: r.seenAt,
    explorer: explorerUrl(r.network, r.txHash),
    title: `${r.branchCode} Пополнение — ${r.usdAmount != null ? Number(r.usdAmount) : Number(r.amount)}$ валюта ${r.asset} (${r.network})`,
  })));
});

router.post('/deposits/scan', async (_req, res) => {
  try {
    const { scanOnce } = require('../deposit-watch');
    const result = await scanOnce();
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message || 'не удалось проверить сеть' });
  }
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
    toAmount: r.toAmount == null ? null : Number(r.toAmount),
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
  // Earn / Convert уже применены к балансам при подаче
  const deductTypes = ['withdraw_onchain', 'withdraw_card'];
  const shouldDeduct = action === 'approve' && deductTypes.includes(row.type) && row.amount;
  const shouldRefundEarn = action === 'reject' && row.type === 'earn' && row.amount;
  const shouldRefundConvert = action === 'reject' && row.type === 'convert' && row.amount && row.toAsset && row.toAmount != null;

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
      if (shouldRefundConvert) {
        const { setAssetDelta, getAssetAmount } = require('../balances');
        const fromAsset = String(row.asset || 'USDT').toUpperCase();
        const toAsset = String(row.toAsset).toUpperCase();
        const fromAmt = Number(row.amount);
        const toAmt = Number(row.toAmount || 0);
        // откат: забрать toAsset, вернуть fromAsset
        await setAssetDelta(tx, row.userId, toAsset, -toAmt);
        await setAssetDelta(tx, row.userId, fromAsset, fromAmt);
        const usdtAfter = await getAssetAmount(tx, row.userId, 'USDT');
        await tx.balanceHistory.create({
          data: {
            userId: row.userId,
            type: 'convert',
            amount: fromAsset === 'USDT' ? fromAmt : (toAsset === 'USDT' ? -toAmt : 0),
            balance: usdtAfter,
            meta: adminNote || `Отмена конвертации: возврат ${fromAmt} ${fromAsset}`,
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

  res.json(serializeFinance(updated));
});

module.exports = router;
