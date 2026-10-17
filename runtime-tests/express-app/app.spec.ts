// Runtime test: the consumer app on this runtime, against the built dist/.
// Every scenario drives the app over real HTTP with the global `fetch`.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, type App } from './app';
import { isDoneFor, isPing, outputOf, readSse } from './sse';

const post = async (app: App, channel: string, command: string) => {
  const res = await fetch(`${app.url}/repl/${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ command }),
  });
  const body = res.status === 202 ? ((await res.json()) as { commandId: string }) : undefined;
  return { status: res.status, commandId: body?.commandId as string };
};

/** Posts `command` and returns its output text once the stream reports it done. */
const run = async (app: App, channel: string, command: string) => {
  const { status, commandId } = await post(app, channel, command);
  expect(status).toBe(202);
  const frames = await readSse(app.url, channel, { until: isDoneFor(commandId) });
  return outputOf(frames, commandId);
};

describe('an enabled app', () => {
  let app: App;
  beforeAll(async () => {
    app = await startApp({ enabled: true });
  });
  afterAll(() => app.close());

  // A red test here points at packages/core/src/session/ (the `node:repl`
  // seam): completion detection, multi-line input and top-level await are
  // verified on Node only; another runtime's `node:repl` may differ.
  describe('session layer (packages/core/src/session/)', () => {
    it('evaluates a multi-line command supplied as one string', async () => {
      expect(await run(app, 'multi', 'const box = {\n  value: 41\n};\nbox.value + 1')).toContain('42');
    });

    it('supports top-level await', async () => {
      expect(await run(app, 'await', "await Promise.resolve('awaited-ok')")).toContain('awaited-ok');
    });

    it('reports a synchronous throw as output and the next command still works', async () => {
      expect(await run(app, 'throw', 'throw new Error("boom")')).toContain('boom');
      expect(await run(app, 'throw', '1 + 2')).toContain('3');
    });
  });

  it('a client reconnecting with Last-Event-ID receives only the events it missed', async () => {
    const channel = 'replay';
    const c1 = await post(app, channel, "'one'");
    await readSse(app.url, channel, { until: isDoneFor(c1.commandId) });
    const c2 = await post(app, channel, "'two'");
    const all = (await readSse(app.url, channel, { until: isDoneFor(c2.commandId) })).filter((f) => !isPing(f));
    // Six real events: command/output/done for each of the two commands.
    expect(all.map((f) => f.event.type)).toEqual(['command', 'output', 'system', 'command', 'output', 'system']);
    expect(all.map((f) => Number(f.wireId))).toEqual(all.map((f) => f.event.id));

    const cursor = all[2].wireId!;
    const resumed = await readSse(app.url, channel, { lastEventId: cursor });
    expect(resumed.filter((f) => !isPing(f)).map((f) => f.event)).toEqual(all.slice(3).map((f) => f.event));
  });

  it('serves the UI page for a channel', async () => {
    const res = await fetch(`${app.url}/repl/chanA/ui`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('chanA');
    expect(html.toLowerCase()).toContain('monaco');
  });

  it('serves a Monaco asset byte for byte from the built dist/ui/vs', async () => {
    const corePkg = createRequire(import.meta.url).resolve('@remote-repl/core/package.json');
    const built = readFileSync(join(dirname(corePkg), 'dist', 'ui', 'vs', 'loader.js'), 'utf8');
    const res = await fetch(`${app.url}/repl/chanA/vs/loader.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(await res.text()).toBe(built);
  });
});

describe('a disabled app', () => {
  let app: App;
  beforeAll(async () => {
    app = await startApp({ enabled: false });
  });
  afterAll(() => app.close());

  it('answers 404 on every route', async () => {
    const landing = await fetch(`${app.url}/repl`, { redirect: 'manual' });
    expect(landing.status).toBe(404);
    expect((await post(app, 'x', '1 + 1')).status).toBe(404);
    await expect(readSse(app.url, 'x', {})).rejects.toThrow(/404/);
    expect((await fetch(`${app.url}/repl/x/ui`)).status).toBe(404);
    expect((await fetch(`${app.url}/repl/x/vs/loader.js`)).status).toBe(404);
  });
});
