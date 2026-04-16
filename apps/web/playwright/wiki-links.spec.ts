import { test, expect } from '@playwright/test';

const ts = Date.now();
const EMAIL = `wl-${ts}@test.local`;
const PASSWORD = 'password123';
const NAME = 'WikiLink Tester';

test('create two notes, link B to A, see backlink, click to navigate', async ({ page }) => {
  test.setTimeout(90000);
  // 1. Sign up via the UI
  await page.goto('/signup');
  await page.getByLabel('Name').fill(NAME);
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page).toHaveURL('/', { timeout: 15000 });

  // 2. Create a workspace (which creates a vault and root folder)
  await page.goto('/workspaces/new');
  await page.locator("input[name='name']").fill('WikiTest');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/workspaces\/.+\/members/);

  // 3. Get the vault ID via the API
  const vaultsResp = await page.request.get('/api/vaults');
  const vaultsBody = await vaultsResp.json();
  const vault = vaultsBody.vaults[0];
  expect(vault).toBeTruthy();
  const vaultId: string = vault.id;

  // 4. Get the root folder from the tree API
  const treeResp = await page.request.get(`/api/vaults/${vaultId}/tree`);
  const treeBody = await treeResp.json();
  const rootFolderId: string = treeBody.root.id;
  expect(rootFolderId).toBeTruthy();

  // 5. Create note Alpha via the API
  const alphaResp = await page.request.post('/api/notes', {
    data: { vaultId, folderId: rootFolderId, title: 'Alpha' },
  });
  expect(alphaResp.status()).toBe(201);
  const alphaBody = await alphaResp.json();
  const alphaId: string = alphaBody.note.id;

  // 6. Create note Beta via the API
  const betaResp = await page.request.post('/api/notes', {
    data: { vaultId, folderId: rootFolderId, title: 'Beta' },
  });
  expect(betaResp.status()).toBe(201);
  const betaBody = await betaResp.json();
  const betaId: string = betaBody.note.id;

  // 7. Navigate to Beta's note page
  await page.goto(`/vault/${vaultId}/note/${betaId}`);
  await expect(page.locator('header h1')).toHaveText('Beta', { timeout: 10000 });
  const betaUrl = page.url();

  // 8. Type content in Beta containing [[Alpha]]
  // Wait for the editor to be ready (CodeMirror renders asynchronously after note fetch)
  const editorContent = page.locator('.cm-content');
  await editorContent.waitFor({ state: 'visible', timeout: 10000 });
  // Use Playwright's locator click to properly focus CodeMirror
  await editorContent.click();
  await page.keyboard.type('prelude [[Alpha]] epilogue');

  // 9. Phase 2: content is written by the realtime service via Yjs. The
  //    snapshot debounce fires 5s after the last edit, then writes Note.content
  //    and recomputes links in a transaction. Poll the backlinks endpoint for
  //    Beta until it appears (or fail after 15s).
  await expect
    .poll(
      async () => {
        const r = await page.request.get(`/api/notes/${alphaId}/backlinks`);
        if (!r.ok()) return 0;
        const body = (await r.json()) as { backlinks?: Array<{ sourceTitle: string }> };
        return body.backlinks?.some((b) => b.sourceTitle === 'Beta') ? 1 : 0;
      },
      { timeout: 15000, intervals: [500, 1000, 2000] },
    )
    .toBe(1);

  // 10. Navigate to Alpha's note page
  await page.goto(`/vault/${vaultId}/note/${alphaId}`);
  await expect(page.locator('header h1')).toHaveText('Alpha');

  // 11. Wait for backlinks panel to show Beta
  const backlinks = page.getByTestId('backlinks-panel');
  await expect(backlinks).toContainText('Beta', { timeout: 5000 });
  await expect(backlinks).toContainText('Alpha');

  // 12. Click the backlink to navigate to Beta
  await backlinks.getByRole('link', { name: 'Beta' }).click();
  await expect(page).toHaveURL(betaUrl);

  // 13. Ctrl-click the [[Alpha]] token in the editor to navigate to Alpha.
  // Wait for the token to be resolved (titleMap loads asynchronously after mount).
  const alphaToken = page.locator('.cm-wiki-link:not(.cm-wiki-link-unresolved)', { hasText: 'Alpha' });
  await expect(alphaToken).toBeVisible({ timeout: 5000 });
  await alphaToken.click({ modifiers: ['Control'] });
  // After navigating to Alpha, the h1 should change from "Beta" to "Alpha"
  await expect(page.locator('header h1')).toHaveText('Alpha', { timeout: 5000 });
});
