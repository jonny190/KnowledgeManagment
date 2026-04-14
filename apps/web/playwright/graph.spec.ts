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
  await expect(page.locator("h1")).toHaveText("A", { timeout: 10000 });
  const editorContent = page.locator(".cm-content");
  await editorContent.waitFor({ state: "visible", timeout: 10000 });
  await editorContent.click();
  await page.keyboard.type("links to [[B]] and also mentions B");
  await page.waitForRequest(
    (req) => req.url().includes(`/api/notes/${noteAId}`) && req.method() === "PATCH",
    { timeout: 10000 },
  );

  // 6. Navigate to the graph page
  await page.goto(`/vault/${vaultId}/graph`);

  // 7. Assert a canvas element is present (Cytoscape uses canvas)
  await page.waitForSelector("canvas", { timeout: 15000 });
  const canvasCount = await page.evaluate(() => document.querySelectorAll("canvas").length);
  expect(canvasCount).toBeGreaterThan(0);

  // 8. Verify the graph data API returns at least 2 nodes
  const graphResp = await page.request.get(`/api/vaults/${vaultId}/graph`);
  expect(graphResp.status()).toBe(200);
  const graphBody = await graphResp.json();
  expect(graphBody.nodes.length).toBeGreaterThanOrEqual(2);
  const nodeTitles = graphBody.nodes.map((n: { title: string }) => n.title);
  expect(nodeTitles).toContain("A");
  expect(nodeTitles).toContain("B");

  // Suppress unused variable warnings
  void noteBId;
});
