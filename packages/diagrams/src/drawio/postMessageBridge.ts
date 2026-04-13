export type DrawioEvent =
  | { event: 'init' }
  | { event: 'save'; xml: string }
  | { event: 'exit' }
  | { event: 'configure' };

export function parseDrawioEvent(raw: unknown): DrawioEvent | null {
  if (typeof raw !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  switch (obj['event']) {
    case 'init':
    case 'exit':
    case 'configure':
      return { event: obj['event'] };
    case 'save':
      if (typeof obj['xml'] === 'string') {
        return { event: 'save', xml: obj['xml'] };
      }
      return null;
    default:
      return null;
  }
}

export function buildLoadAction(xml: string): string {
  return JSON.stringify({ action: 'load', xml, autosave: 1 });
}

export function buildStatusAction(modified: boolean): string {
  return JSON.stringify({ action: 'status', modified });
}

export function buildConfigureAction(config: Record<string, unknown> = {}): string {
  return JSON.stringify({ action: 'configure', config });
}

export function isSameOrigin(eventOrigin: string, hostOrigin: string): boolean {
  return eventOrigin === hostOrigin;
}
