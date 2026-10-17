// Shared helpers for the multi-instance e2e specs: boot a real, listening
// Nest app on a given transport and drive it from outside, over HTTP + SSE.
// Tests see only ports, status codes and SSE frames, never the app.
import { Test } from '@nestjs/testing';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import type { RemoteReplTransport, RemoteReplEvent, RemoteReplOptions } from '@remote-repl/core';
import { RemoteReplInMemoryTransport } from '@remote-repl/core';
import { RemoteReplModule } from '../src/remote-repl.module';
import type { RemoteReplModuleOptions } from '../src/interfaces/remote-repl-options.interface';

/** A booted, listening instance plus the HTTP handle tests drive it through. */
export interface Instance {
  port: number;
  /** `commandId` is the empty string when the POST was not accepted (status != 202). */
  post(channel: string, command: string): Promise<{ status: number; commandId: string }>;
  get(path: string): Promise<{ status: number }>;
  close(): Promise<void>;
}

export const bootInstance = async (
  transport: RemoteReplTransport,
  options: Partial<RemoteReplModuleOptions> & { instanceId: string },
): Promise<Instance> => {
  const mod = await Test.createTestingModule({
    imports: [RemoteReplModule.register({ enabled: true, ...options, transport })],
  }).compile();
  const app = mod.createNestApplication({ logger: false });
  await app.init();
  await app.listen(0);
  const server = app.getHttpServer() as http.Server;
  const { port } = server.address() as AddressInfo;
  return {
    port,
    async post(channel, command) {
      const res = await request(server)
        .post(`/repl/${encodeURIComponent(channel)}`)
        .send({ command });
      return { status: res.status, commandId: res.body?.commandId ?? '' };
    },
    async get(path) {
      const res = await request(server).get(path);
      return { status: res.status };
    },
    close: () => app.close(),
  };
};

/**
 * One instance's view of a shared in-memory transport. Two replicas on a real
 * Redis each hold their own client over one medium, and one instance going
 * down takes only its own subscriptions with it. `RemoteReplInMemoryTransport`
 * is the medium here; `close()` on a view silences that instance's handlers
 * and leaves the other instance's intact, so a scenario can kill one app.
 */
const viewOf = (shared: RemoteReplInMemoryTransport): RemoteReplTransport => {
  let open = true;
  return {
    publish: (topic, message) => shared.publish(topic, message),
    subscribe: (topic, handler) => shared.subscribe(topic, (m) => open && handler(m)),
    close: () => {
      open = false;
    },
  };
};

/**
 * Two instances sharing one in-memory transport. Because that transport is an
 * in-process EventEmitter, two apps that share one instance of it behave like
 * two horizontally-scaled replicas behind a real pub/sub backend.
 */
export interface Pair {
  a: Instance;
  b: Instance;
  closeAll(): Promise<void>;
}

export const bootPair = async (options: Partial<RemoteReplOptions> = {}): Promise<Pair> => {
  const shared = new RemoteReplInMemoryTransport();
  const a = await bootInstance(viewOf(shared), { instanceId: 'A', ...options });
  const b = await bootInstance(viewOf(shared), { instanceId: 'B', ...options });
  return {
    a,
    b,
    closeAll: async () => {
      await Promise.allSettled([a.close(), b.close()]);
      shared.close();
    },
  };
};

/** One SSE frame as it arrived on the wire: the `id:` line plus the parsed `data:` JSON. */
export interface Frame {
  wireId: string | null;
  event: RemoteReplEvent;
}

export interface SseClient {
  frames: Frame[];
  /** Resolves with the first frame matching `pred` (already received or future). */
  waitFor(pred: (f: Frame) => boolean, timeoutMs?: number): Promise<Frame>;
  /** Resolves after `ms` with every frame received so far (for "nothing arrives" checks). */
  settle(ms: number): Promise<Frame[]>;
  close(): void;
}

const parseFrame = (raw: string): Frame | null => {
  let wireId: string | null = null;
  let data: string | null = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('id:')) wireId = line.slice(3).trim();
    else if (line.startsWith('data:')) data = (data ?? '') + line.slice(5).trim();
  }
  if (data === null) return null;
  return { wireId, event: JSON.parse(data) as RemoteReplEvent };
};

export const openSse = (
  port: number,
  channel: string,
  lastEventId?: string | number,
): Promise<SseClient> =>
  new Promise((resolveOpen, rejectOpen) => {
    const frames: Frame[] = [];
    const waiters: Array<{ pred: (f: Frame) => boolean; resolve: (f: Frame) => void }> = [];
    let buffer = '';
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (lastEventId !== undefined) headers['Last-Event-ID'] = String(lastEventId);
    const req = http.get(
      `http://127.0.0.1:${port}/repl/${encodeURIComponent(channel)}`,
      { headers },
      (res) => {
        if (res.statusCode !== 200) {
          rejectOpen(new Error(`SSE connect failed: ${res.statusCode}`));
          req.destroy();
          return;
        }
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const frame = parseFrame(buffer.slice(0, idx));
            buffer = buffer.slice(idx + 2);
            if (!frame) continue;
            frames.push(frame);
            for (const w of [...waiters]) {
              if (w.pred(frame)) {
                waiters.splice(waiters.indexOf(w), 1);
                w.resolve(frame);
              }
            }
          }
        });
        resolveOpen({
          frames,
          waitFor: (pred, timeoutMs = 10_000) =>
            new Promise((resolve, reject) => {
              const hit = frames.find(pred);
              if (hit) return resolve(hit);
              const timer = setTimeout(
                () => reject(new Error(`timed out after ${timeoutMs}ms waiting for SSE frame`)),
                timeoutMs,
              );
              waiters.push({
                pred,
                resolve: (f) => {
                  clearTimeout(timer);
                  resolve(f);
                },
              });
            }),
          settle: (ms) => new Promise((resolve) => setTimeout(() => resolve([...frames]), ms)),
          close: () => {
            res.destroy();
            req.destroy();
          },
        });
      },
    );
    req.on('error', rejectOpen);
  });

export const isOutputContaining = (text: string) => (f: Frame) =>
  f.event.type === 'output' && String(f.event.data).includes(text);

export const isDoneFor = (commandId: string) => (f: Frame) =>
  f.event.type === 'system' &&
  f.event.commandId === commandId &&
  (f.event.data as { done?: boolean })?.done === true;

export const isPing = (f: Frame) =>
  f.event.type === 'system' && (f.event.data as { ping?: boolean })?.ping === true;

/** The `instanceId` announced by a `command` (execution-start) event. */
export const executorOf = (f: Frame) => (f.event.data as { instanceId: string }).instanceId;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
