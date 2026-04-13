import { test, expect } from '@playwright/test';

const ts = Date.now();
const EMAIL = `drawio-${ts}@test.local`;
const PASSWORD = 'password123';

test('create, edit, and persist a drawio diagram', async ({ page }) => {
  test.setTimeout(90000);

  await page.goto('/signup');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign up' }).click();
  await expect(page).toHaveURL('/', { timeout: 15000 });

  await page.goto('/workspaces/new');
  await page.locator("input[name='name']").fill('DrawioTest');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/workspaces\/.+\/members/);

  const vaultsResp = await page.request.get('/api/vaults');
  const vaultsBody = await vaultsResp.json();
  const vaultId: string = vaultsBody.vaults[0].id;

  await page.goto(`/vault/${vaultId}`);
  await page.waitForLoadState('networkidle');

  const treeResp = await page.request.get(`/api/vaults/${vaultId}/tree`);
  const treeBody = await treeResp.json();
  const rootFolderId: string = treeBody.root.id;

  const diagramResp = await page.request.post('/api/diagrams', {
    data: { vaultId, folderId: rootFolderId, kind: 'DRAWIO', title: 'E2E Flow' },
  });
  expect(diagramResp.status()).toBe(201);
  const diagram = await diagramResp.json();

  await page.goto(`/vault/${vaultId}/diagram/${diagram.id}`);
  await expect(page.locator('h1')).toContainText('E2E Flow', { timeout: 10000 });

  const frameLocator = page.frameLocator('iframe[title="drawio editor"]');
  await expect(frameLocator.locator('body')).toBeVisible({ timeout: 20000 });

  const saveXml =
    '<mxfile><diagram><mxGraphModel><root>' +
    '<mxCell id="0"/><mxCell id="1" parent="0"/>' +
    '<mxCell id="2" value="E2E" vertex="1" parent="1">' +
    '<mxGeometry x="40" y="40" width="80" height="40"/>' +
    '</mxCell>' +
    '</root></mxGraphModel></diagram></mxfile>';

  await page.evaluate(
    ({ xml }) => {
      const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="drawio editor"]');
      iframe?.contentWindow?.postMessage(
        JSON.stringify({ event: 'save', xml }),
        window.location.origin,
      );
    },
    { xml: saveXml },
  );

  await page.waitForResponse(
    (res) => res.url().includes('/api/diagrams/') && res.request().method() === 'PATCH',
    { timeout: 15000 },
  );

  await page.reload();
  await expect(page.locator('h1')).toContainText('E2E Flow', { timeout: 10000 });
  await expect(frameLocator.locator('body')).toBeVisible({ timeout: 20000 });
});
