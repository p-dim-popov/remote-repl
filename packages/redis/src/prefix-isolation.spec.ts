// Cross-app isolation on a shared Redis: two transports (two different APPS,
// not two replicas of one app) over one ioredis-mock server, which models one
// Redis. The topic prefix is what lets several apps share one medium without
// seeing each other: no prefix leaks, the same prefix shares (instances with
// the same prefix form one cluster), different prefixes isolate. The wire is observed by
// an independent raw client, so the test sees exactly what another process
// on that Redis would see.
import RedisMock from 'ioredis-mock';
import { REMOTE_REPL_TOPICS } from '@remote-repl/core';
import { RemoteReplIoRedisTransport, type RemoteReplIoRedisLike } from './ioredis.transport';

const client = (): RemoteReplIoRedisLike => new RedisMock() as unknown as RemoteReplIoRedisLike;
const settle = () => new Promise((r) => setTimeout(r, 20));

/** A raw subscriber on the shared mock Redis: records `<wire topic> <message>`. */
const observers: RedisMock[] = [];
const observe = async (...topics: string[]) => {
  const sub = new RedisMock();
  observers.push(sub);
  const log: string[] = [];
  sub.on('message', (topic: string, message: string) => log.push(`${topic} ${message}`));
  await sub.subscribe(...topics);
  return log;
};
afterEach(async () => {
  await Promise.all(observers.splice(0).map((o) => o.quit()));
});

const apps = async (prefixA?: string, prefixB?: string) => {
  const a = new RemoteReplIoRedisTransport(client(), { prefix: prefixA });
  const b = new RemoteReplIoRedisTransport(client(), { prefix: prefixB });
  const heardByA: string[] = [];
  const heardByB: string[] = [];
  await a.subscribe(REMOTE_REPL_TOPICS.out, (m) => heardByA.push(m));
  await b.subscribe(REMOTE_REPL_TOPICS.out, (m) => heardByB.push(m));
  return {
    a,
    b,
    heardByA,
    heardByB,
    close: () => Promise.all([a.close(), b.close()]),
  };
};

describe('cross-app isolation on a shared Redis', () => {
  it('with no prefix (the default), two apps hear each other -- documented current behavior', async () => {
    const t = await apps();
    try {
      await t.a.publish(REMOTE_REPL_TOPICS.out, 'from-A');
      await settle();
      expect(t.heardByB).toEqual(['from-A']);
    } finally {
      await t.close();
    }
  });

  it('with the SAME prefix, the apps form one cluster and share the topic -- the prefix is not an app id', async () => {
    const shared = 'shared:';
    const wire = await observe(shared + REMOTE_REPL_TOPICS.out);
    const t = await apps(shared, shared);
    try {
      await t.a.publish(REMOTE_REPL_TOPICS.out, 'from-A');
      await t.b.publish(REMOTE_REPL_TOPICS.out, 'from-B');
      await settle();
      expect(t.heardByB).toEqual(['from-A', 'from-B']);
      expect(t.heardByA).toEqual(['from-A', 'from-B']);
      // Both apps put their traffic on the same prefixed wire topic.
      expect(wire).toEqual([
        `${shared}${REMOTE_REPL_TOPICS.out} from-A`,
        `${shared}${REMOTE_REPL_TOPICS.out} from-B`,
      ]);
    } finally {
      await t.close();
    }
  });

  it('with different prefixes, the apps never exchange messages', async () => {
    const prefixA = 'app-a:';
    const prefixB = 'app-b:';
    const wireA = await observe(prefixA + REMOTE_REPL_TOPICS.out);
    const unprefixed = await observe(REMOTE_REPL_TOPICS.out);
    const t = await apps(prefixA, prefixB);
    try {
      await t.a.publish(REMOTE_REPL_TOPICS.out, 'from-A');
      await t.b.publish(REMOTE_REPL_TOPICS.out, 'from-B');
      await settle();
      expect(t.heardByA).toEqual(['from-A']);
      expect(t.heardByB).toEqual(['from-B']);
      // The prefix is prepended verbatim to the wire topic name, and nothing
      // leaks onto the unprefixed topic.
      expect(wireA).toEqual([`${prefixA}${REMOTE_REPL_TOPICS.out} from-A`]);
      expect(unprefixed).toEqual([]);
    } finally {
      await t.close();
    }
  });
});
