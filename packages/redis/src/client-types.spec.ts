import type Redis from 'ioredis';
import type { createClient } from 'redis';
import type { RemoteReplIoRedisLike } from './ioredis.transport';
import type { RemoteReplNodeRedisLike } from './node-redis.transport';

// The transports take structural `*Like` clients so this package imports no
// client at runtime. The specs drive them with ioredis-mock and a hand-written
// fake; these assertions tie the interfaces to the REAL clients' types, so a
// client major that changes a signature fails `npm run typecheck`
// (expectTypeOf does nothing at runtime).
describe('real Redis client types', () => {
  it('an ioredis client satisfies RemoteReplIoRedisLike', () => {
    expectTypeOf<Redis>().toMatchTypeOf<RemoteReplIoRedisLike>();
  });

  it('a node-redis client satisfies RemoteReplNodeRedisLike', () => {
    expectTypeOf<ReturnType<typeof createClient>>().toMatchTypeOf<RemoteReplNodeRedisLike>();
  });
});
