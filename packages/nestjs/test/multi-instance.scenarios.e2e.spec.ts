// The multi-instance scenarios at the HTTP + SSE seam: two real Nest apps on
// one in-memory transport (two replicas, as far as the engine can tell).
// Pins ownership and single execution, the owner-liveness lease, SSE replay,
// per-channel serialization and the `enabled` rail. Only external behavior
// is asserted: HTTP status codes, SSE frames on the wire, and the calls the
// instances make on the transport. The Redis transports' own behavior (the
// topic prefix) is pinned in packages/redis; the e2e next to this file is the
// minimal cross-instance proof.
import { RemoteReplInMemoryTransport } from '@remote-repl/core';
import {
  bootInstance,
  bootPair,
  executorOf,
  isDoneFor,
  isOutputContaining,
  isPing,
  openSse,
  sleep,
  type Pair,
} from './harness';

describe('ownership & single execution', () => {
  let pair: Pair;
  beforeAll(async () => {
    pair = await bootPair();
  });
  afterAll(() => pair.closeAll());

  it('executes a command exactly once on the owner, relays from the other, fans output to both streams', async () => {
    const { a, b } = pair;
    const channel = 'own';
    const sseA = await openSse(a.port, channel);
    const sseB = await openSse(b.port, channel);

    const first = await a.post(channel, 'const total = 100');
    expect(first.status).toBe(202);
    await sseA.waitFor(isDoneFor(first.commandId));

    // Posted to B, but A owns the channel: A must execute it in the SAME
    // session (so `total` is still in scope) and the result must reach
    // both instances' SSE streams.
    const second = await b.post(channel, 'total + 1');
    expect(second.status).toBe(202);
    const outA = await sseA.waitFor(isOutputContaining('101'));
    const outB = await sseB.waitFor(isOutputContaining('101'));
    expect(outA.event.commandId).toBe(second.commandId);
    expect(outB.event).toEqual(outA.event);

    // Exactly one `command` (execution-start) event per command, both
    // announced by A -- B never executed anything.
    for (const sse of [sseA, sseB]) {
      for (const cmd of [first, second]) {
        const starts = sse.frames.filter(
          (f) => f.event.type === 'command' && f.event.commandId === cmd.commandId,
        );
        expect(starts).toHaveLength(1);
        expect(executorOf(starts[0])).toBe('A');
      }
      expect(sse.frames.some((f) => String(f.event.data).includes('ReferenceError'))).toBe(false);
    }
    sseA.close();
    sseB.close();
  }, 20_000);
});

describe('lease takeover', () => {
  // Short lease so the scenario runs in real time: heartbeat 200ms, lease
  // 400ms (the enforced minimum of 2x heartbeat).
  const lease = { ownerHeartbeatInterval: 200, ownerLeaseTtl: 400 };

  it('a live, heartbeating owner is never preempted, even long after the lease TTL', async () => {
    const pair = await bootPair(lease);
    try {
      const { a, b } = pair;
      const channel = 'live';
      const sseB = await openSse(b.port, channel);
      const first = await a.post(channel, 'const kept = 7');
      await sseB.waitFor(isDoneFor(first.commandId));

      // Well past ownerLeaseTtl -- A's heartbeats must have kept the lease fresh on B.
      await sleep(lease.ownerLeaseTtl * 3);

      const second = await b.post(channel, 'kept * 6');
      const out = await sseB.waitFor(isOutputContaining('42'));
      expect(out.event.commandId).toBe(second.commandId);
      const start = sseB.frames.find(
        (f) => f.event.type === 'command' && f.event.commandId === second.commandId,
      )!;
      expect(executorOf(start)).toBe('A');
      sseB.close();
    } finally {
      await pair.closeAll();
    }
  }, 20_000);

  it('after the owner dies and the lease expires, the next command’s origin takes over with a fresh session', async () => {
    const pair = await bootPair(lease);
    try {
      const { a, b } = pair;
      const channel = 'dead';
      const sseB = await openSse(b.port, channel);
      const first = await a.post(channel, 'const gone = 1');
      await sseB.waitFor(isDoneFor(first.commandId));

      // Kill the owner without a release (a crash, as far as B can tell).
      await a.close();
      await sleep(lease.ownerLeaseTtl + 200);

      const second = await b.post(channel, 'typeof gone');
      expect(second.status).toBe(202);
      const out = await sseB.waitFor(isOutputContaining('undefined'));
      expect(out.event.commandId).toBe(second.commandId);
      const start = sseB.frames.find(
        (f) => f.event.type === 'command' && f.event.commandId === second.commandId,
      )!;
      expect(executorOf(start)).toBe('B');
      await sseB.waitFor(isDoneFor(second.commandId));
      sseB.close();
    } finally {
      await pair.closeAll();
    }
  }, 20_000);
});

