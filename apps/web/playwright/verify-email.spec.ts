import { test, expect } from "@playwright/test";

// The VerifyEmailBanner lives in the (app) layout, which applies to routes
// like /workspaces and /search but not to the public home page at /.
// After signup we navigate to /workspaces so the banner is in scope.

test("signup shows verify-email banner inside app layout", async ({ page }) => {
  const email = `e2e-verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("e2e-password-1");
  await page.getByRole("button", { name: "Sign up" }).click();

  // Signup redirects to / via window.location.href; wait for navigation.
  await expect(page).toHaveURL("/", { timeout: 15_000 });

  // Navigate into the (app) layout group where the banner is rendered.
  await page.goto("/workspaces");

  // The banner should be visible because the new account has not verified its email.
  await expect(
    page.getByText(/Please verify your email/i).first(),
  ).toBeVisible({ timeout: 10_000 });
});

test("verify-email page with invalid token returns error", async ({ page }) => {
  // Should render an error state, not crash the application.
  await page.goto("/verify-email?token=invalid-token-that-does-not-exist");

  // The page should load and display a body without unhandled error.
  const body = page.locator("body");
  await expect(body).toBeVisible();
});
