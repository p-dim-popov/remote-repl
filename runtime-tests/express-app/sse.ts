// A minimal SSE reader over the global `fetch`, so the same code runs on
// Node, Bun and Deno.
export interface Frame {
  wireId: string | null;
  event: { id: number; type: string; commandId?: string; data: unknown };
}

const parseFrame = (raw: string): Frame | null => {
  let wireId: string | null = null;
  let data: string | null = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('id:')) wireId = line.slice(3).trim();
    else if (line.startsWith('data:')) data = (data ?? '') + line.slice(5).trim();
  }
  return data === null ? null : { wireId, event: JSON.parse(data) };
};

export const isPing = (f: Frame) => f.event.type === 'system' && (f.event.data as { ping?: boolean })?.ping === true;
export const isDoneFor = (commandId: string) => (f: Frame) =>
  f.event.type === 'system' && f.event.commandId === commandId && (f.event.data as { done?: boolean })?.done === true;
export const outputOf = (frames: Frame[], commandId: string) =>
  frames
    .filter((f) => f.event.type === 'output' && f.event.commandId === commandId)
    .map((f) => String(f.event.data))
    .join('');

/**
 * Opens the SSE stream for `channel` and collects frames until `until`
 * matches one (then resolves with every frame so far) or `settleMs` passes
 * with no match (then resolves with what arrived: the "nothing more comes"
 * case). Always closes the connection.
 */
export const readSse = async (
  url: string,
  channel: string,
  { lastEventId, until, settleMs = 300 }: { lastEventId?: string; until?: (f: Frame) => boolean; settleMs?: number },
): Promise<Frame[]> => {
  const ac = new AbortController();
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (lastEventId !== undefined) headers['Last-Event-ID'] = lastEventId;
  const res = await fetch(`${url}/repl/${encodeURIComponent(channel)}`, { headers, signal: ac.signal });
  if (res.status !== 200) {
    ac.abort();
    throw new Error(`SSE connect failed: ${res.status}`);
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const frames: Frame[] = [];
  let buffer = '';
  const deadline = Date.now() + (until ? 10_000 : settleMs);
  try {
    while (Date.now() < deadline) {
      const timer = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), deadline - Date.now()));
      const next = await Promise.race([reader.read(), timer]);
      if (next === 'timeout') {
        if (until) throw new Error('timed out waiting for SSE frame');
        break;
      }
      if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = parseFrame(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
        if (!frame) continue;
        frames.push(frame);
        if (until?.(frame)) return frames;
      }
    }
    return frames;
  } finally {
    ac.abort();
    reader.cancel().catch(() => {});
  }
};
