import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { COLLAB_SEED_PATH, type CollabSeedData } from "./global-setup";

test("two browser contexts converge and show each other in ActiveUsers", async ({ browser }) => {
  const seeded = JSON.parse(readFileSync(COLLAB_SEED_PATH, "utf8")) as CollabSeedData;

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  async function login(
    page: typeof pageA,
    creds: { email: string; password: string },
  ) {
    await page.goto("/login");
    await page.fill('input[name="email"]', creds.email);
    await page.fill('input[name="password"]', creds.password);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/");
  }

  await login(pageA, seeded.userA);
  await login(pageB, seeded.userB);

  const notePath = `/vault/${seeded.vaultId}/note/${seeded.noteId}`;
  await pageA.goto(notePath);
  await pageB.goto(notePath);

  // Wait for both clients to connect to the realtime service.
  await expect(pageA.getByText("Live")).toBeVisible({ timeout: 15_000 });
  await expect(pageB.getByText("Live")).toBeVisible({ timeout: 15_000 });

  // Type in context A and assert context B receives the text.
  const editorA = pageA.getByTestId("note-editor");
  await editorA.click();
  await pageA.keyboard.type("hello from A ");

  await expect(pageB.getByTestId("note-editor")).toContainText("hello from A", {
    timeout: 5_000,
  });

  // Both ActiveUsers panels should show two avatars (one per connected user).
  const activeA = pageA.getByTestId("active-users");
  const activeB = pageB.getByTestId("active-users");
  await expect(activeA.locator("span")).toHaveCount(2, { timeout: 5_000 });
  await expect(activeB.locator("span")).toHaveCount(2, { timeout: 5_000 });

  await contextA.close();
  await contextB.close();
});
