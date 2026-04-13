import { prisma } from "@km/db";
import { beforeEach, afterAll } from "vitest";

beforeEach(async () => {
  // Truncate in dependency order.
  await prisma.aiMessage.deleteMany();
  await prisma.aiConversation.deleteMany();
  await prisma.aiUsage.deleteMany();
  await prisma.link.deleteMany();
  await prisma.diagram.deleteMany();
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
});

afterAll(async () => {
  await prisma.$disconnect();
});
