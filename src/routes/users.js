const express = require('express');
const fs = require('fs');
const prisma = require('../db');
const { upload, absolutePath } = require('../upload');
const { hashPassword, verifyPassword, generateUid } = require('../password');

const router = express.Router();

const NETWORKS = {
  USDT: [
    { network: 'TRC20', label: 'TRC-20 (TRON)' },
    { network: 'ERC20', label: 'ERC-20 (Ethereum)' },
  ],
  BTC: [
    { network: 'BTC', label: 'Bitcoin' },
  ],
};

function toNum(d) {
  return Number(d);
}

function serializeMe(user, extra = {}) {
  return {
    id: user.id,
    uid: user.uid,
    registered: Boolean(user.registered),
    registeredAt: user.registeredAt,
    displayName: user.displayName,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    country: user.country,
    usernameTg: user.usernameTg,
    usdtBalance: toNum(user.usdtBalance),
    accountNumber: user.accountNumber,
    accountRequestStatus: user.accountRequestStatus,
    cardNumber: user.cardNumber,
    cardRequestStatus: user.cardRequestStatus,
    kycStatus: user.kycStatus,
    kycRejectReason: user.kycRejectReason,
    verified: user.verified || user.kycStatus === 'approved',
    ...extra,
  };
}

router.get('/me', async (req, res) => {
  const transfersCount = await prisma.transfer.count({
    where: { fromUserId: req.user.id },
  });
  const depositCount = await prisma.depositAddress.count({
    where: { userId: req.user.id },
  });

  res.json(serializeMe(req.user, { transfersCount, depositCount }));
});

// Регистрация (первый вход) — ФИО, телефон, почта + пароль, UID генерируется сам
router.post('/me/register', async (req, res) => {
  if (req.user.registered) {
    return res.status(400).json({ error: 'вы уже зарегистрированы — войдите' });
  }

  const fullName = String(req.body.fullName || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '');
  const country = String(req.body.country || '').trim();

  if (fullName.length < 3 || fullName.length > 80) {
    return res.status(400).json({ error: 'укажите ФИО полностью' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'некорректный email' });
  }
  if (!phone || phone.length < 8 || phone.length > 24) {
    return res.status(400).json({ error: 'укажите номер телефона' });
  }
  if (password.length < 6 || password.length > 64) {
    return res.status(400).json({ error: 'пароль от 6 до 64 символов' });
  }

  const emailTaken = await prisma.user.findFirst({
    where: { email, NOT: { id: req.user.id }, registered: true },
  });
  if (emailTaken) {
    return res.status(400).json({ error: 'этот email уже занят' });
  }

  const uid = req.user.uid || await generateUid();
  const shortName = fullName.split(/\s+/)[0] || fullName;

  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      uid,
      fullName,
      email,
      phone,
      country: country || null,
      displayName: req.user.displayName || shortName,
      passwordHash: hashPassword(password),
      registered: true,
      registeredAt: new Date(),
    },
  });

  res.json(serializeMe(updated));
});

// Вход в уже созданный аккаунт (email или телефон + пароль этого Telegram-пользователя)
router.post('/me/login', async (req, res) => {
  const contact = String(req.body.email || req.body.contact || req.body.phone || '').trim();
  const password = String(req.body.password || '');

  if (!req.user.registered) {
    return res.status(400).json({ error: 'аккаунт ещё не создан — зарегистрируйтесь' });
  }
  if (!contact || !password) {
    return res.status(400).json({ error: 'укажите email/телефон и пароль' });
  }

  const emailOk = contact.includes('@')
    && String(req.user.email || '').toLowerCase() === contact.toLowerCase();
  const phoneDigits = contact.replace(/\D/g, '');
  const userPhoneDigits = String(req.user.phone || '').replace(/\D/g, '');
  const phoneOk = phoneDigits.length >= 8 && userPhoneDigits.endsWith(phoneDigits.slice(-10));

  if (!emailOk && !phoneOk) {
    return res.status(400).json({ error: 'неверный email/телефон или пароль' });
  }
  if (!verifyPassword(password, req.user.passwordHash)) {
    return res.status(400).json({ error: 'неверный email/телефон или пароль' });
  }

  res.json(serializeMe(req.user));
});

