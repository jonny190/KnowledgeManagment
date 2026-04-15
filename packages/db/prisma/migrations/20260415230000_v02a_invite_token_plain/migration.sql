-- AlterTable: add optional plain token column to Invite so the worker can
-- include it in invite email accept URLs without needing to reconstruct the
-- raw token from the hash.
ALTER TABLE "Invite" ADD COLUMN IF NOT EXISTS "token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Invite_token_key" ON "Invite"("token");
