import { test, expect } from "@playwright/test";

const PASSWORD = "password-resp-123";

async function signup(page: import("@playwright/test").Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL("/", { timeout: 15000 });
}

/** Sign up, create a workspace (which also creates a vault), return { vaultId, rootFolderId }. */
async function setupWorkspaceAndVault(page: import("@playwright/test").Page, email: string, wsName: string) {
  await signup(page, email);
  await page.goto("/workspaces/new");
  await page.locator("input[name='name']").fill(wsName);
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/workspaces\/.+\/members/, { timeout: 15000 });

  const { vaults } = await (await page.request.get("/api/vaults")).json();
  const vaultId: string = vaults[0].id;
  const { root } = await (await page.request.get(`/api/vaults/${vaultId}/tree`)).json();
  return { vaultId, rootFolderId: root.id as string };
}

/** Create a note via the API and navigate to its page, returning the note id. */
async function createNoteAndNavigate(
  page: import("@playwright/test").Page,
  vaultId: string,
  folderId: string,
  title: string,
) {
  const { note } = await (
    await page.request.post("/api/notes", {
      data: { vaultId, folderId, title },
    })
  ).json();
  await page.goto(`/vault/${vaultId}/note/${note.id}`);
  await page.waitForSelector(".cm-content", { timeout: 15000 });
  return note.id as string;
}

test.describe("mobile viewport (390x844)", () => {
  // Each test signs up as a fresh user; clear session state so prior test logins
  // do not interfere with subsequent credential sign-ins.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("signup form fits with no horizontal overflow", async ({ page }) => {
    const email = `resp-signup-${Date.now()}@test.local`;
    await page.goto("/signup");
    const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyScrollWidth).toBeLessThanOrEqual(390);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page).toHaveURL("/", { timeout: 15000 });
  });

  test("note page: top bar visible, drawers open and close, editor accepts text", async ({ page }) => {
    test.setTimeout(120000);
    const email = `resp-note-${Date.now()}@test.local`;
    const { vaultId, rootFolderId } = await setupWorkspaceAndVault(page, email, "RespNote");
    await createNoteAndNavigate(page, vaultId, rootFolderId, "mobile test note");

    // Top bar present (md:hidden so visible at 390px).
    await expect(page.getByRole("button", { name: "Files", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "AI", exact: true })).toBeVisible();

    // Files drawer opens.
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Files" })).toBeVisible();

    // Backdrop dismiss - click the exposed backdrop strip at the right edge.
    // The left drawer is 85vw wide; click the far right (outside the drawer).
    await page.getByTestId("drawer-backdrop").click({ position: { x: 380, y: 422 } });
    await expect(page.getByRole("dialog", { name: "Files" })).toHaveCount(0);

    // Editor accepts text.
    await page.getByTestId("note-editor").click();
    await page.keyboard.type("hello from phone");
    await expect(page.locator(".cm-content")).toContainText("hello from phone");
  });

  test("file tree 3-dot menu lists Rename, Delete, Move, New note", async ({ page }) => {
    test.setTimeout(120000);
    const email = `resp-menu-${Date.now()}@test.local`;
    const { vaultId, rootFolderId } = await setupWorkspaceAndVault(page, email, "RespMenu");
    await createNoteAndNavigate(page, vaultId, rootFolderId, "menu test note");

    // Open the files drawer first so the file tree is visible.
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Files" })).toBeVisible();

    await page.getByRole("button", { name: /Actions for/ }).first().click();
    await expect(page.getByRole("menuitem", { name: "New note" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
    // "Move" is hidden on the root folder; create a child folder and verify Move appears.
    // Register dialog handler before triggering the New folder action.
    page.once("dialog", async (d) => d.accept("child"));
    await page.getByRole("menuitem", { name: "New folder" }).click();
    // Wait for the folder to appear in the tree.
    const childFolderActions = page.getByRole("button", { name: /Actions for child/ });
    await expect(childFolderActions.first()).toBeVisible({ timeout: 10000 });
    // Open the child folder's 3-dot menu.
    await childFolderActions.first().click();
    await expect(page.getByRole("menuitem", { name: "Move" })).toBeVisible();
  });

  test("NoteShareDialog fits viewport at 390px with no horizontal scroll", async ({ page }) => {
    test.setTimeout(120000);
    const email = `resp-share-${Date.now()}@test.local`;
    const { vaultId, rootFolderId } = await setupWorkspaceAndVault(page, email, "RespShare");
    await createNoteAndNavigate(page, vaultId, rootFolderId, "share me");

    await page.getByRole("button", { name: "Share" }).click();
    const dlg = page.getByRole("dialog", { name: "Share note" });
    await expect(dlg).toBeVisible();
    const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyScrollWidth).toBeLessThanOrEqual(390);
  });
});
