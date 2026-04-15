import { test, expect } from "@playwright/test";

const ts = Date.now();
const EMAIL = `search-tags-${ts}@test.local`;
const PASSWORD = "password123";
const NAME = "SearchTags Tester";

test("search palette finds a note, tag sidebar filters correctly", async ({ page }) => {
  test.setTimeout(120000);

  // 1. Sign up
  await page.goto("/signup");
  await page.getByLabel("Name").fill(NAME);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL("/", { timeout: 15000 });

  // 2. Create a workspace
  await page.goto("/workspaces/new");
  await page.locator("input[name='name']").fill("SearchTest");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/workspaces\/.+\/members/, { timeout: 15000 });

  // 3. Get vault + folder IDs via API
  const vaultsResp = await page.request.get("/api/vaults");
  const vaultsBody = await vaultsResp.json();
  const vault = vaultsBody.vaults[0];
  expect(vault).toBeTruthy();
  const vaultId: string = vault.id;

  const treeResp = await page.request.get(`/api/vaults/${vaultId}/tree`);
  const treeBody = await treeResp.json();
  const rootFolderId: string = treeBody.root.id;
  expect(rootFolderId).toBeTruthy();

  // 4. Create note Alpha with #draft tag via API, then set content via editor
  const alphaResp = await page.request.post("/api/notes", {
    data: { vaultId, folderId: rootFolderId, title: "AlphaUnique" },
  });
  expect(alphaResp.status()).toBe(201);
  const alphaId: string = (await alphaResp.json()).note.id;

  // 5. Create note Bravo with #draft tag
  const bravoResp = await page.request.post("/api/notes", {
    data: { vaultId, folderId: rootFolderId, title: "BravoDistinctive" },
  });
  expect(bravoResp.status()).toBe(201);
  const bravoId: string = (await bravoResp.json()).note.id;

  // 6. Write content into AlphaUnique containing #draft
  await page.goto(`/vault/${vaultId}/note/${alphaId}`);
  await expect(page.locator("h1")).toHaveText("AlphaUnique", { timeout: 10000 });
  const editorAlpha = page.locator(".cm-content");
  await editorAlpha.waitFor({ state: "visible", timeout: 10000 });
  await editorAlpha.click();
  await page.keyboard.type("introductory text with #draft");
  // Phase 2: realtime snapshot pipeline persists content after 5s debounce.
  await page.waitForTimeout(7000);

  // 7. Write content into BravoDistinctive containing #draft
  await page.goto(`/vault/${vaultId}/note/${bravoId}`);
  await expect(page.locator("h1")).toHaveText("BravoDistinctive", { timeout: 10000 });
  const editorBravo = page.locator(".cm-content");
  await editorBravo.waitFor({ state: "visible", timeout: 10000 });
  await editorBravo.click();
  await page.keyboard.type("a bravo note mentioning #draft");
  await page.waitForTimeout(7000);

  // 8. Use search API to confirm BravoDistinctive is searchable
  const searchResp = await page.request.get(
    `/api/search?vaultId=${vaultId}&q=bravo`,
  );
  expect(searchResp.status()).toBe(200);
  const searchBody = await searchResp.json();
  const titles = searchBody.results.map((r: { title: string }) => r.title);
  expect(titles).toContain("BravoDistinctive");

  // 9. Confirm tags API returns #draft with count >= 2
  const tagsResp = await page.request.get(`/api/vaults/${vaultId}/tags`);
  expect(tagsResp.status()).toBe(200);
  const tagsBody = await tagsResp.json();
  const draftTag = tagsBody.tags.find((t: { name: string; count: number }) => t.name === "draft");
  expect(draftTag).toBeTruthy();
  expect(draftTag.count).toBeGreaterThanOrEqual(2);

  // 10. Navigate to search page and verify Bravo appears in results
  await page.goto(`/search?vaultId=${vaultId}&q=bravo`);
  await expect(page.locator("text=BravoDistinctive")).toBeVisible({ timeout: 10000 });

  // 11. Navigate to tag index page and verify both notes appear under #draft
  await page.goto(`/vault/${vaultId}/tags/draft`);
  await expect(page.locator("text=AlphaUnique")).toBeVisible({ timeout: 10000 });
  await expect(page.locator("text=BravoDistinctive")).toBeVisible({ timeout: 10000 });
});
