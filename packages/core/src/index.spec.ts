import * as core from './index';

// The barrel is the public API of @remote-repl/core and the only seam the
// framework packages import from. Its runtime keys are pinned here: the ring
// buffer, the Node session implementation, the UI renderer, the Monaco asset
// resolver and the SSE/landing helpers stay internal and are reached through
// the handlers (ADR 0005). A new or removed export shows up here in the diff.
describe('@remote-repl/core barrel', () => {
  it('exports exactly the public runtime surface', () => {
    expect(Object.keys(core).sort()).toEqual(
      [
        'REMOTE_REPL_DEFAULTS',
        'REMOTE_REPL_SSE_RESPONSE_HEADERS',
        'REMOTE_REPL_SSE_STREAM_PREAMBLE',
        'REMOTE_REPL_TOPICS',
        'RemoteReplDisabledError',
        'RemoteReplEngine',
        'RemoteReplInMemoryTransport',
        'RemoteReplInvalidCommandError',
        'createRemoteReplHandlers',
        'parseRemoteReplLastEventId',
      ].sort(),
    );
  });
});
