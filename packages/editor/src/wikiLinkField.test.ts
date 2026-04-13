// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { wikiLinkField, getWikiLinks } from './wikiLinkField';

function stateOf(doc: string) {
  return EditorState.create({ doc, extensions: [wikiLinkField] });
}

describe('wikiLinkField', () => {
  it('returns no links for plain text', () => {
    expect(getWikiLinks(stateOf('hello world'))).toEqual([]);
  });

  it('finds a single link with its range', () => {
    const s = stateOf('see [[Alpha]] there');
    const links = getWikiLinks(s);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ title: 'Alpha', from: 4, to: 13 });
  });

  it('finds a link with alias', () => {
    const links = getWikiLinks(stateOf('[[Alpha|a]]'));
    expect(links[0]).toMatchObject({ title: 'Alpha', alias: 'a', from: 0, to: 11 });
  });

  it('ignores links inside code fences', () => {
    const s = stateOf('```\n[[Ignore]]\n```\n[[Keep]]');
    const titles = getWikiLinks(s).map((l) => l.title);
    expect(titles).toEqual(['Keep']);
  });

  it('updates when the document changes', () => {
    let s = stateOf('hello');
    s = s.update({ changes: { from: 5, insert: ' [[New]]' } }).state;
    expect(getWikiLinks(s).map((l) => l.title)).toEqual(['New']);
  });
});
