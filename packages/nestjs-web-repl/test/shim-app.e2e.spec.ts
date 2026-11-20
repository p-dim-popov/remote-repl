import { INestApplication, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { InMemoryWebReplAdapter, WebReplModule, WebReplService } from 'nestjs-web-repl';
import type { WebReplAdapter, WebReplEvent, WebReplModuleOptions } from 'nestjs-web-repl';

// A consumer app written against the legacy entry point: the module, the DI
// token-bearing service and the option/event TYPES all come from
// `nestjs-web-repl`, with the legacy `adapter` extra in every DI form, and
// register / registerAsync work through the alias (incl. runtime `enabled`).
function consumerApp(dynamic: ReturnType<typeof WebReplModule.register>) {
  @Module({ imports: [dynamic] })
  class ConsumerAppModule {}
  return ConsumerAppModule;
}

const boot = async (dynamic: ReturnType<typeof WebReplModule.register>): Promise<INestApplication> => {
  const mod = await Test.createTestingModule({ imports: [consumerApp(dynamic)] }).compile();
  const app = mod.createNestApplication();
  await app.init();
  return app;
};

// Runs one command through the booted app and resolves once its output
// reached the service's stream: the proof that the configured adapter
// carries the protocol end to end.
const roundTrip = async (app: INestApplication, channel: string): Promise<void> => {
  const events: WebReplEvent[] = [];
  const sub = app.get(WebReplService).stream(channel, null).subscribe((e) => events.push(e as WebReplEvent));
  const res = await request(app.getHttpServer()).post(`/repl/${channel}`).send({ command: '6 * 7' });
  expect(res.status).toBe(202);
  await vi.waitFor(() => {
    expect(events.some((e) => JSON.stringify(e.data).includes('42'))).toBe(true);
  });
  sub.unsubscribe();
};

// A transport written against nestjs-web-repl 2.3.x: `onModuleDestroy`, not
// `close`. It wraps the in-memory one so the round trip still works. As in
// 2.3.x, the hook runs twice on shutdown (Nest calls it on the provider, the
// engine calls it as the `close()` fallback), so legacy transports are
// idempotent there; the assertions below check that it ran, not how often.
class LegacyAdapter implements WebReplAdapter {
  readonly destroyed: string[] = [];
  private readonly inner = new InMemoryWebReplAdapter();
  publish(topic: string, message: string): Promise<void> {
    return this.inner.publish(topic, message);
  }
  subscribe(topic: string, handler: (message: string) => void): Promise<void> {
    return this.inner.subscribe(topic, handler);
  }
  onModuleDestroy(): void {
    this.destroyed.push('onModuleDestroy');
    this.inner.close();
  }
}

describe('a Nest app importing nestjs-web-repl', () => {
  it('register({ enabled: false }) 404s every route and refuses to execute', async () => {
    const options: WebReplModuleOptions = { enabled: false };
    const app = await boot(WebReplModule.register(options));
    const http = app.getHttpServer();
    expect((await request(http).get('/repl/x/ui')).status).toBe(404);
    expect((await request(http).post('/repl/x').send({ command: '1+1' })).status).toBe(404);
    expect((await request(http).get('/repl/x').set('Accept', 'text/event-stream')).status).toBe(404);
    await expect(app.get(WebReplService).dispatch('x', '1+1')).rejects.toThrow();
    await app.close();
  });

  it('register({ enabled: true }) serves the UI and runs a command whose output reaches the stream', async () => {
    const app = await boot(WebReplModule.register({ enabled: true, instanceId: 'shim-A' }));
    expect((await request(app.getHttpServer()).get('/repl/shim/ui')).status).toBe(200);
    await roundTrip(app, 'shim');
    await app.close();
  });

  it('registerAsync({ enabled: false }) is enforced at runtime too', async () => {
    const app = await boot(WebReplModule.registerAsync({ useFactory: () => ({ enabled: false }) }));
    expect((await request(app.getHttpServer()).get('/repl/x/ui')).status).toBe(404);
    await app.close();
  });
});

describe('the legacy `adapter` extra, in every DI form', () => {
  it('a ready instance', async () => {
    const adapter = new LegacyAdapter();
    const app = await boot(WebReplModule.register({ enabled: true, instanceId: 'inst', adapter }));
    await roundTrip(app, 'instance');
    await app.close();
    expect(adapter.destroyed).toContain('onModuleDestroy');
  });

  it('a class', async () => {
    const app = await boot(WebReplModule.register({ enabled: true, instanceId: 'cls', adapter: LegacyAdapter }));
    await roundTrip(app, 'class');
    await app.close();
  });

  it('{ useClass, imports } resolved through DI', async () => {
    @Injectable()
    class Dep {
      readonly value = 'dep-value';
    }
    @Module({ providers: [Dep], exports: [Dep] })
    class DepModule {}
    @Injectable()
    class DiAdapter extends LegacyAdapter {
      constructor(readonly dep: Dep) {
        super();
      }
    }
    const app = await boot(
      WebReplModule.register({ enabled: true, instanceId: 'uc', adapter: { useClass: DiAdapter, imports: [DepModule] } }),
    );
    await roundTrip(app, 'use-class');
    await app.close();
  });

  it('{ useFactory, inject, imports }', async () => {
    @Injectable()
    class Dep {}
    @Module({ providers: [Dep], exports: [Dep] })
    class DepModule {}
    const seen: unknown[] = [];
    const app = await boot(
      WebReplModule.register({
        enabled: true,
        instanceId: 'uf',
        adapter: {
          useFactory: (dep: Dep) => {
            seen.push(dep);
            return new LegacyAdapter();
          },
          inject: [Dep],
          imports: [DepModule],
        },
      }),
    );
    await roundTrip(app, 'use-factory');
    await app.close();
    expect(seen).toHaveLength(1);
  });

  it('registerAsync carries the adapter extra beside the async options', async () => {
    const adapter = new LegacyAdapter();
    const app = await boot(
      WebReplModule.registerAsync({ useFactory: () => ({ enabled: true, instanceId: 'async' }), adapter }),
    );
    await roundTrip(app, 'async');
    await app.close();
    expect(adapter.destroyed).toContain('onModuleDestroy');
  });
});
