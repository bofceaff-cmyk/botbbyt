const express = require('express');
const prisma = require('../db');
const { rejectTransfers } = require('../restrictions');
const router = express.Router();

function parseAmount(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  // до 6 знаков после запятой, минимум 0.000001
  return Math.round(n * 1e6) / 1e6;
}

// Перевод USDT по номеру счёта или по username
router.post('/', async (req, res) => {
  if (rejectTransfers(req, res)) return;
  const { toAccountNumber, toUsername, amount } = req.body;
  const amountNum = parseAmount(amount);

  if (!amountNum) {
    return res.status(400).json({ error: 'некорректная сумма' });
  }
  if (amountNum > Number(req.user.usdtBalance)) {
    return res.status(400).json({ error: 'недостаточно USDT' });
  }
  if (!req.user.accountNumber) {
    return res.status(400).json({ error: 'сначала получите номер счёта' });
  }

  let recipient = null;
  if (toAccountNumber && String(toAccountNumber).trim()) {
    recipient = await prisma.user.findFirst({
      where: { accountNumber: String(toAccountNumber).trim() },
    });
    if (!recipient) return res.status(404).json({ error: 'счёт не найден' });
  } else if (toUsername && String(toUsername).trim()) {
    const cleanUsername = String(toUsername).replace('@', '').trim();
    recipient = await prisma.user.findFirst({ where: { usernameTg: cleanUsername } });
    if (!recipient) return res.status(404).json({ error: 'получатель не найден' });
    if (!recipient.accountNumber) {
      return res.status(400).json({ error: 'у получателя ещё нет номера счёта' });
    }
  } else {
    return res.status(400).json({ error: 'укажите номер счёта или username' });
  }

  if (recipient.id === req.user.id) {
    return res.status(400).json({ error: 'нельзя перевести самому себе' });
  }

  const result = await prisma.$transaction(async (tx) => {
    const senderFresh = await tx.user.findUnique({ where: { id: req.user.id } });
    if (Number(senderFresh.usdtBalance) < amountNum) {
      throw new Error('недостаточно USDT');
    }

    const sender = await tx.user.update({
      where: { id: req.user.id },
      data: { usdtBalance: { decrement: amountNum } },
    });
    const receiver = await tx.user.update({
      where: { id: recipient.id },
      data: { usdtBalance: { increment: amountNum } },
    });
    const transfer = await tx.transfer.create({
      data: { fromUserId: req.user.id, toUserId: recipient.id, amount: amountNum },
    });
    await tx.balanceHistory.create({
      data: {
        userId: req.user.id,
        type: 'transfer_out',
        amount: -amountNum,
        balance: sender.usdtBalance,
        meta: `→ ${recipient.accountNumber || '@' + (recipient.usernameTg || recipient.id)}`,
        asset: 'USDT',
        status: 'success',
      },
    });
    await tx.balanceHistory.create({
      data: {
        userId: recipient.id,
        type: 'transfer_in',
        amount: amountNum,
        balance: receiver.usdtBalance,
        meta: `← ${req.user.accountNumber || '@' + (req.user.usernameTg || req.user.id)}`,
        asset: 'USDT',
        status: 'success',
      },
    });
    return transfer;
  }).catch((e) => {
    if (e.message === 'недостаточно USDT') return null;
    throw e;
  });

  if (!result) return res.status(400).json({ error: 'недостаточно USDT' });

  res.json({ ok: true, transferId: result.id });
});

module.exports = router;
