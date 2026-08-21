ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "cardNumber" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "cardRequestStatus" TEXT NOT NULL DEFAULT 'none';

CREATE TABLE IF NOT EXISTS "FinanceRequest" (
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
);

CREATE INDEX IF NOT EXISTS "FinanceRequest_status_idx" ON "FinanceRequest"("status");
CREATE INDEX IF NOT EXISTS "FinanceRequest_userId_idx" ON "FinanceRequest"("userId");
CREATE INDEX IF NOT EXISTS "FinanceRequest_type_idx" ON "FinanceRequest"("type");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FinanceRequest_userId_fkey') THEN
    ALTER TABLE "FinanceRequest"
      ADD CONSTRAINT "FinanceRequest_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
