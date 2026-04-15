import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const ts = Date.now();

export const COLLAB_SEED_PATH = path.join(tmpdir(), "km-collab-seed.json");

export interface CollabSeedData {
  userA: { email: string; password: string };
  userB: { email: string; password: string };
  vaultId: string;
  noteId: string;
}

export default async function globalSetup(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await prisma.realtimeGrant.deleteMany();
    await prisma.noteDoc.deleteMany();
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

    // Seed two users who share a workspace vault and have a note in common.
    // This fixture is read by realtime-collab.spec.ts.
    const passwordA = "password-alpha-123";
    const passwordB = "password-beta-456";

    const userA = await prisma.user.create({
      data: {
        email: `collab-a-${ts}@test.local`,
        name: "Alice",
        passwordHash: await hash(passwordA, 12),
      },
    });

    const userB = await prisma.user.create({
      data: {
        email: `collab-b-${ts}@test.local`,
        name: "Bob",
        passwordHash: await hash(passwordB, 12),
      },
    });

    const workspace = await prisma.workspace.create({
      data: {
        name: "CollabCo",
        slug: `collabco-${ts}`,
        ownerId: userA.id,
      },
    });

    await prisma.membership.createMany({
      data: [
        { workspaceId: workspace.id, userId: userA.id, role: "OWNER" },
        { workspaceId: workspace.id, userId: userB.id, role: "MEMBER" },
      ],
    });

    const vault = await prisma.vault.create({
      data: { ownerType: "WORKSPACE", ownerId: workspace.id, name: "CollabCo" },
    });

    const root = await prisma.folder.create({
      data: { vaultId: vault.id, parentId: null, name: "", path: "" },
    });

    const note = await prisma.note.create({
      data: {
        vaultId: vault.id,
        folderId: root.id,
        title: "Shared Note",
        slug: `shared-note-${ts}`,
        content: "",
        createdById: userA.id,
        updatedById: userA.id,
      },
    });

    const seed: CollabSeedData = {
      userA: { email: userA.email!, password: passwordA },
      userB: { email: userB.email!, password: passwordB },
      vaultId: vault.id,
      noteId: note.id,
    };

    // Persist to a temp file so worker processes can read it.
    writeFileSync(COLLAB_SEED_PATH, JSON.stringify(seed), "utf8");

    // Warm the Next.js dev server by hitting the auth pages so the first
    // real test does not time out on first-compile latency.
    const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
    for (const path of ["/signup", "/login", "/", "/api/auth/csrf"]) {
      try {
        await fetch(`${base}${path}`, { redirect: "manual" });
      } catch {
        // best effort
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}
