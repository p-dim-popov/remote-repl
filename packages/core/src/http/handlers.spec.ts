import type { RemoteReplEvent } from '../protocol/messages';
import { RemoteReplDisabledError } from '../engine/remote-repl-engine';
import {
  createRemoteReplHandlers,
  RemoteReplInvalidCommandError,
  parseRemoteReplLastEventId,
  REMOTE_REPL_SSE_RESPONSE_HEADERS,
  REMOTE_REPL_SSE_STREAM_PREAMBLE,
} from './handlers';
import { RemoteReplEngine } from '../engine/remote-repl-engine';
import { RemoteReplInMemoryTransport } from '../transport/in-memory.transport';

const fakeEngine = () => ({
  dispatch: vi.fn(async () => ({ commandId: 'cmd_x' })),
  events: vi.fn(),
});

describe('createRemoteReplHandlers: landing', () => {
  it('redirects to a fresh random channel UI built from the request URL', () => {
    const h = createRemoteReplHandlers(fakeEngine(), { enabled: true });
    expect(h.landing('/api/repl?x=1')).toMatch(/^\/api\/repl\/[a-z0-9]{8}\/ui$/);
    expect(h.landing('/repl')).not.toBe(h.landing('/repl'));
  });

  it('throws RemoteReplDisabledError synchronously when disabled', () => {
    const h = createRemoteReplHandlers(fakeEngine(), { enabled: false });
    expect(() => h.landing('/repl')).toThrow(RemoteReplDisabledError);
  });
});

describe('createRemoteReplHandlers: post', () => {
  it('dispatches a non-empty string command and resolves the command id', async () => {
    const engine = fakeEngine();
    const h = createRemoteReplHandlers(engine, { enabled: true });
    await expect(h.post('chanA', { command: '1+1' })).resolves.toEqual({ commandId: 'cmd_x' });
    expect(engine.dispatch).toHaveBeenCalledWith('chanA', '1+1');
  });

  it.each([
    ['a missing command', {}],
    ['a whitespace-only command', { command: '   ' }],
    ['a non-string command', { command: 123 }],
    ['a non-object body', 'command'],
    ['a null body', null],
  ])('rejects %s with RemoteReplInvalidCommandError and never dispatches', async (_label, body) => {
    const engine = fakeEngine();
    const h = createRemoteReplHandlers(engine, { enabled: true });
    await expect(h.post('chanA', body)).rejects.toThrow(RemoteReplInvalidCommandError);
    await expect(h.post('chanA', body)).rejects.toThrow('command must be a non-empty string');
    expect(engine.dispatch).not.toHaveBeenCalled();
  });

  it('rejects with RemoteReplDisabledError when disabled and never dispatches', async () => {
    const engine = fakeEngine();
    const h = createRemoteReplHandlers(engine, { enabled: false });
    await expect(h.post('chanA', { command: '1+1' })).rejects.toThrow(RemoteReplDisabledError);
    expect(engine.dispatch).not.toHaveBeenCalled();
  });
});

describe('createRemoteReplHandlers: ui', () => {
  it('renders the Monaco UI page for the channel', () => {
    const h = createRemoteReplHandlers(fakeEngine(), { enabled: true });
    const html = h.ui('chanA');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('chanA');
    expect(html.toLowerCase()).toContain('monaco');
  });

  it('escapes the channel name for the script context (no </script> breakout)', () => {
    const h = createRemoteReplHandlers(fakeEngine(), { enabled: true });
    const html = h.ui('</script><script>alert(1)</script>');
    expect(html).not.toContain('</script><script>alert(1)');
  });

  it('throws RemoteReplDisabledError synchronously when disabled', () => {
    const h = createRemoteReplHandlers(fakeEngine(), { enabled: false });
    expect(() => h.ui('chanA')).toThrow(RemoteReplDisabledError);
  });
});

describe('createRemoteReplHandlers: asset', () => {
  const h = createRemoteReplHandlers(fakeEngine(), { enabled: true });

  it('serves loader.js as JavaScript', () => {
    const asset = h.asset('loader.js');
    expect(asset?.contentType).toBe('text/javascript');
    expect(asset?.buffer.length).toBeGreaterThan(0);
  });

  it('serves a nested path with the right content type', () => {
    expect(h.asset('base/worker/workerMain.js')?.contentType).toBe('text/javascript');
    expect(h.asset('editor/editor.main.css')?.contentType).toBe('text/css');
  });

  it('returns null for a traversal attempt and for a miss', () => {
    expect(h.asset('../../package.json')).toBeNull();
    expect(h.asset('/etc/passwd')).toBeNull();
    expect(h.asset('does-not-exist.js')).toBeNull();
  });

  it('throws RemoteReplDisabledError synchronously when disabled', () => {
    const disabled = createRemoteReplHandlers(fakeEngine(), { enabled: false });
    expect(() => disabled.asset('loader.js')).toThrow(RemoteReplDisabledError);
  });
});

