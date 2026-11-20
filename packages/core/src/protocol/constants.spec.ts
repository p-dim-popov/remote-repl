import { REMOTE_REPL_TOPICS, REMOTE_REPL_DEFAULTS } from './constants';

describe('protocol constants', () => {
  // The topic names are wire protocol: instances on different versions must
  // agree on them, and no behaviour test can tell a renamed topic apart.
  it('exposes the fixed transport topics under the remote-repl: prefix', () => {
    expect(REMOTE_REPL_TOPICS).toEqual({
      cmd: 'remote-repl:cmd',
      out: 'remote-repl:out',
      sys: 'remote-repl:sys',
    });
  });

  // Below 2x the engine clamps the lease and warns on every boot (see the
  // owner-liveness clamp in remote-repl-engine.ts).
  it('the owner lease default is at least twice the owner heartbeat default', () => {
    expect(REMOTE_REPL_DEFAULTS.ownerLeaseTtl).toBeGreaterThanOrEqual(2 * REMOTE_REPL_DEFAULTS.ownerHeartbeatInterval);
  });
});
