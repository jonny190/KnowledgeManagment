import { test, expect } from "@playwright/test";

const ts = Date.now();
const EMAIL = `plugins-${ts}@test.local`;
const PASSWORD = "password123";
const NAME = "Plugin Tester";

test("wordcount plugin updates status bar on save", async ({ page, baseURL }) => {
  test.setTimeout(120000);

  // 1. Sign up
  await page.goto("/signup");
  await page.getByLabel("Name").fill(NAME);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL("/", { timeout: 15000 });

  // 2. Create a workspace to get a vault
  await page.goto("/workspaces/new");
  await page.locator("input[name='name']").fill("PluginTest");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/workspaces\/.+\/members/, { timeout: 15000 });

  // 3. Get vault and folder IDs
  const vaultsResp = await page.request.get("/api/vaults");
  const vaultsBody = await vaultsResp.json();
  const vault = vaultsBody.vaults[0];
  expect(vault).toBeTruthy();
  const vaultId: string = vault.id;

  const treeResp = await page.request.get(`/api/vaults/${vaultId}/tree`);
  const treeBody = await treeResp.json();
  const rootFolderId: string = treeBody.root.id;
  expect(rootFolderId).toBeTruthy();

  // 4. Register the wordcount plugin via the settings page
  await page.goto("/settings/plugins");
  const pluginUrl = `${baseURL}/plugins/wordcount.js`;
  await page.locator("input[placeholder^='https']").fill(pluginUrl);
  await page.getByRole("button", { name: "Add" }).click();
  // Wait for the plugin to appear in the list
  await expect(page.locator(`text=${pluginUrl}`)).toBeVisible({ timeout: 5000 });

  // 5. Create a note via API
  const noteResp = await page.request.post("/api/notes", {
    data: { vaultId, folderId: rootFolderId, title: "Plugin Test Note" },
  });
  expect(noteResp.status()).toBe(201);
  const noteId: string = (await noteResp.json()).note.id;

  // 6. Navigate to the note and type some content to trigger autosave
  await page.goto(`/vault/${vaultId}/note/${noteId}`);
  await expect(page.locator("h1")).toHaveText("Plugin Test Note", { timeout: 10000 });
  const editorContent = page.locator(".cm-content");
  await editorContent.waitFor({ state: "visible", timeout: 10000 });
  await editorContent.click();
  await page.keyboard.type("one two three four five");

  // 7. Wait for autosave then check status bar shows word count
  await page.waitForRequest(
    (req) => req.url().includes(`/api/notes/${noteId}`) && req.method() === "PATCH",
    { timeout: 10000 },
  );

  // 8. Assert the status bar shows the word count
  await expect(page.locator("text=5 words")).toBeVisible({ timeout: 5000 });
});
