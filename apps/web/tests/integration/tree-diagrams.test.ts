import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetDb, createUser } from '../helpers/db';
import { prisma } from '@km/db';

vi.mock('../../src/lib/session', () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from '../../src/lib/session';
import { GET as getTree } from '../../src/app/api/vaults/[id]/tree/route';
import { POST as createDiagram } from '../../src/app/api/diagrams/route';

function makeRequest(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('GET /api/vaults/:id/tree with diagrams', () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(requireUserId).mockReset();
  });

  it('includes diagrams in the items array tagged by kind', async () => {
    const { user, vault } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    await createDiagram(
      makeRequest('POST', 'http://t/api/diagrams', {
        vaultId: vault.id,
        kind: 'DRAWIO',
        title: 'Flow',
      }),
    );
    await createDiagram(
      makeRequest('POST', 'http://t/api/diagrams', {
        vaultId: vault.id,
        kind: 'BPMN',
        title: 'Proc',
      }),
    );

    const res = await getTree(
      makeRequest('GET', `http://t/api/vaults/${vault.id}/tree`),
      { params: { id: vault.id } },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    const kinds = body.items.map((i: { kind: string }) => i.kind).sort();
    expect(kinds).toEqual(['bpmn', 'drawio']);
  });

  it('includes both notes and diagrams in items', async () => {
    const { user, vault, rootFolder } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    await prisma.note.create({
      data: {
        vaultId: vault.id,
        folderId: rootFolder.id,
        title: 'My Note',
        slug: 'my-note',
        content: '',
        contentUpdatedAt: new Date(),
        createdById: user.id,
        updatedById: user.id,
      },
    });
    await createDiagram(
      makeRequest('POST', 'http://t/api/diagrams', {
        vaultId: vault.id,
        kind: 'DRAWIO',
        title: 'My Diagram',
      }),
    );

    const res = await getTree(
      makeRequest('GET', `http://t/api/vaults/${vault.id}/tree`),
      { params: { id: vault.id } },
    );

    const body = await res.json();
    const kinds = body.items.map((i: { kind: string }) => i.kind).sort();
    expect(kinds).toContain('note');
    expect(kinds).toContain('drawio');
  });

  it('preserves the legacy notes key for backward compatibility', async () => {
    const { user, vault, rootFolder } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    await prisma.note.create({
      data: {
        vaultId: vault.id,
        folderId: rootFolder.id,
        title: 'Legacy',
        slug: 'legacy',
        content: '',
        contentUpdatedAt: new Date(),
        createdById: user.id,
        updatedById: user.id,
      },
    });

    const res = await getTree(
      makeRequest('GET', `http://t/api/vaults/${vault.id}/tree`),
      { params: { id: vault.id } },
    );

    const body = await res.json();
    expect(Array.isArray(body.notes)).toBe(true);
    expect(body.notes[0].title).toBe('Legacy');
  });
});
