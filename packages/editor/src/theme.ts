import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

export const baseTheme = EditorView.theme({
  '&': {
    fontSize: '15px',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    backgroundColor: '#ffffff',
    color: '#1f2328',
    height: '100%',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: '1.6',
  },
  '.cm-content': {
    padding: '16px',
    caretColor: '#0969da',
  },
  '.cm-line': {
    padding: '0 2px',
  },
  '.cm-wiki-link': {
    color: '#0969da',
    cursor: 'pointer',
    textDecoration: 'underline',
    textDecorationStyle: 'dotted',
  },
  '.cm-wiki-link-unresolved': {
    color: '#cf222e',
    textDecorationColor: '#cf222e',
  },
  '.cm-wiki-link:hover': {
    backgroundColor: '#ddf4ff',
  },
  '.cm-heading-1': { fontSize: '1.5em', fontWeight: '600' },
  '.cm-heading-2': { fontSize: '1.3em', fontWeight: '600' },
  '.cm-heading-3': { fontSize: '1.15em', fontWeight: '600' },
  '.cm-strong': { fontWeight: '700' },
  '.cm-emphasis': { fontStyle: 'italic' },
  '.cm-inline-code': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    backgroundColor: '#f6f8fa',
    padding: '0 3px',
    borderRadius: '3px',
  },
  '.cm-code-block': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    backgroundColor: '#f6f8fa',
  },
});

const sharedTokenStyles = {
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.6' },
  '.cm-content': { padding: '16px', caretColor: 'var(--fg)' },
  '.cm-line': { padding: '0 2px' },
  '.cm-wiki-link': {
    color: 'var(--accent)',
    cursor: 'pointer',
    textDecoration: 'underline',
    textDecorationStyle: 'dotted',
  },
  '.cm-wiki-link-unresolved': {
    color: '#cf222e',
    textDecorationColor: '#cf222e',
  },
  '.cm-heading-1': { fontSize: '1.5em', fontWeight: '600' },
  '.cm-heading-2': { fontSize: '1.3em', fontWeight: '600' },
  '.cm-heading-3': { fontSize: '1.15em', fontWeight: '600' },
  '.cm-strong': { fontWeight: '700' },
  '.cm-emphasis': { fontStyle: 'italic' },
  '.cm-inline-code': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    backgroundColor: 'var(--mark-bg)',
    padding: '0 3px',
    borderRadius: '3px',
  },
  '.cm-code-block': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    backgroundColor: 'var(--mark-bg)',
  },
};

export const lightTheme: Extension = EditorView.theme(
  {
    '&': {
      fontSize: '15px',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      backgroundColor: 'var(--bg)',
      color: 'var(--fg)',
      height: '100%',
    },
    '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--muted)', border: 'none' },
    ...sharedTokenStyles,
  },
  { dark: false },
);

export const darkTheme: Extension = EditorView.theme(
  {
    '&': {
      fontSize: '15px',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      backgroundColor: 'var(--bg)',
      color: 'var(--fg)',
      height: '100%',
    },
    '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--muted)', border: 'none' },
    ...sharedTokenStyles,
  },
  { dark: true },
);
