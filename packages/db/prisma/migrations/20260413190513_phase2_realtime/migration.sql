-- CreateTable
CREATE TABLE "NoteDoc" (
    "noteId" TEXT NOT NULL,
    "state" BYTEA NOT NULL,
    "clock" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoteDoc_pkey" PRIMARY KEY ("noteId")
);

-- CreateTable
CREATE TABLE "RealtimeGrant" (
    "jti" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RealtimeGrant_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE INDEX "RealtimeGrant_userId_idx" ON "RealtimeGrant"("userId");

-- CreateIndex
CREATE INDEX "RealtimeGrant_noteId_idx" ON "RealtimeGrant"("noteId");

-- CreateIndex
CREATE INDEX "RealtimeGrant_expiresAt_idx" ON "RealtimeGrant"("expiresAt");

-- AddForeignKey
ALTER TABLE "NoteDoc" ADD CONSTRAINT "NoteDoc_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
