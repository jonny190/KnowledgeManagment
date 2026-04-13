import { describe, it, expect } from 'vitest';
import { computeSnippet } from './computeSnippet';

describe('computeSnippet', () => {
  it('returns empty string when no match', () => {
    expect(computeSnippet('hello world', 'Missing')).toBe('');
  });

  it('returns the whole content when short enough', () => {
    expect(computeSnippet('short [[Alpha]] content', 'Alpha')).toBe('short [[Alpha]] content');
  });

  it('centres the match with an ellipsis on both sides when long', () => {
    const pad = 'x'.repeat(200);
    const src = `${pad} [[Alpha]] ${pad}`;
    const s = computeSnippet(src, 'Alpha');
    expect(s.startsWith('...')).toBe(true);
    expect(s.endsWith('...')).toBe(true);
    expect(s).toContain('[[Alpha]]');
    expect(s.length).toBeLessThanOrEqual(120 + 6);
  });

  it('matches alias form [[Title|alias]]', () => {
    const pad = 'y'.repeat(200);
    const src = `${pad} [[Alpha|shown]] ${pad}`;
    const s = computeSnippet(src, 'Alpha');
    expect(s).toContain('[[Alpha|shown]]');
  });

  it('does not add leading ellipsis when near start', () => {
    const src = `[[Alpha]] ${'z'.repeat(200)}`;
    const s = computeSnippet(src, 'Alpha');
    expect(s.startsWith('...')).toBe(false);
    expect(s.endsWith('...')).toBe(true);
  });

  it('is case sensitive on the title', () => {
    expect(computeSnippet('[[Alpha]]', 'alpha')).toBe('');
  });
});
