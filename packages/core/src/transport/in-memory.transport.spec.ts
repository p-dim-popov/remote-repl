import { RemoteReplInMemoryTransport } from './in-memory.transport';

describe('RemoteReplInMemoryTransport', () => {
  it('delivers a published message to a subscriber on the same topic', async () => {
    const a = new RemoteReplInMemoryTransport();
    const received: string[] = [];
    await a.subscribe('remote-repl:cmd', (m) => received.push(m));
    await a.publish('remote-repl:cmd', 'hello');
    await new Promise((r) => setTimeout(r, 0));
    expect(received).toEqual(['hello']);
  });

  it('does not cross topics', async () => {
    const a = new RemoteReplInMemoryTransport();
    const received: string[] = [];
    await a.subscribe('remote-repl:out', (m) => received.push(m));
    await a.publish('remote-repl:cmd', 'x');
    await new Promise((r) => setTimeout(r, 0));
    expect(received).toEqual([]);
  });

  it('fans out to multiple subscribers', async () => {
    const a = new RemoteReplInMemoryTransport();
    const one: string[] = [];
    const two: string[] = [];
    await a.subscribe('remote-repl:sys', (m) => one.push(m));
    await a.subscribe('remote-repl:sys', (m) => two.push(m));
    await a.publish('remote-repl:sys', 'claim');
    await new Promise((r) => setTimeout(r, 0));
    expect(one).toEqual(['claim']);
    expect(two).toEqual(['claim']);
  });

  it('delivers a published message back to the publishing instance (uniform dispatch)', async () => {
    const a = new RemoteReplInMemoryTransport();
    const ownReceived: string[] = [];
    await a.subscribe('remote-repl:cmd', (m) => ownReceived.push(m));
    await a.publish('remote-repl:cmd', 'self');
    await new Promise((r) => setTimeout(r, 0));
    expect(ownReceived).toEqual(['self']);
  });

  // The engine relies on this: a subscriber that attaches right after a
  // publish still receives it (see the replay comment in remote-repl-engine.ts).
  it('delivers asynchronously, never inside publish()', async () => {
    const a = new RemoteReplInMemoryTransport();
    const received: string[] = [];
    await a.subscribe('remote-repl:out', (m) => received.push(m));
    void a.publish('remote-repl:out', 'later');
    expect(received).toEqual([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(received).toEqual(['later']);
  });

  it('detaches every subscriber on close()', async () => {
    const t = new RemoteReplInMemoryTransport();
    const received: string[] = [];
    await t.subscribe('remote-repl:cmd', (m) => received.push(m));
    t.close();
    await t.publish('remote-repl:cmd', 'after-close');
    await new Promise((r) => setTimeout(r, 0));
    expect(received).toEqual([]);
  });
});
