// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { buildWikiLinkSource } from './wikiLinkAutocomplete';

function ctxAt(doc: string, pos: number, explicit = false) {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, pos, explicit);
}

describe('buildWikiLinkSource', () => {
  it('returns null when not after [[', async () => {
    const src = buildWikiLinkSource({ search: vi.fn() });
    const result = await src(ctxAt('hello', 5));
    expect(result).toBeNull();
  });

  it('triggers on [[ with empty query', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 'n1', title: 'Alpha' }]);
    const src = buildWikiLinkSource({ search });
    const result = await src(ctxAt('[[', 2));
    expect(search).toHaveBeenCalledWith('');
    expect(result?.options[0].label).toBe('Alpha');
  });

  it('passes the current partial query', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 'n1', title: 'Alphabet' }]);
    const src = buildWikiLinkSource({ search });
    await src(ctxAt('see [[Alp', 9));
    expect(search).toHaveBeenCalledWith('Alp');
  });

  it('does not trigger if a closing ]] already appears before the cursor on the same line', async () => {
    const src = buildWikiLinkSource({ search: vi.fn() });
    const result = await src(ctxAt('[[Alpha]] more', 14));
    expect(result).toBeNull();
  });

  it('emits options whose apply replaces the open-bracket region with title]]', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 'n1', title: 'Alpha' }]);
    const src = buildWikiLinkSource({ search });
    const result = await src(ctxAt('[[Al', 4));
    expect(result?.from).toBe(2);
    expect(result?.options[0].apply).toBe('Alpha]] ');
  });
});
