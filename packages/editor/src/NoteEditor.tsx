import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { baseTheme } from './theme';
import { wikiLinkField } from './wikiLinkField';
import { wikiLinkExtension, WikiLinkContext } from './wikiLinkExtension';
import { wikiLinkAutocomplete, WikiSearchResult } from './wikiLinkAutocomplete';
import { livePreview } from './livePreview';

export interface NoteEditorProps {
  initialValue: string;
  onChange: (value: string) => void;
  onDropFiles?: (files: File[], pos: number) => Promise<string | null>;
  resolveTitle: WikiLinkContext['resolveTitle'];
  onNavigate: WikiLinkContext['onNavigate'];
  onCreateRequest: WikiLinkContext['onCreateRequest'];
  searchTitles: (q: string) => Promise<WikiSearchResult[]>;
}

export function NoteEditor(props: NoteEditorProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(props.onChange);
  const onDropRef = useRef(props.onDropFiles);
  onChangeRef.current = props.onChange;
  onDropRef.current = props.onDropFiles;

  useEffect(() => {
    if (!host.current) return;

    const listener = EditorView.updateListener.of((u) => {
      if (u.docChanged) onChangeRef.current(u.state.doc.toString());
    });

    const dropHandler = EditorView.domEventHandlers({
      drop(event, view) {
        if (!event.dataTransfer || event.dataTransfer.files.length === 0) return false;
        event.preventDefault();
        const files = Array.from(event.dataTransfer.files);
        const pos =
          view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
        (async () => {
          const handler = onDropRef.current;
          if (!handler) return;
          const md = await handler(files, pos);
          if (md) {
            view.dispatch({ changes: { from: pos, insert: md } });
          }
        })();
        return true;
      },
    });

    const state = EditorState.create({
      doc: props.initialValue,
      extensions: [
        history(),
        drawSelection(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        baseTheme,
        wikiLinkField,
        wikiLinkExtension({
          resolveTitle: props.resolveTitle,
          onNavigate: props.onNavigate,
          onCreateRequest: props.onCreateRequest,
        }),
        wikiLinkAutocomplete({ search: props.searchTitles }),
        livePreview,
        listener,
        dropHandler,
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: host.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} style={{ height: '100%', width: '100%' }} data-testid="note-editor" />;
}
