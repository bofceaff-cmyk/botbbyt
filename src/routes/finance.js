const express = require('express');
const prisma = require('../db');

const router = express.Router();

const CONVERT_TARGETS = {
  BTC: { networks: ['BTC'], label: 'Bitcoin' },
  ETH: { networks: ['ERC20'], label: 'Ethereum' },
  USDT: { networks: ['TRC20', 'ERC20'], label: 'Tether' },
  TRX: { networks: ['TRC20'], label: 'TRON' },
  SOL: { networks: ['SOL'], label: 'Solana' },
};

const EARN_PRODUCTS = [
  { id: 'flexible', title: 'Flexible Earn', apy: '5.2%', days: null, desc: 'Гибкий стейкинг USDT — вывод в любой момент после одобрения.' },
  { id: 'fixed30', title: 'Fixed 30D', apy: '8.4%', days: 30, desc: 'Фиксированный срок 30 дней. Повышенная доходность.' },
  { id: 'fixed90', title: 'Fixed 90D', apy: '12.1%', days: 90, desc: 'Фиксированный срок 90 дней. Максимальный APY.' },
];

function toNum(v) {
  return Number(v || 0);
}

function serializeReq(r) {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    amount: r.amount == null ? null : toNum(r.amount),
    asset: r.asset,
    network: r.network,
    toAddress: r.toAddress,
    toAsset: r.toAsset,
    meta: r.meta,
    adminNote: r.adminNote,
    createdAt: r.createdAt,
    reviewedAt: r.reviewedAt,
  };
}

async function notifyAdmins(req, text) {
  const bot = req.app.get('bot');
  const adminChatId = process.env.ADMIN_CHAT_ID;
  if (bot && adminChatId) {
    bot.telegram.sendMessage(adminChatId, text).catch(() => {});
  }
}

function parseAmount(raw) {
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 1e6) / 1e6;
}

// ---------- card ----------
router.post('/card-request', async (req, res) => {
  if (req.user.cardNumber) {
    return res.json({ cardNumber: req.user.cardNumber, cardRequestStatus: 'assigned' });
  }
  if (req.user.cardRequestStatus === 'pending') {
    return res.json({ cardNumber: null, cardRequestStatus: 'pending' });
  }

  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: { cardRequestStatus: 'pending' },
  });

  await notifyAdmins(
    req,
    `Заявка на карту\nОт: ${req.user.displayName} (@${req.user.usernameTg || '—'})\nID: ${req.user.id}`
  );

  res.json({ cardNumber: null, cardRequestStatus: updated.cardRequestStatus });
});

// ---------- options ----------
router.get('/convert/options', (_req, res) => {
  res.json(CONVERT_TARGETS);
});

router.get('/earn/products', (_req, res) => {
  res.json(EARN_PRODUCTS);
});

router.get('/requests', async (req, res) => {
  const rows = await prisma.financeRequest.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 40,
  });
  res.json(rows.map(serializeReq));
});

// ---------- withdraw ----------
router.post('/withdraw', async (req, res) => {
  const method = String(req.body.method || '').toLowerCase(); // onchain | card
  const amount = parseAmount(req.body.amount);
  if (!amount) return res.status(400).json({ error: 'укажите сумму' });
  if (amount > toNum(req.user.usdtBalance)) {
    return res.status(400).json({ error: 'недостаточно средств' });
  }

  let type;
  let network = null;
  let toAddress = null;
  let meta = null;

  if (method === 'onchain') {
    type = 'withdraw_onchain';
    network = String(req.body.network || 'TRC20').toUpperCase();
    toAddress = String(req.body.address || '').trim();
    if (!['TRC20', 'ERC20', 'BTC', 'SOL'].includes(network)) {
      return res.status(400).json({ error: 'неверная сеть' });
    }
    if (toAddress.length < 10 || toAddress.length > 128) {
      return res.status(400).json({ error: 'укажите корректный адрес' });
    }
  } else if (method === 'card') {
    type = 'withdraw_card';
    if (!req.user.cardNumber) {
      return res.status(400).json({ error: 'сначала оформите карту (Моя карта)' });
    }
    toAddress = req.user.cardNumber;
    meta = `карта **** ${String(req.user.cardNumber).slice(-4)}`;
  } else {
    return res.status(400).json({ error: 'выберите способ: onchain или card' });
  }

  const pending = await prisma.financeRequest.count({
    where: { userId: req.user.id, type: { startsWith: 'withdraw' }, status: 'pending' },
  });
  if (pending >= 5) {
    return res.status(400).json({ error: 'слишком много заявок на вывод в ожидании' });
  }

  const row = await prisma.financeRequest.create({
    data: {
      userId: req.user.id,
      type,
      amount,
      asset: 'USDT',
      network,
      toAddress,
      meta,
    },
  });

  await notifyAdmins(
    req,
    `Заявка на вывод (${method})\nОт: ${req.user.displayName} (#${req.user.id})\nСумма: ${amount} USDT\n${network ? `Сеть: ${network}\n` : ''}${toAddress ? `Куда: ${toAddress}\n` : ''}Админка → Заявки`
  );

  res.json(serializeReq(row));
});

