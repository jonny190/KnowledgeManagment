-- AlterTable: rename column token -> tokenHash on Invite
ALTER TABLE "Invite" RENAME COLUMN "token" TO "tokenHash";

-- DropIndex
DROP INDEX "Invite_token_key";

-- CreateIndex
CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");
