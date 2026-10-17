---
status: accepted
---

# One verify workflow, one runtime pin, every runtime blocking

## Context

After the split (ADR 0001) the verification recipe (Redis service, install,
build, typecheck, schema check, test) was written out by hand three times:
the Node job in `ci.yml`, the Bun/Deno job in `ci.yml` and the release job
in `release.yml`. The copies drifted: the release copy lacked the Redis
service and upgraded npm to a different major, so Release went red on `main`
while CI was green on the same commit (PR #38). Bun and Deno ran as
best-effort legs (issue #32) with a bash for-loop and a 30-line attribution
report embedded in YAML. The developer Node version was written nowhere; the
contract suite's need for a live Redis was visible only as `ECONNREFUSED`.

## Decision

1. **One verification module.** `.github/workflows/verify.yml` is a
   `workflow_call` workflow and the only place the verification recipe
   exists. `pr.yml` (on `pull_request`) calls it; `release.yml` (on push to
   `main`) calls it and runs the changesets job behind `needs: verify`. The
   release job itself verifies nothing. `release.yml` keeps its file name
   because npm trusted publishing is keyed on it. `main` is verified exactly
   once per push, by `release.yml`.
2. **Two jobs inside verify, with distinct questions.** The `dev` job is the
   contributor's laptop in CI: the Node version from `mise.toml`, running
   typecheck, schema check, build and `npm test`. It answers "does `npm test`
   pass on the dev Node, without Docker?". The `runtime` matrix (Node 22, 24,
   26, Bun, Deno) builds, then runs the runtime suite through `npm run
   test:runtime -- <vitest command>`. It answers "can an app on this runtime
   use what we ship?".
   *Edited 2026-10-17 (issue #44).* Originally the `runtime` legs ran the
   whole vitest suite against source, with a Redis service and
   `REDIS_REQUIRED=1`, the session canary first and an attribution report.
   That proved vitest runs on Bun and Deno; it never proved a Bun app can use
   `dist/`, and the fast specs ran twice. Now the two suites each have one
   home and one command: `npm test` is unit + integration on the dev Node
   with zero skips, and `test:runtime` runs only `runtime-tests/*`, small
   consumer apps that resolve the built `dist/` through the workspace links
   (no vitest alias) and drive the app over real HTTP. The session-layer
   scenarios sit under a describe named for the seam, which replaces the
   attribution report.
3. **Every runtime is blocking.** Bun and Deno are promoted from best-effort
   to supported; `continue-on-error` is gone. A red leg is fixed at the
   session seam (`packages/core/src/session/`) or the runtime is dropped from
   the matrix and the docs. The engine is never patched to chase a runtime.
   This reverses the best-effort rule of issue #32, which existed only until
   the legs were green.
4. **`mise.toml` is the single runtime pin.** It pins the dev Node by major
   line and Bun and Deno exactly; a composite `.github/actions/setup` action installs
   them with `mise-action`, restores the npm cache and runs `npm ci`, and
   every job uses it. Matrix Node legs select their version per command with
   `mise x node@<v>`. Floating `latest` runtime versions are gone, because a
   floating version plus a blocking leg is a red `main` with no commit.
5. **No real Redis anywhere.**
   *Edited 2026-10-17 (issue #44).* This item originally kept a Redis
   service in the runtime matrix for the contract suite
   (`packages/nestjs/test/contract/`), which skipped itself without one and
   failed under `REDIS_REQUIRED=1`. That suite is gone. Its scenarios that
   need no topic prefix (ownership and single execution, the owner lease,
   `Last-Event-ID` replay, serialization, `enabled`) run in
   `packages/nestjs/test/` on the in-memory transport, NestJS instances
   only; prefix isolation is a unit spec in `packages/redis` with two
   transports over one `ioredis-mock` server. The cross-framework spec went
   with it: both framework packages sit on the same engine and shared
   handler layer and the Express router suite mirrors the controller spec,
   so wire compatibility is proven by construction. No workflow starts a
   Redis service and nothing in `npm test` skips.

## Considered options

- A single workflow file with a `release` job gated by `needs`. Rejected:
  trusted publishing is keyed on `release.yml`.
- The runtime runner as the root `npm test`. Rejected: verifying the product
  on the developer's Node and probing a runtime for parity are different
  modules; `npm test` stays the plain npm-workspaces delegate.
- Static-only `dev` job to avoid the overlap. Rejected: nothing would then
  prove the no-Redis `npm test` path. *Edited 2026-10-17 (issue #44): the
  overlap itself is gone; `dev` is the only job that runs the package specs,
  and it still runs `npm test` in full.*

## Consequences

- Adding a step or a service to verification is one edit in `verify.yml`.
- A Bun or Deno regression blocks PRs and releases until fixed or dropped.
- Runtime versions go stale until someone bumps `mise.toml`; that is the
  accepted price of a stable `main`.
- Billed CI minutes grow by about one job per PR for the `dev` job. *Edited
  2026-10-17 (issue #44): the runtime legs now run only the small consumer
  apps, so the overlap that doubled the package specs is gone.*
- `engines` is bumped to `>=22` in a separate minor release; Node 20 was
  never tested and is end of life.
