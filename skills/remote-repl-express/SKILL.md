---
name: remote-repl-express
description: Use when an Express app exposes a live REPL via @remote-repl/express: mounting createRemoteRepl(), choosing the context the sessions see next to `app`, gating it with an env flag, starting and stopping it, running replicas over Redis, or driving the POST/SSE routes to inspect the running app.
---

# remote-repl-express

## Overview

`@remote-repl/express` exposes a live Node.js REPL running inside an Express
app over HTTP: a POST command endpoint, a Server-Sent Events output stream, and
a Monaco browser UI. It is the Express package over the framework-free engine
in `@remote-repl/core`; the NestJS package (`@remote-repl/nestjs`) speaks the
same protocol, so a NestJS replica and an Express replica can share one Redis.
Full reference (options, exports, securing it): the repository README,
https://github.com/p-dim-popov/remote-repl#readme.

One call sets it up:

| Export                                   | Purpose                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `createRemoteRepl({ enabled, …engine options, context \| buildContext, transport?, logger?, autoStart? })` | Builds the engine, starts it, and returns an Express `Router` with the five routes, plus `ready`, `start()`, `close()` and `engine`. Every session sees `app`, the Express app that mounts it. `transport` defaults to in-memory. |

The lower-level pair it is built on, `createRemoteReplEngine` and
`createRemoteReplRouter`, stays available (see "When you need more").

## Security first — read before wiring

The endpoints execute arbitrary code inside the running process **by design**.
The library ships **no authentication** (intentional). Before mounting the
router:

- Gate it behind an environment flag so it is OFF by default:
  `const enabled = process.env.REPL_ENABLED === 'true'`, and pass it to
  `createRemoteRepl` as `enabled`. The engine and the routes both read that
  one flag; there is no second flag to keep in step.
- Enable it in production only behind your own authentication or network
  restriction in front of the routes. Put your auth middleware **before** the
  router in the same `app.use(path, auth, repl)` call.
- A disabled REPL never subscribes to the transport (the start is a no-op)
  and 404s every route, before any other answer. Keep it that way.

## Wire it up

```ts
import express from 'express';
import { createRemoteRepl } from '@remote-repl/express';

const enabled = process.env.REPL_ENABLED === 'true';

const app = express();
const repl = createRemoteRepl({
  enabled,
  // no `transport`: the in-memory default, correct for one process; see Redis below
  context: { db, userService }, // the context every session sees, next to `app`
});
app.use('/repl', requireAdmin, repl);
//          ^ mount path = base path  ^ your auth middleware, in front
await repl.ready; // optional: make a failed start fail the boot

const server = app.listen(3000);
process.once('SIGTERM', async () => {
  await repl.close(); // first: it ends the open SSE streams that server.close() waits for
  server.close();
});
```

Key points:

- **Mount path is the base path.** `app.use('/repl', repl)` gives
  `/repl`, `/repl/:channel`, `/repl/:channel/ui`, `/repl/:channel/vs/*`. The
  landing redirect uses `req.originalUrl`, so nested mounts and prefixes work.
- **Context.** Every session sees `app`: the Express app that mounts the
  router (`req.app`; a sub-app when you mount it in one). Next to it, pass
  `context: { ... }` (a plain object; each session gets a shallow copy) or
  `buildContext: ({ app }) => ({ ... })` (a synchronous function called once
  per session with the app, returning a plain object; it cannot return a
  Promise), or neither. A key you pass wins over the injected `app`. These
  names are the whole REPL vocabulary of your app (see "Use it"). Mount one
  `repl` once: `app` is the app of the latest request through it.
- **Start.** The engine starts when `createRemoteRepl()` is called. `ready`
  resolves when the start completes and rejects when it fails (the Redis client
  cannot subscribe); the failure is logged either way, and it never crashes
  the app. To
  start it from your own lifecycle, for example after your node-redis client
  connects, pass `autoStart: false` and call `await repl.start()`. It never
  starts on the first request.
- **Before the start completes**, requests to a disabled REPL get 404 (always
  first), requests during a start wait for it, requests before
  `start()` with `autoStart: false` get 503 `remote-repl is not started`, and
  requests after a failed start get 503 `remote-repl failed to start`.
- **Stop.** `await repl.close()` on shutdown, before `server.close()`.
- **`enabled` is one flag.** The engine enforces it (rejects dispatch, refuses
  streams); the routes enforce it again at the HTTP edge (404 on every route).
- Works on Express 4.16+ and Express 5 (peer range `^4.16 || ^5`).

Done when `REPL_ENABLED=true` makes `GET /repl` answer 302 behind your auth
and, without the flag, every `/repl/*` route answers 404.

## Use it

### Decide whether the REPL is the right tool

A session runs inside the live process: the real config, the real database
connections, the real service instances you put in `context`. Reach for it
when a fresh test process cannot answer the question:

- Inspect live state: what a service holds right now, not what a unit test
  constructs.
