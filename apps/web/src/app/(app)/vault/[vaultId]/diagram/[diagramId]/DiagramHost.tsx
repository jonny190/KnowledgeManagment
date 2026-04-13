'use client';

import { useCallback, useRef, useState } from 'react';
import { DrawioFrame, BpmnCanvas } from '@km/diagrams';
import type { BpmnCanvasHandle } from '@km/diagrams';

export interface DiagramHostProps {
  id: string;
  kind: 'DRAWIO' | 'BPMN';
  title: string;
  xml: string;
  updatedAt: string;
}

export function DiagramHost(props: DiagramHostProps) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(props.updatedAt);
  const bpmnRef = useRef<BpmnCanvasHandle | null>(null);

  const saveXml = useCallback(
    async (xml: string) => {
      setStatus('saving');
      const res = await fetch(`/api/diagrams/${props.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xml, expectedUpdatedAt }),
      });
      if (!res.ok) {
        setStatus('error');
        throw new Error(`save failed: ${res.status}`);
      }
      const body = await res.json();
      setExpectedUpdatedAt(body.updatedAt);
      setStatus('idle');
    },
    [props.id, expectedUpdatedAt],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header
        style={{
          padding: '0.5rem 1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h1 style={{ fontSize: '1rem', margin: 0 }}>{props.title}</h1>
        {props.kind === 'BPMN' && (
          <button
            type="button"
            onClick={async () => {
              const xml = await bpmnRef.current?.save();
              if (xml) await saveXml(xml);
            }}
          >
            Save
          </button>
        )}
        <span aria-live="polite">{status === 'saving' ? 'Saving...' : ''}</span>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        {props.kind === 'DRAWIO' ? (
          <DrawioFrame xml={props.xml} onSave={saveXml} />
        ) : (
          <BpmnCanvas ref={bpmnRef} xml={props.xml} />
        )}
      </div>
    </div>
  );
}
