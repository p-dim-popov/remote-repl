# nestjs-web-repl

## 2.5.0

### Minor Changes

- [#48](https://github.com/p-dim-popov/remote-repl/pull/48) [`d68d6fe`](https://github.com/p-dim-popov/remote-repl/commit/d68d6fe884789e685bc261f001bf88efa33a9bc6) Thanks [@p-dim-popov](https://github.com/p-dim-popov)! - Require Node 22 or later: `engines.node` is now `>=22` (was `>=20`). Node 20 is end of life and was never in the CI matrix. Node 22, 24 and 26, Bun and Deno are tested and supported. On Node 20, npm and pnpm warn on install (npm: `EBADENGINE`) and refuse when `engine-strict` is set; Yarn 1 refuses by default (`--ignore-engines` overrides).

### Patch Changes

- Updated dependencies [[`d68d6fe`](https://github.com/p-dim-popov/remote-repl/commit/d68d6fe884789e685bc261f001bf88efa33a9bc6)]:
  - @remote-repl/nestjs@1.1.0
  - @remote-repl/redis@1.1.0

## 2.4.1

### Patch Changes

- [#41](https://github.com/p-dim-popov/remote-repl/pull/41) [`fe82376`](https://github.com/p-dim-popov/remote-repl/commit/fe82376bdbfa33016525ed28c52dc4ff4bc1156b) Thanks [@p-dim-popov](https://github.com/p-dim-popov)! - Publish through npm trusted publishing (OIDC) instead of an access token. No code changes: this release validates the trusted-publisher configuration for every package.
- Updated dependencies [[`fe82376`](https://github.com/p-dim-popov/remote-repl/commit/fe82376bdbfa33016525ed28c52dc4ff4bc1156b)]:
  - @remote-repl/nestjs@1.0.1
  - @remote-repl/redis@1.0.1

## 2.4.0

### Minor Changes

- [#35](https://github.com/p-dim-popov/remote-repl/pull/35) [`c826981`](https://github.com/p-dim-popov/remote-repl/commit/c8269817f2d7d24dafe2ae5d53de0482babe22ee) Thanks [@p-dim-popov](https://github.com/p-dim-popov)! - `nestjs-web-repl` is now a compatibility shim over the `@remote-repl` packages ([#19](https://github.com/p-dim-popov/remote-repl/issues/19), [#36](https://github.com/p-dim-popov/remote-repl/issues/36)).
  
  The implementation moved to `@remote-repl/nestjs` (the NestJS module), `@remote-repl/redis` (the Redis transports), `@remote-repl/express` (the Express router) and `@remote-repl/core` (the engine and the protocol). Those four packages publish at 1.0.0 and carry their own version lines from here on; this package stays on its 2.x line and depends on `@remote-repl/nestjs ^1.0.0` and `@remote-repl/redis ^1.0.0`.
  
  Every name an app imported from `nestjs-web-repl` or `nestjs-web-repl/redis` still resolves, as a `@deprecated` alias of its replacement, and the new names are exported beside them. `WebReplModule.register` / `registerAsync` still accept the `adapter` extra (every DI form) and pass it on as `transport`. A transport that implements only `onModuleDestroy()` keeps working. There is no runtime warning.
  
  | `nestjs-web-repl` (deprecated) | replacement in `@remote-repl/nestjs` |
  | --- | --- |
  | `WebReplModule`, `register({ adapter })` | `RemoteReplModule`, `register({ transport })` |
  | `WebReplController` / `WebReplService` | `RemoteReplController` / `RemoteReplService` |
  | `InMemoryWebReplAdapter` | `RemoteReplInMemoryTransport` |
  | `WEB_REPL_OPTIONS` | `REMOTE_REPL_OPTIONS` |
  | `WebReplAdapter` (`onModuleDestroy`) | `RemoteReplTransport` (`close`) |
  | `WebReplModuleOptions` / `WebReplModuleExtras` / `WebReplAdapterConfig` | `RemoteReplModuleOptions` / `RemoteReplModuleExtras` / `RemoteReplTransportConfig` |
  | `WebReplEvent` / `SseEventType` | `RemoteReplEvent` / `RemoteReplSseEventType` |
  
  | `nestjs-web-repl/redis` (deprecated) | replacement in `@remote-repl/redis` |
  | --- | --- |
  | `IoRedisWebReplAdapter` / `NodeRedisWebReplAdapter` / `BaseRedisWebReplAdapter` | `RemoteReplIoRedisTransport` / `RemoteReplNodeRedisTransport` / `RemoteReplBaseRedisTransport` |
  | `RedisWebReplAdapterOptions`, `IoRedisLike`, `NodeRedisLike` | `RemoteReplRedisTransportOptions`, `RemoteReplIoRedisLike`, `RemoteReplNodeRedisLike` |
  
  **Wire change.** This version speaks the `remote-repl` wire protocol 1.0.0 (`PROTOCOL.md` in `@remote-repl/core`) and is not interoperable with 2.3.x on one Redis. During a rolling upgrade the old and the new instances form two clusters until the last 2.3.x instance stops; its leases then expire and no further repair is needed.
  
  **Removed.** The `npx nestjs-web-repl install-skill` bin. Install the agent skill with `npx skills add p-dim-popov/remote-repl/skills/nestjs-web-repl`.
  
  Why `minor`: every 2.3.x import and option still works. The wire change only matters for a mixed-version cluster during a rolling upgrade, which the protocol document covers.
  
  Why no changeset for the four `@remote-repl` packages: they have never been published. `changeset version` only bumps packages that have a pending changeset, so they stay at the 1.0.0 set by hand, and `changeset publish` publishes every workspace package whose current version is absent from the registry, so all four ship on the first release without a changeset or a changelog entry.
