import { hash } from "bcryptjs";
import { prisma, type User, type Vault, type Folder } from "@km/db";
import { signupSchema, type SignupInput } from "@km/shared";

export interface SignupResult {
  user: User;
  vault: Vault;
  rootFolder: Folder;
}

export async function signupWithCredentials(input: SignupInput): Promise<SignupResult> {
  const parsed = signupSchema.parse(input);

  const existing = await prisma.user.findUnique({ where: { email: parsed.email } });
  if (existing) {
    throw new Error("An account with that email already exists");
  }

  const passwordHash = await hash(parsed.password, 12);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: parsed.email,
        passwordHash,
        name: parsed.name,
      },
    });
    const vault = await tx.vault.create({
      data: {
        ownerType: "USER",
        ownerId: user.id,
        name: "Personal",
      },
    });
    const rootFolder = await tx.folder.create({
      data: {
        vaultId: vault.id,
        name: "",
        path: "",
      },
    });
    return { user, vault, rootFolder };
  });
}