router.put('/me/profile', async (req, res) => {
  const { displayName, fullName, email, phone, country } = req.body;
  const data = {};

  if (displayName !== undefined) {
    const name = String(displayName || '').trim();
    if (name.length < 2 || name.length > 32) {
      return res.status(400).json({ error: 'ник должен быть от 2 до 32 символов' });
    }
    data.displayName = name;
  }
  if (fullName !== undefined) {
    const fio = String(fullName || '').trim();
    if (fio && (fio.length < 3 || fio.length > 80)) {
      return res.status(400).json({ error: 'ФИО: от 3 до 80 символов' });
    }
    data.fullName = fio || null;
  }
  if (email !== undefined) {
    const mail = String(email || '').trim();
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
      return res.status(400).json({ error: 'некорректный email' });
    }
    data.email = mail || null;
  }
  if (phone !== undefined) {
    const ph = String(phone || '').trim();
    if (ph && ph.length > 24) return res.status(400).json({ error: 'телефон слишком длинный' });
    data.phone = ph || null;
  }
  if (country !== undefined) {
    const c = String(country || '').trim();
    if (c && c.length > 56) return res.status(400).json({ error: 'страна слишком длинная' });
    data.country = c || null;
  }

  if (!Object.keys(data).length) {
    return res.status(400).json({ error: 'нет данных для обновления' });
  }

  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data,
  });
  res.json(serializeMe(updated));
});

// совместимость
router.put('/me/name', async (req, res) => {
  const { displayName } = req.body;
  const name = String(displayName || '').trim();
  if (name.length < 2 || name.length > 32) {
    return res.status(400).json({ error: 'ник должен быть от 2 до 32 символов' });
  }
  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: { displayName: name },
  });
  res.json({ displayName: updated.displayName });
});

router.get('/me/history', async (req, res) => {
  const history = await prisma.balanceHistory.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(history.map((h) => ({
    ...h,
    amount: toNum(h.amount),
    balance: toNum(h.balance),
  })));
});

router.post('/me/account-request', async (req, res) => {
  if (req.user.accountNumber) {
    return res.json({
      accountNumber: req.user.accountNumber,
      accountRequestStatus: 'assigned',
    });
  }
  if (req.user.accountRequestStatus === 'pending') {
    return res.json({ accountNumber: null, accountRequestStatus: 'pending' });
  }

  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: { accountRequestStatus: 'pending' },
  });

  const bot = req.app.get('bot');
  const adminChatId = process.env.ADMIN_CHAT_ID;
  if (bot && adminChatId) {
    bot.telegram.sendMessage(
      adminChatId,
      `Заявка на номер счёта\nОт: ${req.user.displayName} (@${req.user.usernameTg || '—'})\nID: ${req.user.id}`
    ).catch(() => {});
  }

  res.json({
    accountNumber: null,
    accountRequestStatus: updated.accountRequestStatus,
  });
});

// ---------- депозит ----------
router.get('/me/deposit/options', async (_req, res) => {
  res.json(NETWORKS);
});

router.get('/me/deposit/address', async (req, res) => {
  const asset = String(req.query.asset || 'USDT').toUpperCase();
  const network = String(req.query.network || '').toUpperCase();
  if (!NETWORKS[asset]) return res.status(400).json({ error: 'неизвестная валюта' });
  if (!network || !NETWORKS[asset].some((n) => n.network === network)) {
    return res.status(400).json({ error: 'неизвестная сеть' });
  }

  const row = await prisma.depositAddress.findUnique({
    where: {
      userId_asset_network: {
        userId: req.user.id,
        asset,
        network,
      },
    },
  });

  if (!row) {
    return res.json({
      asset,
      network,
      address: null,
      assigned: false,
      message: 'Кошелёк генерируется. Обычно это занимает немного времени — ожидайте.',
      generating: true,
    });
  }

  res.json({
    asset: row.asset,
    network: row.network,
    address: row.address,
    label: row.label,
    assigned: true,
  });
});

