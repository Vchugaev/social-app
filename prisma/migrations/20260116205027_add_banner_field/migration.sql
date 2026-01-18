/*
  Warnings:

  - A unique constraint covering the columns `[bannerId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "bannerId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "User_bannerId_key" ON "public"."User"("bannerId");

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_bannerId_fkey" FOREIGN KEY ("bannerId") REFERENCES "public"."File"("id") ON DELETE SET NULL ON UPDATE CASCADE;
