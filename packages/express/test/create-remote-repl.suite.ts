import type express5 from 'express';
import type { AddressInfo } from 'node:net';
import { RemoteReplInMemoryTransport, type RemoteReplTransport } from '@remote-repl/core';
import type { createRemoteRepl as createRemoteReplFn } from '../src/create-remote-repl';

/**
 * The one-call setup over real HTTP: a real Express app, the real engine and
 * (unless a test passes its own) the in-memory transport. Run once per
 * supported Express major, like ../test/repl-router.suite.ts: the calling
 * spec decides which `express` the module under test resolved.
 */
export function describeCreateRemoteRepl(
  label: string,
  express: typeof express5,
  createRemoteRepl: typeof createRemoteReplFn,
  major: 4 | 5,
): void {
  const silent = { warn() {}, error() {} };

  /**
   * An in-memory transport whose `subscribe()` (so the engine's start) waits
   * until the test calls `open()`, or rejects once it calls `fail()`.
   */
  function gatedTransport() {
    const inner = new RemoteReplInMemoryTransport();
    let open!: () => void;
    let fail!: (err: Error) => void;
    const gate = new Promise<void>((resolve, reject) => {
      open = resolve;
      fail = reject;
    });
    gate.catch(() => {}); // a rejected gate is observed through the engine, not here
    const transport: RemoteReplTransport = {
      publish: (topic, message) => inner.publish(topic, message),
      subscribe: async (topic, handler) => {
        await gate;
        return inner.subscribe(topic, handler);
      },
      close: () => inner.close(),
    };
    return { transport, open, fail };
  }

  const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

  interface Host {
    url: string;
    close(): Promise<void>;
  }

  async function listen(app: ReturnType<typeof express5>): Promise<Host> {
    const server = app.listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    const { port } = server.address() as AddressInfo;
    return {
      url: `http://127.0.0.1:${port}`,
      close: () => {
        server.closeAllConnections?.();
        return new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      },
    };
  }

  /**
   * POSTs `command` to `<url>/<channel>` and returns its output text, read
   * from the SSE stream until the command's `done` event.
   */
  async function run(url: string, channel: string, command: string): Promise<string> {
    const ac = new AbortController();
    const stream = await fetch(`${url}/${channel}`, { headers: { Accept: 'text/event-stream' }, signal: ac.signal });
    expect(stream.status).toBe(200);
    const post = await fetch(`${url}/${channel}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    expect(post.status).toBe(202);
    const { commandId } = (await post.json()) as { commandId: string };

    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let output = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`stream ended before ${commandId} was done`);
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const data = buffer
            .slice(0, idx)
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
            .join('');
          buffer = buffer.slice(idx + 2);
          if (!data) continue;
          const event = JSON.parse(data) as { type: string; commandId?: string; data: unknown };
          if (event.commandId !== commandId) continue;
          if (event.type === 'output') output += String(event.data);
          if (event.type === 'system' && (event.data as { done?: boolean })?.done) return output;
        }
      }
    } finally {
      ac.abort();
      reader.cancel().catch(() => {});
    }
  }

  describe(`${label}: createRemoteRepl: the context`, () => {
    it('gives every session the app that mounts it as `app`', async () => {
      const app = express();
      app.locals.marker = 'from-app-locals';
      const repl = createRemoteRepl({ enabled: true, logger: silent });
      app.use('/repl', repl);
      const host = await listen(app);
      try {
        expect(await run(`${host.url}/repl`, 'ctx', 'app.locals.marker')).toContain('from-app-locals');
      } finally {
        await repl.close();
        await host.close();
      }
    });

    it('adds the keys of `context` next to `app`', async () => {
      const app = express();
      const repl = createRemoteRepl({ enabled: true, logger: silent, context: { greeting: 'hello' } });
      app.use('/repl', repl);
      const host = await listen(app);
      try {
        expect(await run(`${host.url}/repl`, 'both', '[greeting, typeof app.use].join(":")')).toContain(
          'hello:function',
        );
      } finally {
        await repl.close();
        await host.close();
      }
    });

    it("lets the caller's `context.app` win over the injected app", async () => {
      const app = express();
      const repl = createRemoteRepl({ enabled: true, logger: silent, context: { app: 'the-caller-app' } });
      app.use('/repl', repl);
      const host = await listen(app);
      try {
        expect(await run(`${host.url}/repl`, 'override', 'app')).toContain('the-caller-app');
      } finally {
        await repl.close();
        await host.close();
      }
    });

    it('calls `buildContext` with `{ app }` and adds what it returns next to `app`', async () => {
      const app = express();
      app.locals.db = 'the-db-handle';
      const repl = createRemoteRepl({
        enabled: true,
        logger: silent,
        buildContext: ({ app }) => ({ db: app.locals.db }),
      });
      app.use('/repl', repl);
      const host = await listen(app);
      try {
        expect(await run(`${host.url}/repl`, 'built', '[db, typeof app.use].join(":")')).toContain(
          'the-db-handle:function',
        );
      } finally {
        await repl.close();
        await host.close();
      }
    });

    it('gives the sub-app, not the root app, when a sub-app mounts it (`req.app`)', async () => {
      const root = express();
      const admin = express();
      root.locals.which = 'root';
      admin.locals.which = 'admin-sub-app';
      const repl = createRemoteRepl({ enabled: true, logger: silent });
      admin.use('/repl', repl);
      root.use('/admin', admin);
      const host = await listen(root);
      try {
        expect(await run(`${host.url}/admin/repl`, 'sub', 'app.locals.which')).toContain('admin-sub-app');
      } finally {
        await repl.close();
        await host.close();
      }
    });
  });

  /** Status and JSON body of every route of the REPL under `base`. */
  async function hitEveryRoute(base: string): Promise<Array<{ route: string; status: number; body: unknown }>> {
    const routes: Array<[string, RequestInit]> = [
      ['', { redirect: 'manual' }],
      ['/x', { headers: { Accept: 'text/event-stream' } }],
      ['/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"command":"1"}' }],
      ['/x/ui', {}],
      ['/x/vs/loader.js', {}],
    ];
    const out = [];
    for (const [path, init] of routes) {
      const res = await fetch(`${base}${path}`, init);
      const type = res.headers.get('content-type') ?? '';
      // An open SSE stream never ends: record it without reading it.
      const body = type.includes('json')
        ? await res.json()
        : type.includes('event-stream')
          ? (await res.body?.cancel(), '<sse stream>')
          : await res.text();
      out.push({ route: `${init.method ?? 'GET'} ${path || '/'}`, status: res.status, body });
    }
    return out;
  }

  describe(`${label}: createRemoteRepl: the start`, () => {
    it('with `autoStart` (the default), is subscribing to the transport when `createRemoteRepl()` returns', async () => {
      const transport = new RemoteReplInMemoryTransport();
      const subscribe = vi.spyOn(transport, 'subscribe');
      const repl = createRemoteRepl({ enabled: true, logger: silent, transport });
      expect(subscribe).toHaveBeenCalled();
      await repl.ready;
      expect(subscribe).toHaveBeenCalledTimes(3); // the command, output and system topics
      await repl.close();
    });

    it('with `autoStart: false`, does not touch the transport until `start()`', async () => {
      const transport = new RemoteReplInMemoryTransport();
      const subscribe = vi.spyOn(transport, 'subscribe');
      const repl = createRemoteRepl({ enabled: true, logger: silent, transport, autoStart: false });
      await tick();
      expect(subscribe).not.toHaveBeenCalled();
      await repl.start();
      expect(subscribe).toHaveBeenCalledTimes(3);
      await repl.close();
    });

    it('with `autoStart: false`, answers 503 on every route until `start()`, then runs commands', async () => {
      const app = express();
      const repl = createRemoteRepl({ enabled: true, logger: silent, autoStart: false });
      app.use('/repl', repl);
      const host = await listen(app);
      try {
        for (const hit of await hitEveryRoute(`${host.url}/repl`)) {
          expect(hit, hit.route).toEqual({
            route: hit.route,
            status: 503,
            body: { statusCode: 503, message: 'remote-repl is not started' },
          });
        }
        await repl.start();
        expect(await run(`${host.url}/repl`, 'late', '20 + 22')).toContain('42');
      } finally {
        await repl.close();
        await host.close();
      }
    });
  });

  describe(`${label}: createRemoteRepl: the start, over a transport the test controls`, () => {
    it('holds a request that arrives while the start is in progress, then answers it', async () => {
      const { transport, open } = gatedTransport();
      const app = express();
      const repl = createRemoteRepl({ enabled: true, logger: silent, transport });
      app.use('/repl', repl);
      const host = await listen(app);
      try {
        let answered = false;
        const ui = fetch(`${host.url}/repl/x/ui`).then((res) => {
          answered = true;
          return res;
        });
        await tick();
        expect(answered).toBe(false);
        open();
        expect((await ui).status).toBe(200);
        expect(await run(`${host.url}/repl`, 'held', '40 + 2')).toContain('42');
      } finally {
        await repl.close();
        await host.close();
      }
    });

    it('after a failed start, answers 503 on every route (held ones too), logs once and rejects `ready`', async () => {
      const { transport, fail } = gatedTransport();
      const logger = { warn: vi.fn(), error: vi.fn() };
      const app = express();
      const repl = createRemoteRepl({ enabled: true, logger, transport });
      app.use('/repl', repl);
      const host = await listen(app);
      const failed = { statusCode: 503, message: 'remote-repl failed to start' };
      try {
        const held = fetch(`${host.url}/repl/x/ui`);
        await tick();
        fail(new Error('redis is down'));
        await expect(repl.ready).rejects.toThrow('redis is down');
        const heldRes = await held;
        expect({ status: heldRes.status, body: await heldRes.json() }).toEqual({ status: 503, body: failed });
        for (const hit of await hitEveryRoute(`${host.url}/repl`)) {
          expect(hit, hit.route).toEqual({ route: hit.route, status: 503, body: failed });
        }
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(String(logger.error.mock.calls[0][0])).toContain('redis is down');
      } finally {
        await repl.close();
        await host.close();
      }
    });

    it('does not crash the host with an unhandled rejection when nobody awaits a failed start', async () => {
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        const { transport, fail } = gatedTransport();
        const repl = createRemoteRepl({ enabled: true, logger: silent, transport });
        fail(new Error('redis is down'));
        await tick();
        expect(unhandled).not.toHaveBeenCalled();
        await repl.close();
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    });

    it('with `autoStart` (the default), resolves `ready` once the start completes', async () => {
      const { transport, open } = gatedTransport();
      const repl = createRemoteRepl({ enabled: true, logger: silent, transport });
      let ready = false;
      void repl.ready.then(() => (ready = true));
      await tick();
      expect(ready).toBe(false);
      open();
      await expect(repl.ready).resolves.toBeUndefined();
      await repl.close();
    });

    it('with `autoStart: false`, settles `ready` with the start the caller makes', async () => {
      const { transport, open } = gatedTransport();
      const repl = createRemoteRepl({ enabled: true, logger: silent, transport, autoStart: false });
      let ready = false;
      void repl.ready.then(() => (ready = true));
      await tick();
      expect(ready).toBe(false);
      const starting = repl.start();
      open();
      await starting;
      await expect(repl.ready).resolves.toBeUndefined();
      await repl.close();
    });
  });

  describe(`${label}: createRemoteRepl: the stop`, () => {
    it('`close()` ends the open SSE streams, so a plain `server.close()` then completes', async () => {
      const app = express();
      const repl = createRemoteRepl({ enabled: true, logger: silent });
      app.use('/repl', repl);
      const server = app.listen(0);
      await new Promise<void>((r) => server.once('listening', () => r()));
      const { port } = server.address() as AddressInfo;
      const stream = await fetch(`http://127.0.0.1:${port}/repl/x`, { headers: { Accept: 'text/event-stream' } });
      expect(stream.status).toBe(200);
      const reader = stream.body!.getReader();
      const ended = (async () => {
        for (;;) if ((await reader.read()).done) return 'ended';
      })();

      await repl.close();
      await expect(ended).resolves.toBe('ended');
      // No closeAllConnections(): only the stop ends the SSE response.
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    });
  });

  describe(`${label}: createRemoteRepl: disabled`, () => {
    it.each([true, false])(
      'with `autoStart: %s`, 404s every route before any other answer and never touches the transport',
      async (autoStart) => {
        const transport = new RemoteReplInMemoryTransport();
        const subscribe = vi.spyOn(transport, 'subscribe');
        const publish = vi.spyOn(transport, 'publish');
        const app = express();
        const repl = createRemoteRepl({ enabled: false, logger: silent, transport, autoStart });
        app.use('/repl', repl);
        const host = await listen(app);
        try {
          await repl.start(); // a no-op when disabled, whatever `autoStart` is
          for (const hit of await hitEveryRoute(`${host.url}/repl`)) {
            expect(hit, hit.route).toEqual({ route: hit.route, status: 404, body: { statusCode: 404, message: 'Not Found' } });
          }
          expect(subscribe).not.toHaveBeenCalled();
          expect(publish).not.toHaveBeenCalled();
        } finally {
          await repl.close();
          await host.close();
        }
      },
    );

    it('404s before `start()` too, never 503', async () => {
      const app = express();
      const repl = createRemoteRepl({ enabled: false, logger: silent, autoStart: false });
      app.use('/repl', repl);
      const host = await listen(app);
      try {
        for (const hit of await hitEveryRoute(`${host.url}/repl`)) {
          expect(hit.status, hit.route).toBe(404);
        }
      } finally {
        await repl.close();
        await host.close();
      }
    });
  });

  describe(`${label}: createRemoteRepl is running on Express ${major}`, () => {
    it('is the expected Express major', () => {
      // `app.del` exists on Express 4 only (removed in 5).
      expect(typeof (express() as unknown as { del?: unknown }).del === 'function').toBe(major === 4);
    });
  });
}
