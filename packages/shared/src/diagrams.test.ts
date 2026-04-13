import { describe, it, expect } from 'vitest';
import {
  DiagramKind,
  diagramCreateSchema,
  diagramPatchSchema,
  slugifyDiagramTitle,
} from './diagrams';

describe('DiagramKind', () => {
  it('exposes DRAWIO and BPMN values', () => {
    expect(DiagramKind.options).toEqual(['DRAWIO', 'BPMN']);
  });
});

describe('diagramCreateSchema', () => {
  it('accepts a valid drawio payload', () => {
    const r = diagramCreateSchema.parse({
      vaultId: 'v1',
      kind: 'DRAWIO',
      title: 'My flow',
    });
    expect(r.title).toBe('My flow');
  });

  it('rejects an empty title', () => {
    expect(() =>
      diagramCreateSchema.parse({ vaultId: 'v1', kind: 'BPMN', title: '' }),
    ).toThrow();
  });
});

describe('diagramPatchSchema', () => {
  it('allows partial updates', () => {
    expect(diagramPatchSchema.parse({ title: 'x' })).toEqual({ title: 'x' });
  });

  it('caps xml length at 2MB', () => {
    const big = 'a'.repeat(2 * 1024 * 1024 + 1);
    expect(() => diagramPatchSchema.parse({ xml: big })).toThrow();
  });
});

describe('slugifyDiagramTitle', () => {
  it('lowercases and dashes spaces', () => {
    expect(slugifyDiagramTitle('My Flow Chart')).toBe('my-flow-chart');
  });

  it('strips non-url-safe chars', () => {
    expect(slugifyDiagramTitle('Café & co!')).toBe('cafe-co');
  });
});