router.get('/me/deposit/addresses', async (req, res) => {
  const rows = await prisma.depositAddress.findMany({
    where: { userId: req.user.id },
    orderBy: [{ asset: 'asc' }, { network: 'asc' }],
  });
  res.json(rows);
});

// ---------- KYC ----------
router.get('/me/kyc', async (req, res) => {
  const docs = await prisma.kycDocument.findMany({
    where: { userId: req.user.id },
  });
  res.json({
    status: req.user.kycStatus,
    rejectReason: req.user.kycRejectReason,
    fullName: req.user.fullName,
    country: req.user.country,
    documents: docs.map((d) => ({
      id: d.id,
      type: d.type,
      uploadedAt: d.createdAt,
      url: `/api/users/me/kyc/docs/${d.type}/file`,
    })),
  });
});

router.post('/me/kyc/docs/:type', (req, res) => {
  const type = req.params.type;
  if (!['id_front', 'id_back', 'selfie'].includes(type)) {
    return res.status(400).json({ error: 'неверный тип документа' });
  }
  if (req.user.kycStatus === 'approved') {
    return res.status(400).json({ error: 'верификация уже одобрена' });
  }
  if (req.user.kycStatus === 'pending') {
    return res.status(400).json({ error: 'заявка уже на проверке' });
  }

  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'ошибка загрузки' });
    if (!req.file) return res.status(400).json({ error: 'файл не получен' });

    try {
      const existing = await prisma.kycDocument.findUnique({
        where: { userId_type: { userId: req.user.id, type } },
      });
      if (existing) {
        const oldPath = absolutePath(existing.filename);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }

      const doc = await prisma.kycDocument.upsert({
        where: { userId_type: { userId: req.user.id, type } },
        create: {
          userId: req.user.id,
          type,
          filename: req.file.filename,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
        },
        update: {
          filename: req.file.filename,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
        },
      });

      res.json({
        id: doc.id,
        type: doc.type,
        url: `/api/users/me/kyc/docs/${doc.type}/file`,
      });
    } catch (e) {
      res.status(500).json({ error: 'не удалось сохранить документ' });
    }
  });
});

router.get('/me/kyc/docs/:type/file', async (req, res) => {
  const type = req.params.type;
  const doc = await prisma.kycDocument.findUnique({
    where: { userId_type: { userId: req.user.id, type } },
  });
  if (!doc) return res.status(404).json({ error: 'документ не найден' });
  const filePath = absolutePath(doc.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'файл отсутствует' });
  res.setHeader('Content-Type', doc.mimeType || 'image/jpeg');
  fs.createReadStream(filePath).pipe(res);
});

router.post('/me/kyc/submit', async (req, res) => {
  if (req.user.kycStatus === 'approved') {
    return res.status(400).json({ error: 'уже верифицирован' });
  }
  if (req.user.kycStatus === 'pending') {
    return res.status(400).json({ error: 'заявка уже на проверке' });
  }

  const { fullName, country } = req.body;
  const fio = String(fullName || req.user.fullName || '').trim();
  const c = String(country || req.user.country || '').trim();
  if (fio.length < 3) return res.status(400).json({ error: 'укажите ФИО' });
  if (!c) return res.status(400).json({ error: 'укажите страну' });

  const docs = await prisma.kycDocument.findMany({ where: { userId: req.user.id } });
  const types = new Set(docs.map((d) => d.type));
  if (!types.has('id_front') || !types.has('selfie')) {
    return res.status(400).json({ error: 'загрузите фото документа и селфи' });
  }

  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      fullName: fio,
      country: c,
      kycStatus: 'pending',
      kycRejectReason: null,
    },
  });

  const bot = req.app.get('bot');
  const adminChatId = process.env.ADMIN_CHAT_ID;
  if (bot && adminChatId) {
    bot.telegram.sendMessage(
      adminChatId,
      `Новая KYC-заявка\nОт: ${fio}\n@${req.user.usernameTg || '—'} · ID ${req.user.id}\nСтрана: ${c}\n\nПроверить: админ-панель → KYC`
    ).catch(() => {});
  }

  res.json({ status: updated.kycStatus });
});

module.exports = router;
