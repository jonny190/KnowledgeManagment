import { test, expect } from "@playwright/test";

const ts = Date.now();
const EMAIL = `graph-${ts}@test.local`;
const PASSWORD = "password123";
const NAME = "Graph Tester";

test("graph renders nodes and edges", async ({ page }) => {
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
  await page.locator("input[name='name']").fill("GraphTest");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/workspaces\/.+\/members/, { timeout: 15000 });

  // 3. Get vault + folder via API
  const vaultsResp = await page.request.get("/api/vaults");
  const vaultsBody = await vaultsResp.json();
  const vault = vaultsBody.vaults[0];
  expect(vault).toBeTruthy();
  const vaultId: string = vault.id;

  const treeResp = await page.request.get(`/api/vaults/${vaultId}/tree`);
  const treeBody = await treeResp.json();
  const rootFolderId: string = treeBody.root.id;
  expect(rootFolderId).toBeTruthy();

  // 4. Create notes A and B via API
  const noteAResp = await page.request.post("/api/notes", {
    data: { vaultId, folderId: rootFolderId, title: "A" },
  });
  expect(noteAResp.status()).toBe(201);
  const noteAId: string = (await noteAResp.json()).note.id;

  const noteBResp = await page.request.post("/api/notes", {
    data: { vaultId, folderId: rootFolderId, title: "B" },
  });
  expect(noteBResp.status()).toBe(201);
  const noteBId: string = (await noteBResp.json()).note.id;

  // 5. Type a wiki-link in note A to note B
  await page.goto(`/vault/${vaultId}/note/${noteAId}`);
  await expect(page.locator('header h1')).toHaveText("A", { timeout: 10000 });
  const editorContent = page.locator(".cm-content");
  await editorContent.waitFor({ state: "visible", timeout: 10000 });
  await editorContent.click();
  await page.keyboard.type("links to [[B]] and also mentions B");
  // Phase 2: realtime snapshot pipeline persists content after 5s debounce.
  await page.waitForTimeout(7000);

  // 6. Navigate to the graph page
  await page.goto(`/vault/${vaultId}/graph`);

  // 7. Assert Cytoscape mounted. It creates multiple canvases; wait for any
  //    of them to have a non-zero rendered height.
  await page.waitForFunction(
    () => {
      const canvases = Array.from(document.querySelectorAll("canvas"));
      return canvases.some((c) => c.height > 0);
    },
    { timeout: 15000 },
  );
  const canvasCount = await page.evaluate(() => document.querySelectorAll("canvas").length);
  expect(canvasCount).toBeGreaterThan(0);

  // 8. Verify the graph data API returns at least 2 nodes
  const graphResp = await page.request.get(`/api/vaults/${vaultId}/graph`);
  expect(graphResp.status()).toBe(200);
  const graphBody = await graphResp.json();
  expect(graphBody.nodes.length).toBeGreaterThanOrEqual(2);
  const nodeLabels = graphBody.nodes.map((n: { label: string }) => n.label);
  expect(nodeLabels).toContain("A");
  expect(nodeLabels).toContain("B");

  // Suppress unused variable warnings
  void noteBId;
});
