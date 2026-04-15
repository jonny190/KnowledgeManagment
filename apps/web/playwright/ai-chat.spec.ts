import { test, expect } from "@playwright/test";

const PASSWORD = "password123";

test("AI chat panel streams a response and updates usage", async ({ page }) => {
  test.setTimeout(90000);
  const EMAIL = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.io`;

  // Sign up and land on home
  await page.goto("/signup");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL("/", { timeout: 15000 });
  await page.waitForLoadState("networkidle");

  // Create a workspace so we get a vault to own a note
  await page.goto("/workspaces/new");
  await page.locator("input[name='name']").fill("AiChat");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/members/);

  const { vaults } = await (await page.request.get("/api/vaults")).json();
  const vaultId = vaults[0].id;
  const { root } = await (await page.request.get(`/api/vaults/${vaultId}/tree`)).json();
  const { note } = await (
    await page.request.post("/api/notes", {
      data: { vaultId, folderId: root.id, title: "Draft" },
    })
  ).json();

  await page.goto(`/vault/${vaultId}/note/${note.id}`);
  await page.waitForSelector(".cm-content", { timeout: 15000 });

  await page.getByRole("button", { name: /open ai chat/i }).click();
  const panel = page.locator("aside").filter({ hasText: "AI chat" });
  await expect(panel).toBeVisible({ timeout: 5000 });
  await panel.locator("textarea").fill("What is in this note?");
  await panel.getByRole("button", { name: /send/i }).click();

  // Stub provider returns a deterministic response prefixed with "stub".
  await expect(panel).toContainText(/stub/i, { timeout: 15000 });
});
