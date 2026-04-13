-- CreateEnum
CREATE TYPE "DiagramKind" AS ENUM ('DRAWIO', 'BPMN');

-- AlterTable
ALTER TABLE "Link" ADD COLUMN     "targetDiagramId" TEXT;

-- CreateTable
CREATE TABLE "Diagram" (
    "id" TEXT NOT NULL,
    "vaultId" TEXT NOT NULL,
    "folderId" TEXT,
    "kind" "DiagramKind" NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "xml" TEXT NOT NULL,
    "contentUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "Diagram_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Diagram_vaultId_idx" ON "Diagram"("vaultId");

-- CreateIndex
CREATE INDEX "Diagram_folderId_idx" ON "Diagram"("folderId");

-- CreateIndex
CREATE INDEX "Diagram_vaultId_kind_idx" ON "Diagram"("vaultId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Diagram_vaultId_slug_key" ON "Diagram"("vaultId", "slug");

-- CreateIndex
CREATE INDEX "Link_targetDiagramId_idx" ON "Link"("targetDiagramId");

-- AddForeignKey
ALTER TABLE "Link" ADD CONSTRAINT "Link_targetDiagramId_fkey" FOREIGN KEY ("targetDiagramId") REFERENCES "Diagram"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagram" ADD CONSTRAINT "Diagram_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "Vault"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Diagram" ADD CONSTRAINT "Diagram_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
