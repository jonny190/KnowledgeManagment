import { PrismaClient } from "@prisma/client";

export default async function globalSetup(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await prisma.link.deleteMany();
    await prisma.note.deleteMany();
    await prisma.attachment.deleteMany();
    await prisma.folder.deleteMany();
    await prisma.exportJob.deleteMany();
    await prisma.vault.deleteMany();
    await prisma.invite.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.workspace.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.verificationToken.deleteMany();
    await prisma.user.deleteMany();
  } finally {
    await prisma.$disconnect();
  }
}
