import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetDb, createUser } from '../helpers/db';
import { prisma } from '@km/db';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

vi.mock('@/lib/session', () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from '@/lib/session';
import { POST } from '@/app/api/attachments/route';
import { GET } from '@/app/api/attachments/[id]/route';

const DATA_DIR = process.env.DATA_DIR ?? './.data';

function buildFormDataRequest(url: string, form: FormData): Request {
  return new Request(url, { method: 'POST', body: form });
}

describe('POST /api/attachments', () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it('rejects unauthenticated requests', async () => {
    const { vault } = await createUser();
    vi.mocked(requireUserId).mockRejectedValue(new Response('Unauthorized', { status: 401 }));
    const form = new FormData();
    form.append('vaultId', vault.id);
    form.append('file', new Blob([Buffer.from('hi')], { type: 'text/plain' }), 'hello.txt');
    try {
      const res = await POST(buildFormDataRequest('http://x/api/attachments', form));
      // If route catches the throw and returns 401:
      expect(res.status).toBe(401);
    } catch (e) {
      expect((e as Response).status).toBe(401);
    }
  });

  it('rejects uploads to a vault the user cannot access', async () => {
    const { user: alice } = await createUser({ email: 'alice-att@test.local' });
    const { vault: bobVault } = await createUser({ email: 'bob-att@test.local' });
    vi.mocked(requireUserId).mockResolvedValue(alice.id);
    const form = new FormData();
    form.append('vaultId', bobVault.id);
    form.append('file', new Blob([Buffer.from('hi')], { type: 'text/plain' }), 'hello.txt');
    const res = await POST(buildFormDataRequest('http://x/api/attachments', form));
    expect(res.status).toBe(403);
  });

  it('stores a file and returns a markdown snippet', async () => {
    const { user: alice, vault } = await createUser({ email: 'alice2-att@test.local' });
    vi.mocked(requireUserId).mockResolvedValue(alice.id);
    const form = new FormData();
    form.append('vaultId', vault.id);
    form.append('file', new Blob([Buffer.from('PNGDATA')], { type: 'image/png' }), 'pic.png');
    const res = await POST(buildFormDataRequest('http://x/api/attachments', form));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.markdown).toMatch(/^!\[\]\(\/api\/attachments\/[0-9a-z-]+\)$/);
    const row = await prisma.attachment.findUnique({ where: { id: body.id } });
    expect(row?.filename).toBe('pic.png');
    expect(row?.mimeType).toBe('image/png');
    expect(row?.vaultId).toBe(vault.id);
    // cleanup stored file
    try {
      await fs.rm(path.join(DATA_DIR, 'vaults', vault.id), { recursive: true, force: true });
    } catch {}
  });

  it('rejects files over the 25MB limit', async () => {
    const { user: alice, vault } = await createUser({ email: 'alice3-att@test.local' });
    vi.mocked(requireUserId).mockResolvedValue(alice.id);
    const form = new FormData();
    form.append('vaultId', vault.id);
    form.append(
      'file',
      new Blob([Buffer.alloc(26 * 1024 * 1024, 0)], { type: 'image/png' }),
      'big.png',
    );
    const res = await POST(buildFormDataRequest('http://x/api/attachments', form));
    expect(res.status).toBe(413);
  });
});

describe('GET /api/attachments/:id', () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it('streams the file for an authorised user', async () => {
    const { user: alice, vault } = await createUser({ email: 'alice4-att@test.local' });
    vi.mocked(requireUserId).mockResolvedValue(alice.id);
    const form = new FormData();
    form.append('vaultId', vault.id);
    form.append('file', new Blob([Buffer.from('hello-bytes')], { type: 'text/plain' }), 't.txt');
    const up = await POST(buildFormDataRequest('http://x/api/attachments', form));
    const { id } = await up.json();

    vi.mocked(requireUserId).mockResolvedValue(alice.id);
    const res = await GET(new Request(`http://x/api/attachments/${id}`), { params: { id } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello-bytes');
    // cleanup
    try {
      await fs.rm(path.join(DATA_DIR, 'vaults', vault.id), { recursive: true, force: true });
    } catch {}
  });

  it('refuses streaming to an unauthorised user', async () => {
    const { user: alice, vault } = await createUser({ email: 'alice5-att@test.local' });
    const { user: bob } = await createUser({ email: 'bob5-att@test.local' });
    vi.mocked(requireUserId).mockResolvedValue(alice.id);
    const form = new FormData();
    form.append('vaultId', vault.id);
    form.append('file', new Blob([Buffer.from('secret')], { type: 'text/plain' }), 's.txt');
    const up = await POST(buildFormDataRequest('http://x/api/attachments', form));
    const { id } = await up.json();

    vi.mocked(requireUserId).mockResolvedValue(bob.id);
    const res = await GET(new Request(`http://x/api/attachments/${id}`), { params: { id } });
    expect(res.status).toBe(403);
    // cleanup
    try {
      await fs.rm(path.join(DATA_DIR, 'vaults', vault.id), { recursive: true, force: true });
    } catch {}
  });
});