const ping = { id: 0, type: 'system', commandId: null, data: { ping: true } } as const;
const out = (id: number) => ({ id, type: 'output', commandId: 'cmd_1', data: 'hi' }) as const;

// A fake engine whose events() yields a fixed list and records return().
const engineWithEvents = (events: readonly RemoteReplEvent[]) => {
  const returned = vi.fn();
  const engine = {
    dispatch: vi.fn(async () => ({ commandId: 'cmd_x' })),
    events: vi.fn((_channel: string, _cursor: number | null): AsyncIterableIterator<RemoteReplEvent> => {
      const iter = (async function* () {
        for (const e of events) yield e;
      })();
      const originalReturn = iter.return.bind(iter);
      iter.return = (v) => {
        returned();
        return originalReturn(v);
      };
      return iter;
    }),
  };
  return { engine, returned };
};

const drain = async (iter: AsyncIterable<string>): Promise<string[]> => {
  const frames: string[] = [];
  for await (const f of iter) frames.push(f);
  return frames;
};

const idLines = (frames: string[]) => frames.flatMap((f) => f.match(/^id: .*$/gm) ?? []);

describe('createRemoteReplHandlers: stream', () => {
  it('passes the channel and cursor to the engine and yields ready-to-send SSE text frames', async () => {
    const { engine } = engineWithEvents([out(7)]);
    const h = createRemoteReplHandlers(engine, { enabled: true });
    const frames = await drain(h.stream('chanA', 3));
    expect(engine.events).toHaveBeenCalledWith('chanA', 3);
    expect(frames).toEqual([
      'event: message\nid: 7\ndata: {"id":7,"type":"output","commandId":"cmd_1","data":"hi"}\n\n',
    ]);
  });

  // The heartbeat id stamping is specified once, on streamFrames below:
  // stream() is sseFrameToText over the same frames.

  it('return() tears down the engine stream (subscription bookkeeping stays in the handler)', async () => {
    const { engine, returned } = engineWithEvents([out(1), out(2), out(3)]);
    const h = createRemoteReplHandlers(engine, { enabled: true });
    const iter = h.stream('chanA', null);
    await iter.next();
    await iter.return?.(undefined);
    expect(returned).toHaveBeenCalledTimes(1);
    expect(await iter.next()).toEqual({ value: undefined, done: true });
  });

  it('throws RemoteReplDisabledError synchronously when disabled and never touches the engine', () => {
    const { engine } = engineWithEvents([]);
    const h = createRemoteReplHandlers(engine, { enabled: false });
    expect(() => h.stream('chanA', null)).toThrow(RemoteReplDisabledError);
    expect(engine.events).not.toHaveBeenCalled();
  });
});

