import { expectTypeOf } from 'vitest';
import type { RemoteReplOptions } from './options';

// Framework-free options shape: everything the engine needs, nothing a
// framework module adds (transport config, controller class, DI imports).
// expectTypeOf does nothing at runtime: `npm run typecheck` checks this file.
describe('RemoteReplOptions', () => {
  it('requires only `enabled`; every tuning knob is optional', () => {
    expectTypeOf<RemoteReplOptions>().toHaveProperty('enabled');
    expectTypeOf<RemoteReplOptions['enabled']>().toEqualTypeOf<boolean>();
    expectTypeOf<{ enabled: true }>().toMatchTypeOf<RemoteReplOptions>();
    expectTypeOf<RemoteReplOptions['ownerLeaseTtl']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<RemoteReplOptions>().not.toHaveProperty('transport');
  });
});
