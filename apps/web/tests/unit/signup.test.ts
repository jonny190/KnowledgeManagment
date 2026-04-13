import { describe, it, expect } from "vitest";
import { compare } from "bcryptjs";
import { prisma } from "@km/db";
import { signupWithCredentials } from "@/lib/signup";

describe("signupWithCredentials", () => {
  it("creates a user, personal vault, and root folder atomically", async () => {
    const result = await signupWithCredentials({
      email: "alice@example.com",
      password: "correct horse battery",
      name: "Alice",
    });

    expect(result.user.email).toBe("alice@example.com");
    expect(result.user.passwordHash).not.toBeNull();
    expect(await compare("correct horse battery", result.user.passwordHash!)).toBe(true);

    expect(result.vault.ownerType).toBe("USER");
    expect(result.vault.ownerId).toBe(result.user.id);

    expect(result.rootFolder.vaultId).toBe(result.vault.id);
    expect(result.rootFolder.parentId).toBeNull();

    const foldersInDb = await prisma.folder.findMany({ where: { vaultId: result.vault.id } });
    expect(foldersInDb).toHaveLength(1);
  });

  it("rejects duplicate email", async () => {
    await signupWithCredentials({
      email: "bob@example.com",
      password: "password123",
    });
    await expect(
      signupWithCredentials({ email: "bob@example.com", password: "password123" }),
    ).rejects.toThrow(/already/i);
  });

  it("validates the email and password with zod", async () => {
    await expect(
      signupWithCredentials({ email: "not-an-email", password: "password123" }),
    ).rejects.toThrow();
    await expect(
      signupWithCredentials({ email: "ok@example.com", password: "short" }),
    ).rejects.toThrow();
  });
});
