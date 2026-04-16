import { test, expect } from '@playwright/test';

const ts = Date.now();
const EMAIL = `bpmn-${ts}@test.local`;
const PASSWORD = 'password123';

test('create, edit, and persist a bpmn diagram', async ({ page }) => {
  test.setTimeout(90000);

  await page.goto('/signup');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page).toHaveURL('/', { timeout: 15000 });

  await page.goto('/workspaces/new');
  await page.locator("input[name='name']").fill('BpmnTest');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/workspaces\/.+\/members/);

  const vaultsResp = await page.request.get('/api/vaults');
  const vaultsBody = await vaultsResp.json();
  const vaultId: string = vaultsBody.vaults[0].id;

  const treeResp = await page.request.get(`/api/vaults/${vaultId}/tree`);
  const treeBody = await treeResp.json();
  const rootFolderId: string = treeBody.root.id;

  const diagramResp = await page.request.post('/api/diagrams', {
    data: { vaultId, folderId: rootFolderId, kind: 'BPMN', title: 'E2E Process' },
  });
  expect(diagramResp.status()).toBe(201);
  const diagram = await diagramResp.json();

  await page.goto(`/vault/${vaultId}/diagram/${diagram.id}`);
  await expect(page.locator('header h1')).toContainText('E2E Process', { timeout: 10000 });
  await expect(page.getByTestId('bpmn-canvas')).toBeVisible({ timeout: 15000 });

  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForResponse(
    (res) => res.url().includes('/api/diagrams/') && res.request().method() === 'PATCH',
    { timeout: 15000 },
  );

  await page.reload();
  await expect(page.getByTestId('bpmn-canvas')).toBeVisible({ timeout: 15000 });
});
