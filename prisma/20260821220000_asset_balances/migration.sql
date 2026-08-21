CREATE TABLE IF NOT EXISTS "AssetBalance" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "asset" TEXT NOT NULL,
  "amount" DECIMAL(24,12) NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssetBalance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AssetBalance_userId_asset_key" ON "AssetBalance"("userId", "asset");
CREATE INDEX IF NOT EXISTS "AssetBalance_userId_idx" ON "AssetBalance"("userId");

ALTER TABLE "FinanceRequest" ADD COLUMN IF NOT EXISTS "toAmount" DECIMAL(24,12);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssetBalance_userId_fkey') THEN
    ALTER TABLE "AssetBalance"
      ADD CONSTRAINT "AssetBalance_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
