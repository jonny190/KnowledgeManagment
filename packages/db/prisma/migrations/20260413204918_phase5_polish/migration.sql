-- AlterTable
ALTER TABLE "Note" ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce("title",'')), 'A') || setweight(to_tsvector('simple', coalesce("content",'')), 'B')) STORED;

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoteTag" (
    "noteId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "NoteTag_pkey" PRIMARY KEY ("noteId","tagId")
);

-- CreateTable
CREATE TABLE "UserPlugin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPlugin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tag_vaultId_idx" ON "Tag"("vaultId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_vaultId_name_key" ON "Tag"("vaultId", "name");

-- CreateIndex
CREATE INDEX "NoteTag_tagId_idx" ON "NoteTag"("tagId");

-- CreateIndex
CREATE INDEX "UserPlugin_userId_idx" ON "UserPlugin"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPlugin_userId_url_key" ON "UserPlugin"("userId", "url");

-- CreateIndex
CREATE INDEX "Note_searchVector_idx" ON "Note" USING GIN ("searchVector");

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "Vault"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteTag" ADD CONSTRAINT "NoteTag_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteTag" ADD CONSTRAINT "NoteTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPlugin" ADD CONSTRAINT "UserPlugin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
