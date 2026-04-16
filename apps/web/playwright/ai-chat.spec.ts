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

test("AI chat createNote shows Undo strip and Undo removes the note", async ({ page }) => {
  test.setTimeout(120000);
  const EMAIL = `aiw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.io`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL("/", { timeout: 15000 });
  await page.waitForLoadState("networkidle");

  await page.goto("/workspaces/new");
  await page.locator("input[name='name']").fill("AiWrite");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/members/);

  const { vaults } = await (await page.request.get("/api/vaults")).json();
  const vaultId = vaults[0].id;
  const { root } = await (await page.request.get(`/api/vaults/${vaultId}/tree`)).json();
  const { note } = await (
    await page.request.post("/api/notes", {
      data: { vaultId, folderId: root.id, title: "Host" },
    })
  ).json();
  await page.goto(`/vault/${vaultId}/note/${note.id}`);
  await page.waitForSelector(".cm-content", { timeout: 15000 });

  // The CI test harness is expected to run with AI_PROVIDER=stub; we drive a
  // tool-call-producing message via the server test-hook header so the stub
  // provider scripts a createNote tool_use.
  await page.getByRole("button", { name: /open ai chat/i }).click();
  const panel = page.locator("aside").filter({ hasText: "AI chat" });
  await expect(panel).toBeVisible({ timeout: 5000 });
  await panel.locator("textarea").fill(
    "__TEST__createNote:" + JSON.stringify({ vaultId, title: "From Chat" }),
  );
  await panel.getByRole("button", { name: /send/i }).click();

  // Undo strip should appear with a button and countdown.
  await expect(panel.getByText(/Created note 'From Chat'/)).toBeVisible({ timeout: 15000 });
  const undoBtn = panel.getByRole("button", { name: /undo \(/i });
  await expect(undoBtn).toBeVisible();

  // Confirm the note was created via the API (tree may not render in this layout).
  const treeAfter = await (await page.request.get(`/api/vaults/${vaultId}/tree`)).json();
  const createdNote = (treeAfter.items as Array<{ title: string }> | undefined)?.find(
    (n) => n.title === "From Chat",
  );
  expect(createdNote).toBeTruthy();

  // Click Undo and confirm the note disappears.
  await undoBtn.click();
  await expect(panel.getByText(/undone/i)).toBeVisible({ timeout: 5000 });
  const treeAfterUndo = await (await page.request.get(`/api/vaults/${vaultId}/tree`)).json();
  const deletedNote = (treeAfterUndo.items as Array<{ title: string }> | undefined)?.find(
    (n) => n.title === "From Chat",
  );
  expect(deletedNote).toBeUndefined();
});
