import { test, expect } from "@playwright/test";

const PASSWORD = "password-resp-123";

async function signup(page: import("@playwright/test").Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL("/", { timeout: 15000 });
}

test.describe("mobile viewport (390x844)", () => {
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
    await signup(page, email);

    // Enter the first workspace + vault.
    await page.goto("/workspaces");
    await page.getByRole("link", { name: /workspace|personal/i }).first().click();
    await page.waitForURL(/\/vault\//, { timeout: 15000 });

    // Create a note through the file tree's 3-dot menu (touch flow).
    await page.getByRole("button", { name: /Actions for/ }).first().click();
    await page.getByRole("menuitem", { name: "New note" }).click();
    page.once("dialog", async (d) => d.accept("mobile test note"));
    await page.waitForURL(/\/note\//, { timeout: 15000 });

    // Top bar present.
    await expect(page.getByRole("button", { name: "Files" })).toBeVisible();
    await expect(page.getByRole("button", { name: "AI" })).toBeVisible();

    // Files drawer opens.
    await page.getByRole("button", { name: "Files" }).click();
    await expect(page.getByRole("dialog", { name: "Files" })).toBeVisible();

    // Backdrop dismiss.
    await page.getByTestId("drawer-backdrop").click();
    await expect(page.getByRole("dialog", { name: "Files" })).toHaveCount(0);

    // Editor accepts text.
    await page.getByTestId("note-editor").click();
    await page.keyboard.type("hello from phone");
    await expect(page.locator(".cm-content")).toContainText("hello from phone");
  });

  test("file tree 3-dot menu lists Rename, Delete, Move, New note", async ({ page }) => {
    test.setTimeout(120000);
    const email = `resp-menu-${Date.now()}@test.local`;
    await signup(page, email);
    await page.goto("/workspaces");
    await page.getByRole("link", { name: /workspace|personal/i }).first().click();
    await page.waitForURL(/\/vault\//, { timeout: 15000 });

    await page.getByRole("button", { name: /Actions for/ }).first().click();
    await expect(page.getByRole("menuitem", { name: "New note" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
    // "Move" is hidden on the root folder (per FileTreeItem); verify on a child.
    // The root always exists so new-folder first, then test Move on the child.
    await page.getByRole("menuitem", { name: "New folder" }).click();
    page.once("dialog", async (d) => d.accept("child"));
    await page.waitForTimeout(500);
    // Open the child folder's 3-dot menu.
    const actionButtons = page.getByRole("button", { name: /Actions for child/ });
    await actionButtons.first().click();
    await expect(page.getByRole("menuitem", { name: "Move" })).toBeVisible();
  });

  test("NoteShareDialog fits viewport at 390px with no horizontal scroll", async ({ page }) => {
    test.setTimeout(120000);
    const email = `resp-share-${Date.now()}@test.local`;
    await signup(page, email);
    await page.goto("/workspaces");
    await page.getByRole("link", { name: /workspace|personal/i }).first().click();
    await page.waitForURL(/\/vault\//, { timeout: 15000 });

    // Make a note and open it.
    await page.getByRole("button", { name: /Actions for/ }).first().click();
    await page.getByRole("menuitem", { name: "New note" }).click();
    page.once("dialog", async (d) => d.accept("share me"));
    await page.waitForURL(/\/note\//, { timeout: 15000 });

    await page.getByRole("button", { name: "Share" }).click();
    const dlg = page.getByRole("dialog", { name: "Share note" });
    await expect(dlg).toBeVisible();
    const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyScrollWidth).toBeLessThanOrEqual(390);
  });
});