describe('SSE replay', () => {
  let pair: Pair;
  beforeAll(async () => {
    pair = await bootPair({ heartbeatInterval: 150 });
  });
  afterAll(() => pair.closeAll());

  it('a client reconnecting with Last-Event-ID receives only the events it missed', async () => {
    const { a, b } = pair;
    const channel = 'replay';
    const live = await openSse(a.port, channel);
    const c1 = await a.post(channel, "'one'");
    await live.waitFor(isDoneFor(c1.commandId));
    const c2 = await a.post(channel, "'two'");
    await live.waitFor(isDoneFor(c2.commandId));
    const all = live.frames.filter((f) => !isPing(f));
    live.close();
    // Six real events: command/output/done for each of the two commands.
    expect(all.map((f) => f.event.type)).toEqual([
      'command', 'output', 'system', 'command', 'output', 'system',
    ]);
    // Wire ids are the event ids, strictly increasing.
    expect(all.map((f) => Number(f.wireId))).toEqual(all.map((f) => f.event.id));

    // Reconnect (on the OTHER instance, which only relayed) from the
    // cursor of the last event of the first command.
    const cursor = all[2].event.id;
    const resumed = await openSse(b.port, channel, cursor);
    const got = await resumed.settle(300);
    resumed.close();
    expect(got.filter((f) => !isPing(f)).map((f) => f.event)).toEqual(
      all.slice(3).map((f) => f.event),
    );
  }, 20_000);

  it('heartbeats carry the last real event id, so an idle reconnect replays nothing', async () => {
    const { a } = pair;
    const channel = 'idle';
    const live = await openSse(a.port, channel);
    const c1 = await a.post(channel, "'hello'");
    const done = await live.waitFor(isDoneFor(c1.commandId));

    // Idle: wait for a heartbeat that arrives AFTER the last real event.
    const ping = await live.waitFor((f) => isPing(f) && live.frames.indexOf(f) > live.frames.indexOf(done));
    live.close();
    expect(ping.wireId).toBe(String(done.event.id));

    // A browser EventSource would reconnect with that id; nothing is replayed.
    const resumed = await openSse(a.port, channel, ping.wireId!);
    const got = await resumed.settle(300);
    resumed.close();
    expect(got.filter((f) => !isPing(f))).toEqual([]);
    // Even before any real event, a heartbeat echoes the client's own cursor.
    expect(got.filter(isPing).every((f) => f.wireId === ping.wireId)).toBe(true);
  }, 20_000);
});

describe('per-channel serialization', () => {
  let pair: Pair;
  beforeAll(async () => {
    pair = await bootPair();
  });
  afterAll(() => pair.closeAll());

  it('runs two commands on one channel serially and tags every output with the executing command', async () => {
    const { a, b } = pair;
    const channel = 'serial';
    const sse = await openSse(b.port, channel);
    // Establish the owner first. Two origins posting the first command of
    // a brand-new channel at the same instant is the documented
    // last-claim-wins window (PROTOCOL.md §5.2), where both execute their
    // own command; this scenario is about serialization under one owner.
    const warmUp = await a.post(channel, 'void 0');
    await sse.waitFor(isDoneFor(warmUp.commandId));
    // The first command sleeps before producing output; the second (posted
    // via the other instance) must still wait for it to finish.
    const slow = await a.post(channel, "await new Promise(r => setTimeout(r, 400)); 'slow-done'");
    const fast = await b.post(channel, "'fast-done'");
    await sse.waitFor(isDoneFor(fast.commandId));
    sse.close();

    const real = sse.frames
      .filter((f) => !isPing(f))
      .map((f) => f.event)
      .filter((e) => e.commandId !== warmUp.commandId);
    expect(real.map((e) => [e.type, e.commandId])).toEqual([
      ['command', slow.commandId],
      ['output', slow.commandId],
      ['system', slow.commandId],
      ['command', fast.commandId],
      ['output', fast.commandId],
      ['system', fast.commandId],
    ]);
    expect(String(real[1].data)).toContain('slow-done');
    expect(String(real[4].data)).toContain('fast-done');
  }, 20_000);
});

describe('`enabled` enforcement', () => {
  it('a disabled instance 404s on every route and puts no traffic on the transport', async () => {
    const transport = new RemoteReplInMemoryTransport();
    const subscribe = vi.spyOn(transport, 'subscribe');
    const publish = vi.spyOn(transport, 'publish');
    const disabled = await bootInstance(transport, { instanceId: 'OFF', enabled: false });
    try {
      const channel = 'off';
      expect((await disabled.get('/repl')).status).toBe(404);
      expect((await disabled.post(channel, '1 + 1')).status).toBe(404);
      expect((await disabled.get(`/repl/${channel}/ui`)).status).toBe(404);
      expect((await disabled.get(`/repl/${channel}/vs/loader.js`)).status).toBe(404);
      await expect(openSse(disabled.port, channel)).rejects.toThrow(/404/);

      // Nothing was subscribed and nothing was published.
      await sleep(100);
      expect(subscribe).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    } finally {
      await disabled.close();
    }
  }, 20_000);
});
