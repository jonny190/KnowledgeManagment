import { describe, it, expect, vi } from 'vitest';
import { createUser } from '../helpers/db';
import { prisma } from '@km/db';

vi.mock('../../src/lib/session', () => ({
  getCurrentUserId: vi.fn(),
  requireUserId: vi.fn(),
}));

import { requireUserId } from '../../src/lib/session';
import { POST } from '../../src/app/api/diagrams/route';
import { GET, PATCH, DELETE } from '../../src/app/api/diagrams/[id]/route';

function makeRequest(method: string, url: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('POST /api/diagrams', () => {
  it('creates a drawio diagram with a blank stub', async () => {
    const { user, vault } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const res = await POST(
      makeRequest('POST', 'http://t/api/diagrams', {
        vaultId: vault.id,
        kind: 'DRAWIO',
        title: 'My Flow',
      }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.kind).toBe('DRAWIO');
    expect(body.title).toBe('My Flow');
    expect(body.slug).toBe('my-flow');
    expect(body.xml).toContain('<mxfile');
  });

  it('rejects when the caller lacks vault access', async () => {
    const { vault } = await createUser();
    const { user: other } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(other.id);

    const res = await POST(
      makeRequest('POST', 'http://t/api/diagrams', {
        vaultId: vault.id,
        kind: 'BPMN',
        title: 'Nope',
      }),
    );

    expect(res.status).toBe(403);
  });
});

describe('GET /api/diagrams/:id', () => {
  it('returns the diagram for a member', async () => {
    const { user, vault } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const created = await POST(
      makeRequest('POST', 'http://t/api/diagrams', {
        vaultId: vault.id,
        kind: 'BPMN',
        title: 'P',
      }),
    );
    const { id } = await created.json();

    const res = await GET(
      makeRequest('GET', `http://t/api/diagrams/${id}`),
      { params: { id } },
    );

    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(id);
  });
});

describe('PATCH /api/diagrams/:id', () => {
  it('updates xml', async () => {
    const { user, vault } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const created = await POST(
      makeRequest('POST', 'http://t/api/diagrams', {
        vaultId: vault.id,
        kind: 'DRAWIO',
        title: 'D',
      }),
    );
    const d = await created.json();

    const res = await PATCH(
      makeRequest('PATCH', `http://t/api/diagrams/${d.id}`, {
        xml: '<mxfile x="1"/>',
      }),
      { params: { id: d.id } },
    );

    expect(res.status).toBe(200);
    const patched = await res.json();
    expect(patched.xml).toBe('<mxfile x="1"/>');
  });

  it('returns 409 on stale expectedUpdatedAt', async () => {
    const { user, vault } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const created = await POST(
      makeRequest('POST', 'http://t/api/diagrams', {
        vaultId: vault.id,
        kind: 'DRAWIO',
        title: 'D2',
      }),
    );
    const d = await created.json();

    const res = await PATCH(
      makeRequest('PATCH', `http://t/api/diagrams/${d.id}`, {
        xml: '<x/>',
        expectedUpdatedAt: '1970-01-01T00:00:00.000Z',
      }),
      { params: { id: d.id } },
    );

    expect(res.status).toBe(409);
  });
});

describe('DELETE /api/diagrams/:id', () => {
  it('deletes the diagram', async () => {
    const { user, vault } = await createUser();
    vi.mocked(requireUserId).mockResolvedValue(user.id);

    const created = await POST(
      makeRequest('POST', 'http://t/api/diagrams', {
        vaultId: vault.id,
        kind: 'BPMN',
        title: 'X',
      }),
    );
    const d = await created.json();

    const res = await DELETE(
      makeRequest('DELETE', `http://t/api/diagrams/${d.id}`),
      { params: { id: d.id } },
    );

    expect(res.status).toBe(204);

    const gone = await prisma.diagram.findUnique({ where: { id: d.id } });
    expect(gone).toBeNull();
  });
});
