import { test, expect } from "@playwright/test";

const PASSWORD = "password123";

test("signup, logout, login round trip", async ({ page }) => {
  const EMAIL = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByText(`Signed in as ${EMAIL}`)).toBeVisible();

  await page.getByRole("link", { name: "Log out" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();

  await page.getByRole("link", { name: "Log in" }).click();
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByText(`Signed in as ${EMAIL}`)).toBeVisible();
});