// ---------- convert ----------
router.post('/convert', async (req, res) => {
  const amount = parseAmount(req.body.amount);
  const toAsset = String(req.body.toAsset || '').toUpperCase();
  const network = String(req.body.network || '').toUpperCase();
  const toAddress = String(req.body.address || '').trim();

  if (!amount) return res.status(400).json({ error: 'укажите сумму' });
  if (amount > toNum(req.user.usdtBalance)) {
    return res.status(400).json({ error: 'недостаточно средств' });
  }
  const target = CONVERT_TARGETS[toAsset];
  if (!target) return res.status(400).json({ error: 'недоступная валюта' });
  if (!target.networks.includes(network)) {
    return res.status(400).json({ error: 'неверная сеть для актива' });
  }
  if (toAddress.length < 10 || toAddress.length > 128) {
    return res.status(400).json({ error: 'укажите адрес получения' });
  }

  const row = await prisma.financeRequest.create({
    data: {
      userId: req.user.id,
      type: 'convert',
      amount,
      asset: 'USDT',
      toAsset,
      network,
      toAddress,
      meta: `USDT → ${toAsset} (${network})`,
    },
  });

  await notifyAdmins(
    req,
    `Заявка на конвертацию\nОт: ${req.user.displayName} (#${req.user.id})\n${amount} USDT → ${toAsset} (${network})\nАдрес: ${toAddress}`
  );

  res.json(serializeReq(row));
});

// ---------- earn ----------
router.post('/earn', async (req, res) => {
  const amount = parseAmount(req.body.amount);
  const productId = String(req.body.productId || '').trim();
  const product = EARN_PRODUCTS.find((p) => p.id === productId);
  if (!product) return res.status(400).json({ error: 'выберите продукт Earn' });
  if (!amount) return res.status(400).json({ error: 'укажите сумму' });
  if (amount > toNum(req.user.usdtBalance)) {
    return res.status(400).json({ error: 'недостаточно средств' });
  }
  if (amount < 10) return res.status(400).json({ error: 'минимум 10 USDT' });

  const meta = `${product.title} · APY ${product.apy}${product.days ? ` · ${product.days}д` : ''}`;

  const row = await prisma.$transaction(async (tx) => {
    const fresh = await tx.user.findUnique({ where: { id: req.user.id } });
    if (!fresh || amount > toNum(fresh.usdtBalance)) {
      const err = new Error('недостаточно средств');
      err.code = 'INSUFFICIENT';
      throw err;
    }
    const avail = Math.round((toNum(fresh.usdtBalance) - amount) * 1e6) / 1e6;
    const earn = Math.round((toNum(fresh.earnBalance) + amount) * 1e6) / 1e6;
    await tx.user.update({
      where: { id: req.user.id },
      data: { usdtBalance: avail, earnBalance: earn },
    });
    await tx.balanceHistory.create({
      data: {
        userId: req.user.id,
        type: 'earn',
        amount: -amount,
        balance: avail,
        meta: `Earn · ${meta}`,
      },
    });
    return tx.financeRequest.create({
      data: {
        userId: req.user.id,
        type: 'earn',
        amount,
        asset: 'USDT',
        meta,
      },
    });
  }).catch((e) => {
    if (e.code === 'INSUFFICIENT' || e.message === 'недостаточно средств') return null;
    throw e;
  });

  if (!row) return res.status(400).json({ error: 'недостаточно средств' });

  await notifyAdmins(
    req,
    `Заявка Earn\nОт: ${req.user.displayName} (#${req.user.id})\n${amount} USDT → ${product.title} (${product.apy})`
  );

  const me = await prisma.user.findUnique({ where: { id: req.user.id } });
  res.json({
    ...serializeReq(row),
    usdtBalance: toNum(me.usdtBalance),
    earnBalance: toNum(me.earnBalance),
  });
});

module.exports = router;
