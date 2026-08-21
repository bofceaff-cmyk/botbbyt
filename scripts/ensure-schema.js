#!/usr/bin/env node
/**
 * Идемпотентно догоняет схему, если на Railway применилась
 * не вся цепочка миграций (типичный кейс после частичного деплоя).
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const STEPS = [
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
];

async function main() {
  console.log('[schema] ensuring columns/tables…');
  for (const sql of STEPS) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (e) {
      // NOT NULL DEFAULT на уже существующей колонке и т.п. — игнор
      const msg = String(e.message || e);
      if (/already exists|duplicate/i.test(msg)) continue;
      console.warn('[schema] warn:', msg.split('\n')[0]);
    }
  }

  // FK — отдельно, чтобы не падать если уже есть
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
  ];
  for (const sql of fks) {
    try {
      await prisma.$executeRawUnsafe(sql);
    } catch (e) {
      console.warn('[schema] fk warn:', String(e.message || e).split('\n')[0]);
    }
  }

  console.log('[schema] ok');
}

main()
  .catch((e) => {
    console.error('[schema] failed', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
