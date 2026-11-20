# @remote-repl/express

## 1.2.0

### Minor Changes

- [#51](https://github.com/p-dim-popov/remote-repl/pull/51) [`cb40906`](https://github.com/p-dim-popov/remote-repl/commit/cb40906f2bcc1d3335faf36980716be0385768e9) Thanks [@p-dim-popov](https://github.com/p-dim-popov)! - Add `createRemoteRepl()`, a one-call setup: it builds the engine, starts it, and returns an Express router to mount behind your auth middleware (`app.use('/repl', requireAdmin, createRemoteRepl({ enabled }))`). Every session sees the Express app that mounts the router as `app`, next to `context` or what `buildContext({ app })` returns. The router carries `ready` (settles with the start; a failed start is logged and answers 503, it never crashes the app), `start()` (with `autoStart: false`, for an app that starts the REPL from its own lifecycle), `close()` and `engine`. `createRemoteReplEngine` and `createRemoteReplRouter` are unchanged.

## 1.1.0

### Minor Changes

- [#48](https://github.com/p-dim-popov/remote-repl/pull/48) [`d68d6fe`](https://github.com/p-dim-popov/remote-repl/commit/d68d6fe884789e685bc261f001bf88efa33a9bc6) Thanks [@p-dim-popov](https://github.com/p-dim-popov)! - Require Node 22 or later: `engines.node` is now `>=22` (was `>=20`). Node 20 is end of life and was never in the CI matrix. Node 22, 24 and 26, Bun and Deno are tested and supported. On Node 20, npm and pnpm warn on install (npm: `EBADENGINE`) and refuse when `engine-strict` is set; Yarn 1 refuses by default (`--ignore-engines` overrides).

### Patch Changes

- [#46](https://github.com/p-dim-popov/remote-repl/pull/46) [`ef363d8`](https://github.com/p-dim-popov/remote-repl/commit/ef363d856657c9a022b9df7016c221f5d689020f) Thanks [@p-dim-popov](https://github.com/p-dim-popov)! - README: document the supported runtimes (Node 22, 24, 26, Bun, Deno) and the consumer-app runtime suite that verifies the package on each of them.
- Updated dependencies [[`d68d6fe`](https://github.com/p-dim-popov/remote-repl/commit/d68d6fe884789e685bc261f001bf88efa33a9bc6)]:
  - @remote-repl/core@1.1.0

## 1.0.1

### Patch Changes

- [#41](https://github.com/p-dim-popov/remote-repl/pull/41) [`fe82376`](https://github.com/p-dim-popov/remote-repl/commit/fe82376bdbfa33016525ed28c52dc4ff4bc1156b) Thanks [@p-dim-popov](https://github.com/p-dim-popov)! - Publish through npm trusted publishing (OIDC) instead of an access token. No code changes: this release validates the trusted-publisher configuration for every package.
- Updated dependencies [[`fe82376`](https://github.com/p-dim-popov/remote-repl/commit/fe82376bdbfa33016525ed28c52dc4ff4bc1156b)]:
  - @remote-repl/core@1.0.1
