/*
  Warnings:

  - A unique constraint covering the columns `[userId,postId]` on the table `PostView` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "lastActive" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex (only if not exists)
CREATE UNIQUE INDEX IF NOT EXISTS "PostView_userId_postId_key" ON "public"."PostView"("userId", "postId");
