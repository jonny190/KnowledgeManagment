import { test, expect } from "@playwright/test";
import { prisma } from "@km/db";
import { createUser, createWorkspaceFixture } from "../tests/helpers/db";
import { generateInviteToken } from "../src/lib/invite-token";

const ts = Date.now();
const OWNER_EMAIL = `owner-${ts}@test.local`;
const OWNER_PASSWORD = "password123";
const OWNER_NAME = "Owner User";

const INVITEE_EMAIL = `invitee-${ts}@test.local`;
const INVITEE_PASSWORD = "password456";
const INVITEE_NAME = "Invitee User";

test("workspace invite golden path", async ({ page }) => {
  // 1. Sign up the owner via UI
  await page.goto("/signup");
  await page.getByLabel("Name").fill(OWNER_NAME);
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL("/");

  // 2. Owner creates a workspace
  await page.goto("/workspaces/new");
  await page.locator("input[name='name']").fill("Acme");
  await page.getByRole("button", { name: "Create" }).click();
  // After create, redirected to /workspaces/{id}/members
  await page.waitForURL(/\/workspaces\/.+\/members/);
  const membersUrl = page.url();
  const workspaceId = membersUrl.match(/\/workspaces\/([^/]+)\/members/)?.[1];
  expect(workspaceId).toBeTruthy();

  // 3. Seed an invite token directly in the DB (avoids needing to extract it from email)
  const { token, tokenHash } = generateInviteToken();
  await prisma.invite.create({
    data: {
      workspaceId: workspaceId!,
      email: INVITEE_EMAIL,
      tokenHash,
      role: "MEMBER",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
    },
  });

  // 4. Log out the owner - navigate to home where the Log out link lives
  await page.goto("/");
  await page.getByRole("link", { name: "Log out" }).click();
  await expect(page).toHaveURL("/");

  // 5. Invitee signs up
  await page.goto("/signup");
  await page.getByLabel("Name").fill(INVITEE_NAME);
  await page.getByLabel("Email").fill(INVITEE_EMAIL);
  await page.getByLabel("Password").fill(INVITEE_PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL("/");

  // 6. Invitee visits the invite link
  await page.goto(`/invites/${token}`);
  await expect(page.getByRole("heading", { name: "Join Acme" })).toBeVisible();
  await expect(page.getByText("MEMBER")).toBeVisible();

  // 7. Invitee accepts the invite
  await page.getByRole("button", { name: "Accept invite" }).click();

  // 8. After accepting, invitee is redirected to the workspace members page
  await page.waitForURL(`/workspaces/${workspaceId}/members`);
  await expect(page.getByRole("heading", { name: "Acme members" })).toBeVisible();
  await expect(page.getByText(INVITEE_EMAIL)).toBeVisible();
});
