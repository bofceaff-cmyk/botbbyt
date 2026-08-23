#!/usr/bin/env node
/**
 * Идемпотентно догоняет схему, если на Railway применилась
 * не вся цепочка миграций (типичный кейс после частичного деплоя).
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const STEPS = [
  // —— критично для auth / профиляки (сначала!) ——
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "cardNumber" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "cardRequestStatus" TEXT NOT NULL DEFAULT 'none'`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "fullName" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "country" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "kycStatus" TEXT NOT NULL DEFAULT 'none'`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "kycRejectReason" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "uid" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "registered" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "registeredAt" TIMESTAMP(3)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "User_uid_key" ON "User"("uid")`,

  `CREATE TABLE IF NOT EXISTS "DepositAddress" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "asset" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DepositAddress_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "DepositAddress_userId_asset_network_key"
    ON "DepositAddress"("userId", "asset", "network")`,
  `CREATE TABLE IF NOT EXISTS "WalletPool" (
    "id" SERIAL NOT NULL,
    "asset" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletPool_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "WalletPool_asset_network_address_key"
    ON "WalletPool"("asset", "network", "address")`,
  `CREATE INDEX IF NOT EXISTS "WalletPool_asset_network_idx"
    ON "WalletPool"("asset", "network")`,
  `CREATE TABLE IF NOT EXISTS "KycDocument" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KycDocument_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "KycDocument_userId_type_key" ON "KycDocument"("userId", "type")`,

  `ALTER TABLE "SupportThread" ADD COLUMN IF NOT EXISTS "adminReadAt" TIMESTAMP(3)`,
  `ALTER TABLE "SupportMessage" ADD COLUMN IF NOT EXISTS "filename" TEXT`,
  `ALTER TABLE "SupportMessage" ADD COLUMN IF NOT EXISTS "originalName" TEXT`,
  `ALTER TABLE "SupportMessage" ADD COLUMN IF NOT EXISTS "mimeType" TEXT`,

  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "earnBalance" DECIMAL(18,6) NOT NULL DEFAULT 0`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "banned" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "banReason" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "opsLocked" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "opsLockReason" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "authEpoch" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionTokenHash" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "transfersDisabled" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "conversionsDisabled" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "transferLockReason" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "convertLockReason" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpEnabled" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpSecret" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpPendingSecret" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpBackupHashes" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpTempTokenHash" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "resetCodeHash" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "resetExpires" TIMESTAMP(3)`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHoldUntil" TIMESTAMP(3)`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifyHash" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailVerifyExpires" TIMESTAMP(3)`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarId" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "antiPhishCode" TEXT`,
  `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3)`,
  `DROP INDEX IF EXISTS "User_telegramId_key"`,
  `CREATE INDEX IF NOT EXISTS "User_telegramId_idx" ON "User"("telegramId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "User_email_registered_key"
    ON "User"("email") WHERE "registered" = true AND "email" IS NOT NULL`,
  `ALTER TABLE "WalletPool" ADD COLUMN IF NOT EXISTS "code" TEXT`,
  `UPDATE "WalletPool" SET "code" = COALESCE(NULLIF("label", ''), 'BO1') WHERE "code" IS NULL OR "code" = ''`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "WalletPool_code_asset_network_key"
    ON "WalletPool"("code", "asset", "network")`,
  `CREATE INDEX IF NOT EXISTS "WalletPool_code_idx" ON "WalletPool"("code")`,
  `CREATE TABLE IF NOT EXISTS "IncomingDeposit" (
    "id" SERIAL NOT NULL,
    "txHash" TEXT NOT NULL,
    "fromAddress" TEXT NOT NULL DEFAULT '',
    "toAddress" TEXT NOT NULL,
    "amount" DECIMAL(24,12) NOT NULL,
    "usdAmount" DECIMAL(18,2),
    "asset" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "branchCode" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT true,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IncomingDeposit_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "IncomingDeposit_txHash_toAddress_asset_network_key"
    ON "IncomingDeposit"("txHash", "toAddress", "asset", "network")`,
  `CREATE INDEX IF NOT EXISTS "IncomingDeposit_seenAt_idx" ON "IncomingDeposit"("seenAt")`,
  `CREATE INDEX IF NOT EXISTS "IncomingDeposit_branchCode_idx" ON "IncomingDeposit"("branchCode")`,
  `ALTER TABLE "BalanceHistory" ADD COLUMN IF NOT EXISTS "asset" TEXT DEFAULT 'USDT'`,
  `ALTER TABLE "BalanceHistory" ADD COLUMN IF NOT EXISTS "network" TEXT`,
  `ALTER TABLE "BalanceHistory" ADD COLUMN IF NOT EXISTS "address" TEXT`,
  `ALTER TABLE "BalanceHistory" ADD COLUMN IF NOT EXISTS "txHash" TEXT`,
  `ALTER TABLE "BalanceHistory" ADD COLUMN IF NOT EXISTS "fee" DECIMAL(18,6)`,
  `ALTER TABLE "BalanceHistory" ADD COLUMN IF NOT EXISTS "status" TEXT`,
  `CREATE TABLE IF NOT EXISTS "AssetBalance" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" DECIMAL(24,12) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssetBalance_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AssetBalance_userId_asset_key" ON "AssetBalance"("userId", "asset")`,
  `CREATE TABLE IF NOT EXISTS "PaperPosition" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "market" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "qty" DECIMAL(24,12) NOT NULL,
    "leverage" INTEGER NOT NULL DEFAULT 10,
    "entry" DECIMAL(24,12) NOT NULL,
    "margin" DECIMAL(24,12) NOT NULL,
    "target" DECIMAL(24,12),
    "meta" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaperPosition_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "PaperPosition_userId_status_idx" ON "PaperPosition"("userId", "status")`,
  `CREATE INDEX IF NOT EXISTS "AssetBalance_userId_idx" ON "AssetBalance"("userId")`,
  `CREATE TABLE IF NOT EXISTS "FinanceRequest" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "amount" DECIMAL(18,6),
    "asset" TEXT,
    "network" TEXT,
    "toAddress" TEXT,
    "toAsset" TEXT,
    "toAmount" DECIMAL(24,12),
    "meta" TEXT,
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    CONSTRAINT "FinanceRequest_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "FinanceRequest_status_idx" ON "FinanceRequest"("status")`,
  `CREATE INDEX IF NOT EXISTS "FinanceRequest_userId_idx" ON "FinanceRequest"("userId")`,
  `CREATE INDEX IF NOT EXISTS "FinanceRequest_type_idx" ON "FinanceRequest"("type")`,
];

const REQUIRED_USER_COLS = [
  'cardNumber',
  'cardRequestStatus',
  'fullName',
  'email',
  'phone',
  'kycStatus',
  'uid',
  'registered',
  'earnBalance',
];

async function columnExists(name) {
  const rows = await prisma.$queryRaw`
    SELECT 1 AS ok
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'User'
      AND column_name = ${name}
    LIMIT 1
  `;
  return Array.isArray(rows) && rows.length > 0;
}

async function forceAddUserColumn(name, sqlType) {
  // на случай если IF NOT EXISTS не сработал / старый PG
  const exists = await columnExists(name);
  if (exists) return true;
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "User" ADD COLUMN "${name}" ${sqlType}`
    );
    console.log(`[schema] forced add User.${name}`);
    return true;
  } catch (e) {
    console.error(`[schema] FAILED User.${name}:`, String(e.message || e).split('\n')[0]);
    return false;
  }
}

async function main() {
  console.log('[schema] ensuring columns/tables…');
  let warns = 0;
  for (const sql of STEPS) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (e) {
      const msg = String(e.message || e);
      if (/already exists|duplicate/i.test(msg)) continue;
      warns += 1;
      console.warn('[schema] warn:', msg.split('\n')[0]);
    }
  }

  // жёстко догоняем критичные колонки User
  const forced = [
    ['cardNumber', 'TEXT'],
    ['cardRequestStatus', "TEXT NOT NULL DEFAULT 'none'"],
    ['fullName', 'TEXT'],
    ['email', 'TEXT'],
    ['phone', 'TEXT'],
    ['country', 'TEXT'],
    ['kycStatus', "TEXT NOT NULL DEFAULT 'none'"],
    ['kycRejectReason', 'TEXT'],
    ['uid', 'TEXT'],
    ['passwordHash', 'TEXT'],
    ['registered', 'BOOLEAN NOT NULL DEFAULT false'],
    ['registeredAt', 'TIMESTAMP(3)'],
    ['earnBalance', 'DECIMAL(18,6) NOT NULL DEFAULT 0'],
    ['banned', 'BOOLEAN NOT NULL DEFAULT false'],
    ['banReason', 'TEXT'],
    ['opsLocked', 'BOOLEAN NOT NULL DEFAULT false'],
    ['opsLockReason', 'TEXT'],
    ['authEpoch', 'INTEGER NOT NULL DEFAULT 0'],
    ['sessionTokenHash', 'TEXT'],
    ['transfersDisabled', 'BOOLEAN NOT NULL DEFAULT false'],
    ['conversionsDisabled', 'BOOLEAN NOT NULL DEFAULT false'],
    ['transferLockReason', 'TEXT'],
    ['convertLockReason', 'TEXT'],
    ['totpEnabled', 'BOOLEAN NOT NULL DEFAULT false'],
    ['totpSecret', 'TEXT'],
    ['totpPendingSecret', 'TEXT'],
    ['totpBackupHashes', 'TEXT'],
    ['totpTempTokenHash', 'TEXT'],
    ['totpTempExpires', 'TIMESTAMP(3)'],
    ['walletBranch', 'TEXT'],
    ['resetCodeHash', 'TEXT'],
    ['resetExpires', 'TIMESTAMP(3)'],
    ['passwordHoldUntil', 'TIMESTAMP(3)'],
    ['emailVerified', 'BOOLEAN NOT NULL DEFAULT false'],
    ['emailVerifyHash', 'TEXT'],
    ['emailVerifyExpires', 'TIMESTAMP(3)'],
    ['avatarId', 'TEXT'],
    ['antiPhishCode', 'TEXT'],
    ['lastLoginAt', 'TIMESTAMP(3)'],
  ];
  for (const [name, typ] of forced) {
    await forceAddUserColumn(name, typ);
  }

  // FK — отдельно
  const fks = [
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DepositAddress_userId_fkey') THEN
        ALTER TABLE "DepositAddress"
          ADD CONSTRAINT "DepositAddress_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
      END IF;
    END $$`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'KycDocument_userId_fkey') THEN
        ALTER TABLE "KycDocument"
          ADD CONSTRAINT "KycDocument_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
      END IF;
    END $$`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssetBalance_userId_fkey') THEN
        ALTER TABLE "AssetBalance"
          ADD CONSTRAINT "AssetBalance_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
      END IF;
    END $$`,
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FinanceRequest_userId_fkey') THEN
        ALTER TABLE "FinanceRequest"
          ADD CONSTRAINT "FinanceRequest_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
      END IF;
    END $$`,
  ];
  for (const sql of fks) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (e) {
      console.warn('[schema] fk warn:', String(e.message || e).split('\n')[0]);
    }
  }

  const missing = [];
  for (const col of REQUIRED_USER_COLS) {
    if (!(await columnExists(col))) missing.push(col);
  }
  if (missing.length) {
    console.error('[schema] missing User columns after ensure:', missing.join(', '));
    process.exit(1);
  }

  console.log('[schema] ok (cardNumber present, warns=%d)', warns);
}

main()
  .catch((e) => {
    console.error('[schema] failed', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
