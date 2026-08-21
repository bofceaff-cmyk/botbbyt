DO $$
BEGIN
  -- Свежая установка: таблиц ещё нет
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'User'
  ) THEN
    CREATE TABLE "User" (
      "id" SERIAL NOT NULL,
      "telegramId" BIGINT NOT NULL,
      "usernameTg" TEXT,
      "firstNameTg" TEXT,
      "displayName" TEXT,
      "usdtBalance" DECIMAL(18,6) NOT NULL DEFAULT 0,
      "accountNumber" TEXT,
      "accountRequestStatus" TEXT NOT NULL DEFAULT 'none',
      "verified" BOOLEAN NOT NULL DEFAULT false,
      "verifiedAt" TIMESTAMP(3),
      "isAdmin" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "User_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "Transfer" (
      "id" SERIAL NOT NULL,
      "fromUserId" INTEGER NOT NULL,
      "toUserId" INTEGER NOT NULL,
      "amount" DECIMAL(18,6) NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "BalanceHistory" (
      "id" SERIAL NOT NULL,
      "userId" INTEGER NOT NULL,
      "type" TEXT NOT NULL,
      "amount" DECIMAL(18,6) NOT NULL,
      "balance" DECIMAL(18,6) NOT NULL,
      "meta" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "BalanceHistory_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "SupportThread" (
      "id" SERIAL NOT NULL,
      "userId" INTEGER NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'open',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "SupportThread_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE "SupportMessage" (
      "id" SERIAL NOT NULL,
      "threadId" INTEGER NOT NULL,
      "sender" TEXT NOT NULL,
      "text" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
    );

    CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");
    CREATE UNIQUE INDEX "User_accountNumber_key" ON "User"("accountNumber");

    ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_fromUserId_fkey"
      FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_toUserId_fkey"
      FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    ALTER TABLE "BalanceHistory" ADD CONSTRAINT "BalanceHistory_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    ALTER TABLE "SupportThread" ADD CONSTRAINT "SupportThread_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_threadId_fkey"
      FOREIGN KEY ("threadId") REFERENCES "SupportThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

  -- Апгрейд со старой схемы (pointsBalance / PointsHistory)
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'pointsBalance'
  ) THEN
    ALTER TABLE "User" RENAME COLUMN "pointsBalance" TO "usdtBalance";
    ALTER TABLE "User" ALTER COLUMN "usdtBalance" TYPE DECIMAL(18,6) USING "usdtBalance"::DECIMAL(18,6);
    ALTER TABLE "User" ALTER COLUMN "usdtBalance" SET DEFAULT 0;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'accountNumber'
    ) THEN
      ALTER TABLE "User" ADD COLUMN "accountNumber" TEXT;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'accountRequestStatus'
    ) THEN
      ALTER TABLE "User" ADD COLUMN "accountRequestStatus" TEXT NOT NULL DEFAULT 'none';
    END IF;

    CREATE UNIQUE INDEX IF NOT EXISTS "User_accountNumber_key" ON "User"("accountNumber");

    ALTER TABLE "Transfer" ALTER COLUMN "amount" TYPE DECIMAL(18,6) USING "amount"::DECIMAL(18,6);

    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'PointsHistory'
    ) THEN
      ALTER TABLE "PointsHistory" RENAME TO "BalanceHistory";
      ALTER TABLE "BalanceHistory" ALTER COLUMN "amount" TYPE DECIMAL(18,6) USING "amount"::DECIMAL(18,6);
      ALTER TABLE "BalanceHistory" ALTER COLUMN "balance" TYPE DECIMAL(18,6) USING "balance"::DECIMAL(18,6);
    END IF;
  END IF;
END $$;
