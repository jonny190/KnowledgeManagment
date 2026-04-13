import { test, expect } from "@playwright/test";

test("AI chat panel streams a response and updates usage", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', "e2e@test.io");
  await page.fill('input[name="password"]', "Password123!");
  await page.click('button[type="submit"]');

  await page.waitForURL(/\/vault\//);
  await page.click('text=Open AI chat');
  await page.fill("textarea", "What is in this note?");
  await page.click('button:has-text("Send")');

  await expect(page.locator("aside")).toContainText("stub response");
  await expect(page.locator("aside header")).toContainText("tokens used today");
});
