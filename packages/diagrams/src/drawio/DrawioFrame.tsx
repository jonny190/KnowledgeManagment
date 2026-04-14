"use client";

import { useEffect, useRef, useState } from 'react';
import {
  parseDrawioEvent,
  buildLoadAction,
  buildStatusAction,
  buildConfigureAction,
  isSameOrigin,
} from './postMessageBridge';

export interface DrawioFrameProps {
  xml: string;
  onSave: (xml: string) => Promise<void>;
  onExit?: () => void;
  embedUrl?: string;
}

const DEFAULT_EMBED_URL =
  '/drawio/?embed=1&proto=json&spin=1&modified=unsavedChanges&saveAndExit=0&noSaveBtn=0&noExitBtn=1&ui=atlas';

export function DrawioFrame({ xml, onSave, onExit, embedUrl }: DrawioFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const hostOrigin = window.location.origin;
    const iframe = iframeRef.current;

    function postToIframe(message: string) {
      iframe?.contentWindow?.postMessage(message, hostOrigin);
    }

    async function onMessage(event: MessageEvent) {
      if (!isSameOrigin(event.origin, hostOrigin)) return;
      const parsed = parseDrawioEvent(event.data);
      if (!parsed) return;
      switch (parsed.event) {
        case 'init':
          postToIframe(buildLoadAction(xml));
          setLoaded(true);
          return;
        case 'save':
          try {
            await onSave(parsed.xml);
            postToIframe(buildStatusAction(false));
          } catch (err) {
            console.error('drawio save failed', err);
          }
          return;
        case 'configure':
          postToIframe(buildConfigureAction({}));
          return;
        case 'exit':
          onExit?.();
          return;
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [xml, onSave, onExit]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {!loaded && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          Loading diagram editor...
        </div>
      )}
      <iframe
        ref={iframeRef}
        title="drawio editor"
        src={embedUrl ?? DEFAULT_EMBED_URL}
        style={{ width: '100%', height: '100%', border: '0' }}
      />
    </div>
  );
}
