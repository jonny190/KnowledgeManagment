import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import BpmnModeler from 'bpmn-js/lib/Modeler';

export interface BpmnCanvasHandle {
  save(): Promise<string>;
}

export interface BpmnCanvasProps {
  xml: string;
  onDirtyChange?: (dirty: boolean) => void;
}

export const BpmnCanvas = forwardRef<BpmnCanvasHandle, BpmnCanvasProps>(
  function BpmnCanvas({ xml, onDirtyChange }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modelerRef = useRef<any>(null);

    useEffect(() => {
      if (!containerRef.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const modeler = new (BpmnModeler as any)({ container: containerRef.current });
      modelerRef.current = modeler;

      modeler.importXML(xml).catch((err: unknown) => {
        console.error('bpmn import failed', err);
      });

      const listener = () => onDirtyChange?.(true);
      modeler.on('commandStack.changed', listener);

      return () => {
        modeler.off('commandStack.changed', listener);
        modeler.destroy();
        modelerRef.current = null;
      };
    }, [xml, onDirtyChange]);

    useImperativeHandle(
      ref,
      () => ({
        async save() {
          const modeler = modelerRef.current;
          if (!modeler) throw new Error('bpmn modeler not ready');
          const { xml: out } = await modeler.saveXML({ format: true });
          if (!out) throw new Error('bpmn saveXML returned empty');
          return out as string;
        },
      }),
      [],
    );

    return (
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
        data-testid="bpmn-canvas"
      />
    );
  },
);
