-- AlterTable User - add lastActiveAt
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable UserSettings - add privacy fields
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "whoCanMessage" TEXT NOT NULL DEFAULT 'everyone';
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "whoCanAddFriend" TEXT NOT NULL DEFAULT 'everyone';
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "whoCanSeeFriends" TEXT NOT NULL DEFAULT 'everyone';
ALTER TABLE "UserSettings" ADD COLUMN IF NOT EXISTS "hideOnlineStatus" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UserSettings" ALTER COLUMN "darkMode" SET DEFAULT false;
ALTER TABLE "UserSettings" ALTER COLUMN "privateAccount" SET DEFAULT false;

-- CreateTable UserSession
CREATE TABLE IF NOT EXISTS "UserSession" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "UserSession_sessionToken_key" ON "UserSession"("sessionToken");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserSession_userId_idx" ON "UserSession"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserSession_sessionToken_idx" ON "UserSession"("sessionToken");

-- AddForeignKey
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'UserSession_userId_fkey'
    ) THEN
        ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Add onDelete CASCADE to UserSettings if not exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'UserSettings_userId_fkey'
    ) THEN
        ALTER TABLE "UserSettings" DROP CONSTRAINT "UserSettings_userId_fkey";
    END IF;
    ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
END $$;
