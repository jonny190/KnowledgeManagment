import { test, expect } from '@playwright/test';

const ts = Date.now();
const EMAIL = `diaglink-${ts}@test.local`;
const PASSWORD = 'password123';

test('wiki-link from a note navigates to a diagram', async ({ page }) => {
  test.setTimeout(90000);

  await page.goto('/signup');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page).toHaveURL('/', { timeout: 15000 });

  await page.goto('/workspaces/new');
  await page.locator("input[name='name']").fill('LinkTest');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/workspaces\/.+\/members/);

  const vaultsResp = await page.request.get('/api/vaults');
  const vaultsBody = await vaultsResp.json();
  const vaultId: string = vaultsBody.vaults[0].id;

  const treeResp = await page.request.get(`/api/vaults/${vaultId}/tree`);
  const treeBody = await treeResp.json();
  const rootFolderId: string = treeBody.root.id;

  const diagramResp = await page.request.post('/api/diagrams', {
    data: { vaultId, folderId: rootFolderId, kind: 'DRAWIO', title: 'My Diagram' },
  });
  expect(diagramResp.status()).toBe(201);
  const diagram = await diagramResp.json();

  const noteResp = await page.request.post('/api/notes', {
    data: { vaultId, folderId: rootFolderId, title: 'Index' },
  });
  expect(noteResp.status()).toBe(201);
  const noteBody = await noteResp.json();
  const noteId: string = noteBody.note.id;

  await page.goto(`/vault/${vaultId}/note/${noteId}`);
  await expect(page.locator('h1')).toHaveText('Index', { timeout: 10000 });

  const editorContent = page.locator('.cm-content');
  await editorContent.waitFor({ state: 'visible', timeout: 10000 });
  await editorContent.click();
  await page.keyboard.type('see [[My Diagram]]');

  // Phase 2: note content is persisted by the realtime snapshot pipeline
  // after a 5s idle debounce. Wait for the Link rows to reflect.
  await page.waitForTimeout(7000);

  const resolvedToken = page.locator('.cm-wiki-link:not(.cm-wiki-link-unresolved)', {
    hasText: 'My Diagram',
  });
  await expect(resolvedToken).toBeVisible({ timeout: 10000 });

  await resolvedToken.click({ modifiers: ['Control'] });

  await expect(page).toHaveURL(
    new RegExp(`/vault/${vaultId}/diagram/${diagram.id}`),
    { timeout: 10000 },
  );
});
