import { aiSseEvent, type AiSseEvent } from "@km/shared";

export interface ParsedSseEvent {
  event: string;
  data: AiSseEvent;
}

export function parseSseChunk(raw: string): ParsedSseEvent[] {
  const out: ParsedSseEvent[] = [];
  for (const block of raw.split("\n\n")) {
    const lines = block.split("\n");
    let event = "message";
    let dataLine = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) dataLine = line.slice(6);
    }
    if (!dataLine) continue;
    try {
      const json = JSON.parse(dataLine);
      const parsed = aiSseEvent.parse(json);
      out.push({ event, data: parsed });
    } catch {
      // partial or invalid block, skip
    }
  }
  return out;
}

export interface OpenSseOptions {
  url: string;
  body: unknown;
  signal: AbortSignal;
  onEvent: (event: ParsedSseEvent) => void;
}

export async function openSse(opts: OpenSseOptions): Promise<void> {
  const res = await fetch(opts.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(opts.body),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`SSE request failed: ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx + 2);
      buffer = buffer.slice(idx + 2);
      for (const ev of parseSseChunk(block)) {
        opts.onEvent(ev);
      }
    }
  }
}
