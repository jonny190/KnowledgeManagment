-- CreateEnum
CREATE TYPE "NoteVisibility" AS ENUM ('WORKSPACE', 'PRIVATE');

-- CreateEnum
CREATE TYPE "NoteShareRole" AS ENUM ('VIEW', 'EDIT');

-- AlterTable
ALTER TABLE "Note" ADD COLUMN "visibility" "NoteVisibility" NOT NULL DEFAULT 'WORKSPACE';

-- CreateTable
CREATE TABLE "NoteShare" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "NoteShareRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "NoteShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteLink" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "NoteLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NoteShare_noteId_userId_key" ON "NoteShare"("noteId", "userId");

-- CreateIndex
CREATE INDEX "NoteShare_userId_idx" ON "NoteShare"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NoteLink_slug_key" ON "NoteLink"("slug");

-- CreateIndex
CREATE INDEX "NoteLink_noteId_idx" ON "NoteLink"("noteId");

-- AddForeignKey
ALTER TABLE "NoteShare" ADD CONSTRAINT "NoteShare_noteId_fkey"
  FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteShare" ADD CONSTRAINT "NoteShare_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteLink" ADD CONSTRAINT "NoteLink_noteId_fkey"
  FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
