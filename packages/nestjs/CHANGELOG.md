# @remote-repl/nestjs

## 1.1.0

### Minor Changes

- [#48](https://github.com/p-dim-popov/remote-repl/pull/48) [`d68d6fe`](https://github.com/p-dim-popov/remote-repl/commit/d68d6fe884789e685bc261f001bf88efa33a9bc6) Thanks [@p-dim-popov](https://github.com/p-dim-popov)! - Require Node 22 or later: `engines.node` is now `>=22` (was `>=20`). Node 20 is end of life and was never in the CI matrix. Node 22, 24 and 26, Bun and Deno are tested and supported. On Node 20, npm and pnpm warn on install (npm: `EBADENGINE`) and refuse when `engine-strict` is set; Yarn 1 refuses by default (`--ignore-engines` overrides).

### Patch Changes

- Updated dependencies [[`d68d6fe`](https://github.com/p-dim-popov/remote-repl/commit/d68d6fe884789e685bc261f001bf88efa33a9bc6)]:
  - @remote-repl/core@1.1.0

## 1.0.1

### Patch Changes

- [#41](https://github.com/p-dim-popov/remote-repl/pull/41) [`fe82376`](https://github.com/p-dim-popov/remote-repl/commit/fe82376bdbfa33016525ed28c52dc4ff4bc1156b) Thanks [@p-dim-popov](https://github.com/p-dim-popov)! - Publish through npm trusted publishing (OIDC) instead of an access token. No code changes: this release validates the trusted-publisher configuration for every package.
- Updated dependencies [[`fe82376`](https://github.com/p-dim-popov/remote-repl/commit/fe82376bdbfa33016525ed28c52dc4ff4bc1156b)]:
  - @remote-repl/core@1.0.1
