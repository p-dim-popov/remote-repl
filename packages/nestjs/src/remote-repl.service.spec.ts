import { NotFoundException } from '@nestjs/common';
import { firstValueFrom, toArray } from 'rxjs';
import { take } from 'rxjs/operators';
import { RemoteReplService } from './remote-repl.service';
import { RemoteReplInMemoryTransport } from '@remote-repl/core';
import type { RemoteReplModuleOptions } from './interfaces/remote-repl-options.interface';

const makeService = async (
  instanceId: string,
  transport: RemoteReplInMemoryTransport,
  contextFactory: () => Record<string, unknown> = () => ({ marker: () => 'ctx-ok' }),
) => {
  const options: RemoteReplModuleOptions = { enabled: true, instanceId };
  const svc = new RemoteReplService(options, transport, contextFactory);
  await svc.onModuleInit();
  return svc;
};

// RemoteReplService is the Nest face of core's RemoteReplEngine. The engine's
// behaviour (execution, ownership and the lease, replay, GC) is specified in
// packages/core/src/engine/remote-repl-engine.spec.ts; this spec covers only
// what the service adds: the RxJS stream() and the NotFoundException mapping.
describe('RemoteReplService', () => {
  it('stream() is an Observable over the engine stream: the command echo, then the output', async () => {
    const transport = new RemoteReplInMemoryTransport();
    const svc = await makeService('A', transport);

    const events = firstValueFrom(svc.stream('c1', null).pipe(take(2), toArray()));
    const { commandId } = await svc.dispatch('c1', '2 + 3');
    const got = await events;

    expect(got[0].type).toBe('command');
    expect(got[0].commandId).toBe(commandId);
    expect(got[1].type).toBe('output');
    expect(String(got[1].data)).toContain('5');
    await svc.onModuleDestroy();
  });

  it('unsubscribing from stream() releases the engine subscription, so an idle channel is evicted', async () => {
    const transport = new RemoteReplInMemoryTransport();
    const svc = await makeService('A', transport);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internals = svc as any;

    const sub = svc.stream('ghost-chan', null).subscribe();
    // Subscribing lazily creates the channel state (via getChannel at
    // subscribe time), so it should now be present in the map.
    expect(internals.channels.has('ghost-chan')).toBe(true);

    sub.unsubscribe();

    // No command was ever dispatched on this channel, so there is no
    // session and the replay buffer is empty -- the channel must be
    // evicted, not retained forever.
    expect(internals.channels.has('ghost-chan')).toBe(false);

    await svc.onModuleDestroy();
  });

  // --- CRITICAL 1: `enabled` must be enforced at runtime, not just at
  // module-registration time, so a registerAsync-resolved `enabled: false`
  // can't ship a live execution endpoint. ---
  describe('when disabled at runtime', () => {
    const makeDisabledService = (transport: RemoteReplInMemoryTransport) => {
      const options: RemoteReplModuleOptions = { enabled: false, instanceId: 'D' };
      return new RemoteReplService(options, transport, () => ({ marker: () => 'ctx-ok' }));
    };

    it('does not subscribe to the transport on onModuleInit', async () => {
      const transport = new RemoteReplInMemoryTransport();
      const subscribeSpy = vi.spyOn(transport, 'subscribe');
      const svc = makeDisabledService(transport);

      await svc.onModuleInit();

      expect(subscribeSpy).not.toHaveBeenCalled();
      await svc.onModuleDestroy();
    });

    it('dispatch() throws NotFoundException and never publishes a command', async () => {
      const transport = new RemoteReplInMemoryTransport();
      const publishSpy = vi.spyOn(transport, 'publish');
      const svc = makeDisabledService(transport);
      await svc.onModuleInit();

      await expect(svc.dispatch('dchan', '1 + 1')).rejects.toThrow(NotFoundException);
      expect(publishSpy).not.toHaveBeenCalled();

      await svc.onModuleDestroy();
    });

    it('stream() throws NotFoundException instead of returning an observable', async () => {
      const transport = new RemoteReplInMemoryTransport();
      const svc = makeDisabledService(transport);
      await svc.onModuleInit();

      expect(() => svc.stream('dchan', null)).toThrow(NotFoundException);

      await svc.onModuleDestroy();
    });
  });
});
