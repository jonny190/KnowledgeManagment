/*
  Warnings:

  - You are about to drop the column `error` on the `ExportJob` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ExportJob" DROP COLUMN "error",
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "requestedByUserId" TEXT;
