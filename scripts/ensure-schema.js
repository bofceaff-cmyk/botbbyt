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
