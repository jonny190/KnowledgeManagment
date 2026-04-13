import { describe, it, expect } from 'vitest';
import { parseWikiLinks } from './parseWikiLinks';

describe('parseWikiLinks', () => {
  it('returns empty array for empty content', () => {
    expect(parseWikiLinks('')).toEqual([]);
  });

  it('parses a single wiki-link', () => {
    expect(parseWikiLinks('see [[Alpha]] now')).toEqual([
      { title: 'Alpha', start: 4, end: 13 },
    ]);
  });

  it('parses wiki-link with alias', () => {
    expect(parseWikiLinks('see [[Alpha|the first]] here')).toEqual([
      { title: 'Alpha', alias: 'the first', start: 4, end: 23 },
    ]);
  });

  it('parses multiple links on one line', () => {
    const r = parseWikiLinks('[[A]] and [[B|b]]');
    expect(r.map((l) => ({ title: l.title, alias: l.alias }))).toEqual([
      { title: 'A', alias: undefined },
      { title: 'B', alias: 'b' },
    ]);
  });

  it('trims internal whitespace in title and alias', () => {
    expect(parseWikiLinks('[[  Alpha  |  alias text  ]]')[0]).toMatchObject({
      title: 'Alpha',
      alias: 'alias text',
    });
  });

  it('ignores links inside fenced code blocks', () => {
    const src = 'before\n```\n[[NotALink]]\n```\nafter [[Real]]';
    const r = parseWikiLinks(src);
    expect(r).toHaveLength(1);
    expect(r[0]?.title).toBe('Real');
  });

  it('ignores links inside tilde fenced code blocks', () => {
    const src = '~~~\n[[Nope]]\n~~~\n[[Yes]]';
    expect(parseWikiLinks(src).map((l) => l.title)).toEqual(['Yes']);
  });

  it('ignores links inside inline code spans', () => {
    const src = 'text `[[NotALink]]` [[Real]]';
    expect(parseWikiLinks(src).map((l) => l.title)).toEqual(['Real']);
  });

  it('respects escaped opening brackets', () => {
    expect(parseWikiLinks('escaped \\[[NotALink]] done')).toEqual([]);
  });

  it('skips malformed unterminated links', () => {
    expect(parseWikiLinks('open [[Alpha and nothing else')).toEqual([]);
  });

  it('skips empty titles', () => {
    expect(parseWikiLinks('[[]] and [[|a]]')).toEqual([]);
  });

  it('does not cross newlines inside a link', () => {
    expect(parseWikiLinks('[[Alpha\nBeta]]')).toEqual([]);
  });

  it('handles adjacent links without whitespace', () => {
    expect(parseWikiLinks('[[A]][[B]]').map((l) => l.title)).toEqual(['A', 'B']);
  });

  it('ignores a bare pipe with no title', () => {
    expect(parseWikiLinks('[[|only alias]]')).toEqual([]);
  });

  it('de-duplicates by title+alias preserving first occurrence offsets', () => {
    const r = parseWikiLinks('[[A]] [[A]] [[A|x]]');
    expect(r).toHaveLength(3);
    expect(r[0]?.start).toBe(0);
  });

  it('does not treat a single opening [ as a link', () => {
    expect(parseWikiLinks('[Alpha]')).toEqual([]);
  });

  it('handles tildes with fewer than three as not a fence', () => {
    expect(parseWikiLinks('~~\n[[Alpha]]\n~~')[0]?.title).toBe('Alpha');
  });

  it('reopens parsing after a closing fence', () => {
    const src = '```\n[[A]]\n```\n[[B]]\n```\n[[C]]\n```';
    expect(parseWikiLinks(src).map((l) => l.title)).toEqual(['B']);
  });
});