- Call a service method with the real wiring: `catService.findAll()` runs the
  actual instance against its actual dependencies.
- Reproduce a bug on the exact object and inputs that failed, one call at a
  time, and watch the value at each step.
- Run a one-off data fix under supervision, with a human reading the stream.

Leave it alone when:

- the command is destructive and nobody is watching the stream: an object
  mutated from the REPL is mutated in the running app, with no undo;
- the target is production without authentication in front (see "Security
  first");
- the work is a long-running loop or a job: a 30 s watchdog cuts each command
  off (`Error: eval timed out`, then `done`), and an idle channel is released
  after `sessionTtl` (default 30 min), dropping its variables. Start the job
  from the app and poll it from the REPL instead.

### Drive it from a shell

Two routes under the mount path, both keyed by a channel name (any path
segment; pick one per task). Both pass through your auth middleware, so send
its credential on every request (the examples use the package example's
bearer token).

- `POST /repl/{channel}` with `{"command":"<source>"}` answers
  `202 {"accepted":true,"commandId":"cmd_…"}` and nothing else: results
  arrive on the stream.
- `GET /repl/{channel}` is a Server-Sent Events stream of the channel's
  events, replaying its recent history (200 events) on connect.

1. Open the stream to a file, then post the command:

   ```bash
   BASE=http://localhost:3000/repl/dev          # channel "dev"
   AUTH='authorization: Bearer dev-token'
   curl -sN -H "$AUTH" "$BASE" > out.sse & SSE=$!
   ID=$(curl -s -X POST -H "$AUTH" "$BASE" -H 'content-type: application/json' \
          -d '{"command":"catService.findAll()"}' | sed -E 's/.*"commandId":"([^"]+)".*/\1/')
   ```

   Done when `$ID` holds a `cmd_…` id. A 401 is your auth middleware; a 400
   means the command was not a non-empty string; a 404 means the REPL is
   disabled.

2. Wait for the command's `done` event, stop the stream, read the command's
   events:

   ```bash
   until grep -q "\"commandId\":\"$ID\".*\"done\":true" out.sse; do sleep 0.2; done
   kill $SSE; grep "\"commandId\":\"$ID\"" out.sse
   ```

   Done when the last line is a `system` event with `{"done":true}` and your
   command id. Observed for the command above:

   ```
   data: {"id":1,"type":"command","commandId":"cmd_1_exfm","data":{"command":"catService.findAll()","instanceId":"inst_qn16gbml"}}
   data: {"id":2,"type":"output","commandId":"cmd_1_exfm","data":"[ 'Tom', 'Felix' ]\n"}
   data: {"id":3,"type":"system","commandId":"cmd_1_exfm","data":{"done":true}}
   ```

3. Post the next command on the same channel to keep its variables, or on a
   new channel name for a clean slate. Commands on one channel run one after
   another, in post order.

4. If the stream dropped, reconnect with `-H 'Last-Event-ID: <the last id:
   line you saw>'`: the server replays only the events with a higher id.
   Done when the first replayed `id:` is your cursor + 1.

Filter by command id, never by position: the replay carries events of
earlier commands too. Kill the stream curl yourself, as above; a dangling
`curl -N | grep` exits only on the next keep-alive ping (15 s).

The browser UI at `/repl/{channel}/ui` drives the same two routes from a
Monaco editor; use it when a human is pairing with you. It sends no header of
its own, so your auth must also accept browser requests (a cookie/session, or
a query token as in the package example: `/repl/dev/ui?token=dev-token`).

### Events

Each SSE frame's `data` line is one JSON event `{ id, type, commandId, data }`:

| `type`    | `data`                   | Meaning                                                                                      |
| --------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| `command` | `{command, instanceId}`  | the owner instance started executing your command                                            |
| `output`  | string                   | one chunk of REPL output, verbatim: result rendering and `console.*` lines alike              |
| `system`  | `{"done":true}`          | your command finished; always the last event for a command id                                |
| `system`  | `{"error":"…"}`          | the command could not run at all (e.g. `buildContext` threw); the channel stays usable        |
| `system`  | `{"ping":true}`          | keep-alive, `commandId: null`; ignore                                                        |

An exception thrown by your code is not an `error` event: it arrives as
`output` text (`Uncaught ReferenceError: nope is not defined\n`), then `done`.

### Vocabulary

A session is a plain `node:repl` whose globals are `app` (the Express app
that mounts the REPL), the keys of the `context` the app passed (or of the
object `buildContext` returned), and Node's own globals. There is no DI
container and there are no helpers: `get`, `debug`, `methods` and `help` do
not exist unless the app put them in the context (`typeof get` →
`'undefined'`). Against the package example, whose context is
`{ catService }`:

| Command                                                   | Observed output                                                      | Use for                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------- |
| `Object.keys(globalThis).filter((k) => !k.startsWith("_"))` | `[ 'global', 'clearImmediate', …, 'sessionStorage', 'app', 'catService' ]` | discover what the app exposed: `app` and the context keys come last |
| `catService.findAll()`                                    | `[ 'Tom', 'Felix' ]`                                                 | call a service method                     |
| `catService`                                              | `CatService { cats: [ 'Tom', 'Felix' ] }`                            | inspect a service's fields                |
| `Object.getOwnPropertyNames(Object.getPrototypeOf(catService))` | `[ 'constructor', 'findAll' ]`                               | list a service's methods                  |
| `app.get('env')`                                          | `'development'`                                                      | read an Express setting (`app.locals` holds what the app stored there) |

`app` is the live app: `app.get('/x', handler)` registers a route at runtime,
and the expression's value prints the whole app object. To call one of your
own routes, use `await fetch('http://localhost:3000/…')` from the session.
To expose more, add keys to `context` (`{ catService, db, config }`) or
return them from `buildContext`; a session sees exactly those names and
`app`.

### State between commands

A channel is one session: variables, functions and object mutations persist
between commands until the channel is released. Verified sequence on one
channel:

| Command                                                                            | Observed output                                                                       |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `const cats = catService.findAll()`                                                | none: a declaration has no value                                                      |
| `cats.length`                                                                      | `2`                                                                                   |
| `for (const c of cats) console.log(c)`                                             | `Tom`, then `Felix`: one `output` event per line                                      |
| `function shout(name) {\n  return name.toUpperCase() + '!';\n}\nshout(cats[0])`    | `'TOM!'`: a block is ONE command with embedded newlines                                |
| `await new Promise((r) => setTimeout(() => r(cats.map((c) => c.length)), 100))`   | `[ 3, 5 ]`: top-level `await` works                                                   |
| `typeof cats` on another channel                                                   | `'undefined'`: each channel is its own session                                        |

`context` values are shared by reference across sessions (each session gets a
shallow copy of the object, not of its values), so a mutation through
`catService` is visible to the app and to every other channel. A POST that
ends inside an open brace is rejected with `SyntaxError: incomplete input`
and the session moves on: send the whole block in one command.

### Reading output

The REPL prints an expression's value the way node's REPL does
(`util.inspect`: strings quoted, objects expanded) as one `output` chunk
ending in `\n`; `console.log` lines arrive as their own `output` events, in
order. A statement or declaration whose value is `undefined` prints nothing,
so `done` follows `command` directly. That is success, not a lost result.

## When you need more

- **Multiple app instances** (load-balanced replicas): the in-memory transport
  is per-process. Install `@remote-repl/redis` and pass
  `transport: new RemoteReplIoRedisTransport(client)` (ioredis) or
  `new RemoteReplNodeRedisTransport(client)` (node-redis) to `createRemoteRepl`.
  Hand it one connected client; it owns its own subscriber connection.
  `ioredis` / `redis` are optional peers: install the one you use. A command
  runs on the instance that owns its channel, so `app` in a session is the
  app of that instance (its `app.locals`, not those of the instance that
  answered your last request).
- **Two apps on one Redis:** the topics have no origin check, so unrelated apps
  sharing a Redis would exchange REPL output and ownership. Give each app's
  transport its own topic `prefix` (second constructor argument):
  `new RemoteReplIoRedisTransport(client, { prefix: 'billing-api:' })`. Replicas of
  one app share one prefix; apps with different prefixes never see each
  other.
- **Options** (`instanceId`, `sessionTtl`, `replayBufferSize`,
  `heartbeatInterval`, `ownerHeartbeatInterval`, `ownerLeaseTtl`) are the
  engine's `RemoteReplOptions` from `@remote-repl/core`; pass them to
  `createRemoteRepl` next to `enabled`. See "Options" in the README.
- **Logging:** `logger` (an object with `warn` and `error`) on
  `createRemoteRepl`; defaults to `console`.
- **Full control:** `createRemoteRepl` is built on two lower-level calls.
  `createRemoteReplEngine({ options, context | buildContext, transport?, logger? })`
  builds the engine, and you own its `engine.start()` and `engine.stop()`;
  `createRemoteReplRouter({ engine })` returns the router for it. Use them to
  share one engine between routers. They do not add `app` to the context.
- **Runnable example:** `packages/express/example/main.ts` in the repository
  (`npm run build`, then `REPL_ENABLED=true npm run example:express`; demo
  bearer token `REPL_TOKEN`, default `dev-token`; context `{ catService }`).

## Habits that keep it safe

- Key `enabled` off an environment flag that defaults to off.
- Mount auth middleware in front of the router in the same `app.use` call;
  the library has none.
- `await repl.ready` at boot when a REPL that failed to start must fail the
  boot; `await repl.close()` on shutdown, before `server.close()`, so the SSE
  streams end, the transport subscription closes and the process exits.
- Give each app on a shared Redis its own `prefix`; replicas of one app share
  one.