describe('createRemoteReplHandlers: streamFrames', () => {
  const frameIds = (frames: { id: string }[]) => frames.map((f) => f.id);
  const drainFrames = async (iter: AsyncIterable<{ id: string; type: string; data: string }>) => {
    const frames: { id: string; type: string; data: string }[] = [];
    for await (const f of iter) frames.push(f);
    return frames;
  };

  it('passes the channel and cursor to the engine and yields structured SSE frames', async () => {
    const { engine } = engineWithEvents([out(7)]);
    const h = createRemoteReplHandlers(engine, { enabled: true });
    const frames = await drainFrames(h.streamFrames('chanA', 3));
    expect(engine.events).toHaveBeenCalledWith('chanA', 3);
    expect(frames).toEqual([
      { id: '7', type: 'message', data: '{"id":7,"type":"output","commandId":"cmd_1","data":"hi"}' },
    ]);
  });

  it("stamps heartbeats after a real event with that event's id (reference: id 5, 5, 5)", async () => {
    const { engine } = engineWithEvents([out(5), ping, ping]);
    const h = createRemoteReplHandlers(engine, { enabled: true });
    expect(frameIds(await drainFrames(h.streamFrames('chanA', null)))).toEqual(['5', '5', '5']);
  });

  it("stamps a heartbeat before any real event with the client's own cursor", async () => {
    const { engine } = engineWithEvents([ping, out(7), ping]);
    const h = createRemoteReplHandlers(engine, { enabled: true });
    expect(frameIds(await drainFrames(h.streamFrames('chanA', 5)))).toEqual(['5', '7', '7']);
  });

  it('stamps a heartbeat on a fresh connection (no cursor, nothing sent) with 0', async () => {
    const { engine } = engineWithEvents([ping]);
    const h = createRemoteReplHandlers(engine, { enabled: true });
    expect(frameIds(await drainFrames(h.streamFrames('chanA', null)))).toEqual(['0']);
  });

  it('return() tears down the engine stream', async () => {
    const { engine, returned } = engineWithEvents([out(1), out(2), out(3)]);
    const h = createRemoteReplHandlers(engine, { enabled: true });
    const iter = h.streamFrames('chanA', null);
    await iter.next();
    await iter.return?.(undefined);
    expect(returned).toHaveBeenCalledTimes(1);
    expect(await iter.next()).toEqual({ value: undefined, done: true });
  });

  it('throws RemoteReplDisabledError synchronously when disabled and never touches the engine', () => {
    const { engine } = engineWithEvents([]);
    const h = createRemoteReplHandlers(engine, { enabled: false });
    expect(() => h.streamFrames('chanA', null)).toThrow(RemoteReplDisabledError);
    expect(engine.events).not.toHaveBeenCalled();
  });
});

describe('createRemoteReplHandlers: stream against the real engine', () => {
  it('return() while next() is pending settles it with done and releases the channel', async () => {
    const engine = new RemoteReplEngine(
      { enabled: true, instanceId: 'A' },
      new RemoteReplInMemoryTransport(),
      () => ({}),
      () => Date.now(),
      { warn: () => {}, error: () => {} },
    );
    await engine.start();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internals = engine as any;
    const h = createRemoteReplHandlers(engine, { enabled: true });
    const iter = h.stream('pending-chan', null);
    expect(internals.channels.has('pending-chan')).toBe(true);
    const pending = iter.next();
    await iter.return?.(undefined);
    expect(await pending).toEqual({ value: undefined, done: true });
    expect(internals.channels.has('pending-chan')).toBe(false);
    await engine.stop();
  });

  it('replays buffered events as frames and the first heartbeat repeats the last replayed id', async () => {
    const engine = new RemoteReplEngine(
      { enabled: true, instanceId: 'A', heartbeatInterval: 20 },
      new RemoteReplInMemoryTransport(),
      () => ({}),
      () => Date.now(),
      { warn: () => {}, error: () => {} },
    );
    await engine.start();
    await engine.dispatch('replay-chan', '1 + 1');
    await new Promise((r) => setTimeout(r, 150));
    const h = createRemoteReplHandlers(engine, { enabled: true });
    const iter = h.stream('replay-chan', null);
    const frames: string[] = [];
    for (;;) {
      const { value, done } = await iter.next();
      if (done) break;
      frames.push(value);
      if (value.includes('"ping":true')) break;
    }
    await iter.return?.(undefined);
    await engine.stop();
    const ids = idLines(frames);
    expect(ids.length).toBeGreaterThanOrEqual(3); // command, output/done..., ping
    expect(frames[0]).toContain('"type":"command"');
    expect(ids[ids.length - 1]).toBe(ids[ids.length - 2]); // ping repeats the last real id
  });
});

describe('parseRemoteReplLastEventId', () => {
  it.each([
    ['5', 5],
    ['0', 0],
    [undefined, null],
    ['', null],
    ['abc', null],
    [null, null],
  ])('%j -> %j', (header, expected) => {
    expect(parseRemoteReplLastEventId(header)).toBe(expected);
  });
});

describe('REMOTE_REPL_SSE_RESPONSE_HEADERS', () => {
  it('matches the reference wire format headers exactly', () => {
    expect(REMOTE_REPL_SSE_RESPONSE_HEADERS).toEqual({
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
      'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0, no-transform',
      Pragma: 'no-cache',
      Expire: '0',
      'X-Accel-Buffering': 'no',
    });
    expect(REMOTE_REPL_SSE_STREAM_PREAMBLE).toBe('\n');
  });
});
