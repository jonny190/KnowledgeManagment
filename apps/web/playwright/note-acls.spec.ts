import { test, expect } from "@playwright/test";

const PASSWORD = "password-acl-123";

async function signup(page: Parameters<typeof test>[1] extends (args: { page: infer P }) => unknown ? P : never, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL("/", { timeout: 15000 });
}

async function login(page: Parameters<typeof test>[1] extends (args: { page: infer P }) => unknown ? P : never, email: string) {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/", { timeout: 15000 });
}

test("alice shares PRIVATE note with bob via API, carol is blocked, public link round-trip", async ({
  browser,
  page,
}) => {
  test.setTimeout(120000);

  const ts = Date.now();
  const aliceEmail = `alice-acl-${ts}@test.local`;
  const bobEmail = `bob-acl-${ts}@test.local`;
  const carolEmail = `carol-acl-${ts}@test.local`;

  // Sign up all three users
  await signup(page, aliceEmail);

  const bobCtx = await browser.newContext();
  const bobPage = await bobCtx.newPage();
  await signup(bobPage, bobEmail);

  const carolCtx = await browser.newContext();
  const carolPage = await carolCtx.newPage();
  await signup(carolPage, carolEmail);

  // Alice creates a workspace and vault
  await page.goto("/workspaces/new");
  await page.locator("input[name='name']").fill("AclTest");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/members/);

  // Fetch alice's WORKSPACE vault (not the auto-created personal one)
  const vaultsRes = await page.request.get("/api/vaults");
  const { vaults } = await vaultsRes.json();
  const workspaceVault = (vaults as Array<{ id: string; ownerType: string }>).find(
    (v) => v.ownerType === "WORKSPACE",
  );
  expect(workspaceVault).toBeTruthy();
  const vaultId: string = workspaceVault!.id;

  const treeRes = await page.request.get(`/api/vaults/${vaultId}/tree`);
  const { root } = await treeRes.json();

  const noteRes = await page.request.post("/api/notes", {
    data: { vaultId, folderId: root.id, title: "Top Secret Note" },
  });
  const { note } = await noteRes.json();
  const noteId: string = note.id;

  // Flip note to PRIVATE via API
  const visRes = await page.request.post(`/api/notes/${noteId}/visibility`, {
    data: { visibility: "PRIVATE" },
  });
  expect(visRes.status()).toBe(200);

  // Share with Bob as EDIT via API
  const shareRes = await page.request.post(`/api/notes/${noteId}/shares`, {
    data: { email: bobEmail, role: "EDIT" },
  });
  expect(shareRes.status()).toBe(201);

  // Verify shares list includes Bob
  const sharesRes = await page.request.get(`/api/notes/${noteId}/shares`);
  const sharesBody = await sharesRes.json();
  expect(sharesBody.shares).toHaveLength(1);
  expect(sharesBody.shares[0].user.email).toBe(bobEmail);

  // Create a public link
  const linkRes = await page.request.post(`/api/notes/${noteId}/links`, {
    data: {},
  });
  expect(linkRes.status()).toBe(201);
  const { link } = await linkRes.json();
  const publicPath = `/public/n/${link.slug}`;

  // Bob can read the note via API
  const bobNoteRes = await bobPage.request.get(`/api/notes/${noteId}`);
  expect(bobNoteRes.status()).toBe(200);
  const bobNote = await bobNoteRes.json();
  expect(bobNote.note.title).toBe("Top Secret Note");

  // Carol cannot read the note (not shared with her)
  const carolNoteRes = await carolPage.request.get(`/api/notes/${noteId}`);
  expect(carolNoteRes.status()).toBe(403);

  // Unauthenticated browser can open the public link page
  const anonCtx = await browser.newContext();
  const anonPage = await anonCtx.newPage();
  const publicRes = await anonPage.request.get(`/api/public/n/${link.slug}`);
  expect(publicRes.status()).toBe(200);
  const publicBody = await publicRes.json();
  expect(publicBody.note.title).toBe("Top Secret Note");

  // Alice revokes the link
  const revokeRes = await page.request.delete(`/api/notes/${noteId}/links/${link.id}`);
  expect(revokeRes.status()).toBe(204);

  // After revoke, the public link returns 404
  const afterRevokeRes = await anonPage.request.get(`/api/public/n/${link.slug}`);
  expect(afterRevokeRes.status()).toBe(404);

  await bobCtx.close();
  await carolCtx.close();
  await anonCtx.close();
});

test("Share button is visible on note page", async ({ page }) => {
  test.setTimeout(60000);

  const ts = Date.now();
  const email = `share-btn-${ts}@test.local`;
  await signup(page, email);

  await page.goto("/workspaces/new");
  await page.locator("input[name='name']").fill("ShareBtnTest");
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/members/);

  const vaultsRes = await page.request.get("/api/vaults");
  const { vaults } = await vaultsRes.json();
  const vaultId: string = vaults[0].id;

  const treeRes = await page.request.get(`/api/vaults/${vaultId}/tree`);
  const { root } = await treeRes.json();

  const noteRes = await page.request.post("/api/notes", {
    data: { vaultId, folderId: root.id, title: "Share Button Test" },
  });
  const { note } = await noteRes.json();

  await page.goto(`/vault/${vaultId}/note/${note.id}`);
  await expect(page.getByRole("button", { name: "Share" })).toBeVisible({ timeout: 15000 });
});
