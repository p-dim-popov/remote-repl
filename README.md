# remote-repl

Expose a live, in-process REPL over HTTP. The packages in this repository give
you a command endpoint, a Server-Sent-Events output stream, and a Monaco-based
browser UI, backed by a real `node:repl` session that runs inside your app. In
NestJS, the session is connected to the DI container, in the same way as
`nest start --entrypoint repl`. The helpers `get(SomeService)`, `resolve(...)`,
`select(...)`, and the others work as they do in the local REPL. In Express, the
session sees the context object that you pass in. In both cases, you reach the
REPL over HTTP, against a running server.

This repository was `nestjs-web-repl`. That package name still works: it is now
a thin shim over the `@remote-repl` packages. See [Packages](#packages).

> ## ⚠️ Security
>
> These packages run code inside your app with the full privileges of the Node
> process. They ship no authentication. `enabled` is an on/off switch, not a
> lock. Gate `enabled` behind an environment variable and put your own guard or
> middleware in front of the routes. When `enabled` is `false`, every route
> returns 404 and the engine never subscribes to the transport. See
> [Securing it](#securing-it).

## Packages

| Package               | What it is                                                                                                        | Install                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `@remote-repl/core`   | The engine, the protocol types, the in-memory transport, the browser UI (the per-request UI page plus the Monaco UI bundle) and the shared handler layer. No framework. | A dependency of the framework packages. Install it directly only to write a new one. |
| `@remote-repl/nestjs` | The NestJS package: `RemoteReplModule.register` / `registerAsync`, the controller, the DI-container context.          | `npm install @remote-repl/nestjs`                   |
| `@remote-repl/express`| The Express package: `createRemoteReplEngine` + `createRemoteReplRouter`. Mount the router, the mount path is the base path.  | `npm install @remote-repl/express`                   |
| `@remote-repl/redis`  | The Redis transports (`ioredis` and `node-redis`) for several instances, with an optional topic `prefix`.          | `npm install @remote-repl/redis` plus `ioredis` or `redis` |
| `nestjs-web-repl`     | The legacy name. A shim: the 2.3.x names as `@deprecated` aliases of `@remote-repl/nestjs`, and of `@remote-repl/redis` under `nestjs-web-repl/redis`. See [Migrating from nestjs-web-repl](#migrating-from-nestjs-web-repl). | `npm install nestjs-web-repl`                       |

All packages require Node 20+. The NestJS package requires NestJS 10 or 11. The
Express package requires Express 4.16+ or 5. The Redis clients are optional peer
dependencies: install the one that you use.

The short per-package READMEs are in [`packages/core/README.md`](./packages/core/README.md),
[`packages/nestjs/README.md`](./packages/nestjs/README.md),
[`packages/express/README.md`](./packages/express/README.md),
[`packages/redis/README.md`](./packages/redis/README.md) and
[`packages/nestjs-web-repl/README.md`](./packages/nestjs-web-repl/README.md).
This file is the full documentation.

> **Upgrading from `nestjs-web-repl` 1.x?** The `forRoot`/`forRootAsync` API is
> deprecated. v2 uses `register`/`registerAsync`. See [Quick start](#quick-start)
> and [Securing it](#securing-it). Upgrading from 2.x needs no code change: the
> shim re-exports the same API.

## Live demo

You can try the REPL without an install. The link below opens a full NestJS app
that runs the REPL in a StackBlitz sandbox. The editor and the app run in your
browser. Nothing touches a shared server.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/p-dim-popov/remote-repl/tree/main/examples/stackblitz)

The first boot takes about 30–60 seconds for the dependency install and startup.
After that, the REPL is live. The [demo project](./examples/stackblitz) and its
[command cheatsheet](./examples/stackblitz/TRY-THESE.md) are in
`examples/stackblitz/`.

## Quick start

### NestJS

```ts
import { Module } from '@nestjs/common';
import { RemoteReplModule } from '@remote-repl/nestjs'; // or 'nestjs-web-repl'

@Module({
  imports: [
    RemoteReplModule.register({
      enabled: process.env.REPL_ENABLED === 'true',
    }),
  ],
})
export class AppModule {}
```

Start the app with `REPL_ENABLED=true` and open `http://localhost:3000/repl/dev/ui`.
Here `dev` is a channel name. See [Endpoints](#endpoints). Type a command and press
`Ctrl+Enter`. The REPL context is app-wide. `get(SomeProviderFromAnyModule)`
resolves from the whole DI container, not only from the module that imports
`RemoteReplModule`.

Pick one package name per app. `@remote-repl/nestjs` and `nestjs-web-repl`
export the same objects, but two installs can resolve to two copies.

A runnable example is in [`packages/nestjs/example/`](./packages/nestjs/example).
`packages/nestjs/example/cat.service.ts` registers a small `CatService`.
`packages/nestjs/example/app.module.ts` calls `RemoteReplModule.register(...)`.
`packages/nestjs/example/main.ts` starts the app. From a checkout of this repo,
build first, then run:

```bash
npm run build
REPL_ENABLED=true PORT=3000 npm run example
```

> Use `ts-node` to run the TypeScript sources directly. Do not use `tsx` or other
> esbuild-based runners. Nest DI reads constructor parameter types from
> `emitDecoratorMetadata` output. Esbuild-based transpilers do not emit that output
> in the same way as `tsc` and `ts-node`, so provider injection fails at runtime.

Then, in the UI or with `curl` (see below), run:

```ts
get(CatService).findAll()
// -> [ 'Tom', 'Felix' ]
```

### Express

```ts
import express from 'express';
import { createRemoteReplEngine, createRemoteReplRouter } from '@remote-repl/express';

const enabled = process.env.REPL_ENABLED === 'true';

const engine = createRemoteReplEngine({
  options: { enabled },
  // no `transport`: the in-memory default, for one process; see Redis below
  context: { catService },                 // the globals every session sees
});
await engine.start(); // no-op when disabled

const app = express();
app.use('/repl', requireAdmin, createRemoteReplRouter({ engine }));
//          ^ mount path = base path      ^ your auth middleware, in front

const server = app.listen(3000);
process.once('SIGTERM', () => {
  server.close();
  void engine.stop();
});
```

Four rules apply:

- **The mount path is the base path.** `app.use('/repl', router)` gives
  `/repl`, `/repl/:channel`, `/repl/:channel/ui` and `/repl/:channel/vs/*`.
  There is no separate base-path option. Nested mounts work, because the
  landing redirect uses `req.originalUrl`.
- **`enabled` is set once, on the engine.** The engine enforces it (it rejects
  commands and refuses streams). The router reads `engine.enabled` and enforces
  it again at the HTTP edge (404 on every route). There is no second flag.
- **You own the lifecycle.** Call `await engine.start()` after construction and
  `await engine.stop()` on shutdown. Nothing starts on its own.
- **Context.** Pass `context: { ... }` (a plain object, each session gets a
  shallow copy) or `buildContext: () => ({ ... })` (a synchronous function,
  called once per session, returning a plain object). Pass exactly one of the
  two.

A runnable example is in [`packages/express/example/main.ts`](./packages/express/example/main.ts).
It puts a demo bearer-token middleware in front of the router (`REPL_TOKEN`,
default `dev-token`, as `Authorization: Bearer …` or `?token=`). From a checkout
of this repo, build first, then run:

```bash
npm run build
REPL_ENABLED=true PORT=3000 npm run example:express
# then open http://localhost:3000/repl/dev/ui?token=dev-token
```

## Endpoints

Both transports register the same five routes. Every endpoint except the bare
`/repl` redirect has a `:channel` path segment. A channel is a string that you
choose, for example `dev`, `prod-debug`, or your username. Each channel gets its
own REPL session with its own variables and its own history. Channels are how
multiple people or tabs share or separate REPL state.

- **`GET /repl`** — no channel. The server generates a random 8-character channel
  name and redirects (`302`) to the UI of that channel. The name is not a secret.
  It only keeps two visitors from a collision by default. Your guard is the only
  access control.
- **`POST /repl/:channel`** — body `{ "command": "get(CatService).findAll()" }`.
  The server dispatches the command and returns at once:
  `202 { "accepted": true, "commandId": "cmd_..." }`. A body without a string
  `command` returns `400`. The result arrives later over the SSE stream below.
- **`GET /repl/:channel`** — a Server-Sent-Events stream of the activity on that
  channel. It supports `Last-Event-ID` for replay. A bounded ring buffer (default
  200 events) backs each channel, so a client that reconnects does not miss output.
  Each SSE message is JSON with `{ id, type, commandId, data }`. `type` is one of:
  - **`command`** — echoes a dispatched command. `data` is
    `{ command, instanceId }`, where `instanceId` is the instance that will run it.
  - **`output`** — a chunk of REPL output. **`data` is the raw output string**, not
    `{ chunk: ... }`. It is the exact text that `node:repl` wrote, which includes
    `console.log` output and the inspected return value.
  - **`system`** — control and status notices. `data` has one of these shapes:
    - `{ ping: true }` — a heartbeat with `id: 0`, sent every `heartbeatInterval`
      (default 15 s) to keep the connection alive. The buffer does not keep it for
      replay, and it never moves the replay cursor of the client.
    - `{ done: true }` — sent once after the output of a command ends. Silent
      statements such as `const v = 10` produce no `output` events. This event is
      then the only signal that the command has finished.
    - `{ error: string }` — a command did not execute, for example because the
      REPL context factory threw. The channel stays usable after this.
- **`GET /repl/:channel/ui`** — an HTML page with an output pane fed by the SSE
  stream above, plus a Monaco editor to write and send commands. `Ctrl+Enter` or
  the Run button posts to the endpoint above.
- **`GET /repl/:channel/vs/*`** — the files of the Monaco editor. The core package
  bundles them and your app serves them, so the browser needs no internet access.
  The UI page loads the editor from this path. A proxy or path allowlist in front
  of the app must let this path through, or the editor does not load.

### Try it with curl

```bash
# stream (leave running in one terminal)
curl -N http://localhost:3000/repl/dev

# in another terminal, dispatch a command
curl -X POST http://localhost:3000/repl/dev \
  -H 'content-type: application/json' \
  -d '{"command":"get(CatService).findAll()"}'
```

## Securing it

No package ships auth. `enabled` keeps the REPL off until you turn it on. It is
not an access control. Put your own guard in front of the routes.

### NestJS

The supported way to lock it down is to subclass the built-in controller, add
your own guard, and pass the subclass through the `controller` extra:

```ts
import { Controller, UseGuards } from '@nestjs/common';
import { RemoteReplController } from '@remote-repl/nestjs';
import { AdminGuard } from './admin.guard';

@Controller('internal/repl')
@UseGuards(AdminGuard)
class SecureReplController extends RemoteReplController {}
```

```ts
@Module({
  imports: [
    RemoteReplModule.register({
      enabled: process.env.REPL_ENABLED === 'true',
      controller: SecureReplController, // replaces the unguarded default controller
    }),
  ],
})
export class AppModule {}
```

`controller` is available in both `register` and `registerAsync`. It is a static
choice made at module definition time, so you pass it next to
`useFactory`/`inject`, not inside the factory result:

```ts
RemoteReplModule.registerAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    enabled: config.get('REPL_ENABLED') === 'true',
  }),
  controller: SecureReplController,
});
```

### Express

Put your middleware before the router in the same `app.use` call:

```ts
app.use('/repl', requireAdmin, createRemoteReplRouter({ engine }));
```

The middleware runs in front of every route: the UI page, the SSE stream, the
command POST, the Monaco assets, and the redirect.

### How the browser UI authenticates

Your guard runs in front of every route. The UI page sends only what a browser
attaches on its own to a **same-origin** request. That is **cookies**, and
**HTTP auth credentials** from a `WWW-Authenticate` challenge. It sets no
`Authorization` header of its own. The SSE stream uses `EventSource`, which cannot
send custom headers. This leaves three protections that work:

- **Cookie/session auth.** The UI is served from the same origin that it calls.
  A session cookie therefore rides along on the page load, the SSE connection,
  and every command. One caveat: the UI sends no CSRF token. Authenticate from
  the session itself and do not require a CSRF token on these routes.
- **HTTP Basic auth.** Make the guard respond `401` with a
  `WWW-Authenticate: Basic realm="repl"` header. The browser asks for credentials
  once, then attaches `Authorization: Basic ...` to every later request, which
  includes the `EventSource` connection. In Nest, set that header on the response
  explicitly. `UnauthorizedException` alone does not send it, and without it the
  browser never asks.
- **A network-level control.** An IP allowlist, mTLS, or a VPN.

A bearer-token guard rejects the UI, because the browser cannot produce the token.
It still works for direct `curl` clients, where you set the header yourself. The
Express example accepts the token in a `?token=` query parameter as well, which
is a demo convenience, not a recommendation.

## Transport / multi-instance

If you run more than one instance of your app (multiple processes, pods, and so
on), each instance would get its own in-memory REPL. A command from one browser
tab can then land on one instance, while another instance holds the variables of
your session. The engine solves this with an **ownership + fan-out** protocol:

- The **first instance** to see a command for a channel claims ownership of that
  channel. It broadcasts an internal `claim` message on the `remote-repl:sys`
  transport topic. This is not a client-visible SSE event (see
  [Endpoints](#endpoints)). From then on, only the owner runs commands on that
  channel.
- Every instance still receives and shows the `output` events of that channel
  through fan-out. Any tab that watches the SSE stream of that channel sees the
  same output, no matter which instance it is connected to.
- The ownership of a channel is released after `sessionTtl` (default 30 minutes)
  without activity. The next instance that receives a command for it can then
  claim it.
- Ownership is also a **lease**. The owner re-announces `claim` for every channel
  it owns every `ownerHeartbeatInterval` (default 10 s). If the owner of a channel
  sends no claim or heartbeat within `ownerLeaseTtl` (default 30 s), the channel
  counts as ownerless. A crash of that instance is one cause. The origin instance
  of the next command for it takes over. The engine enforces
  `ownerLeaseTtl >= ownerHeartbeatInterval * 2` and clamps the value up with a
  warning if it is lower. A live owner therefore always has a full heartbeat
  interval of slack against publish or delivery jitter, and is never preempted
  this way. A takeover loses the in-memory variables of that channel, because the
  session of the dead owner is gone. It restores availability instead of a
  channel that is stuck cluster-wide (see [Limitations](#limitations)).
- Ownership goes to the instance whose command handler runs first. If two
  instances race to claim the same new channel at the same instant, the result is
  **last-claim-wins** (see [Limitations](#limitations)).

The protocol is framework-agnostic. A NestJS instance and an Express instance
can share one transport and one set of channels: both packages sit on the same
engine and the same shared handler layer, and the Express router suite mirrors
the NestJS controller spec. The multi-instance scenarios in
`packages/nestjs/test/` pin ownership, the lease, replay and serialization on
the in-memory transport; the Redis transports' prefix semantics are pinned in
`packages/redis`.

When you give no transport, the engine uses `RemoteReplInMemoryTransport`. The
`RemoteReplEngine` constructor, `createRemoteReplEngine` and
`RemoteReplModule.register` all apply this default. It works inside one process
only: a cluster of instances needs the Redis transport from `@remote-repl/redis`.
In NestJS, use the `transport` extra. Pass a ready instance, `{ useClass, imports }`, or
`{ useFactory, inject, imports }`. All three forms are DI-capable, so the
transport can depend on other providers. In Express, pass it as `transport` to
`createRemoteReplEngine`. A transport implements:

```ts
export interface RemoteReplTransport {
  publish(topic: string, message: string): Promise<void>;
  subscribe(topic: string, handler: (message: string) => void): Promise<void>;
  close?(): void | Promise<void>;
}
```

`message` is always a JSON string that the engine has already serialized. Your
transport only moves opaque strings. It does not parse them. The engine uses
three fixed topics: `remote-repl:cmd`, `remote-repl:out`, `remote-repl:sys`. The
`remote-repl:sys` topic carries internal `claim`/`release` ownership messages
between instances. The engine never forwards them to SSE clients. Do not confuse
them with the client-visible `system` *SSE event type* under
[Endpoints](#endpoints), which only carries `{ping}`, `{done}`, or `{error}`.

### Redis (multi-instance)

Behind a load balancer, the default in-memory transport is per-process. A
command posted to one replica never reaches a session that another replica
owns. Supply a Redis transport so that every replica shares one pub/sub bus.
Import it from `@remote-repl/redis` (or the `nestjs-web-repl/redis` subpath of
the shim) and give it one connected client. The transport creates its own
subscriber connection, because Redis requires a dedicated connection for
subscribe mode. On shutdown, it closes only that connection. Your client stays
yours.

**ioredis (NestJS):**

```ts
import Redis from 'ioredis';
import { RemoteReplModule } from '@remote-repl/nestjs';
import { RemoteReplIoRedisTransport } from '@remote-repl/redis';

RemoteReplModule.register({
  enabled: process.env.REPL_ENABLED === 'true',
  transport: new RemoteReplIoRedisTransport(new Redis(process.env.REDIS_URL!)),
});
```

**node-redis (NestJS):**

```ts
import { createClient } from 'redis';
import { RemoteReplModule } from '@remote-repl/nestjs';
import { RemoteReplNodeRedisTransport } from '@remote-repl/redis';

RemoteReplModule.register({
  enabled: process.env.REPL_ENABLED === 'true',
  transport: {
    useFactory: async () => {
      const client = createClient({ url: process.env.REDIS_URL });
      await client.connect();
      return new RemoteReplNodeRedisTransport(client);
    },
  },
});
```

**Express:**

```ts
const engine = createRemoteReplEngine({
  options: { enabled },
  transport: new RemoteReplIoRedisTransport(new Redis(process.env.REDIS_URL!)),
  context: { catService },
});
```

**Two apps on one Redis.** The topics have no origin check, so two different
apps that share one Redis exchange REPL output and ownership. Give each app's
transport its own topic `prefix`. The transport prepends it verbatim to every
topic name on the wire (`billing-api:remote-repl:out`) and strips it again before
the engine sees the message, so the engine stays unaware of prefixes. Replicas
of one app must use the same prefix: apps with the same prefix behave as
replicas, apps with different prefixes never see each other. The default is no
prefix, which keeps the current topic names byte for byte.

```ts
new RemoteReplIoRedisTransport(client, { prefix: 'billing-api:' });
new RemoteReplNodeRedisTransport(client, { prefix: 'billing-api:' });
```

**Logging.** A handler that throws on an inbound message (for example malformed
JSON on a shared channel) never crashes the client or skips the other handlers.
The transport reports it. By default it reports through `console.error`. Pass a
`logger` with `warn` and `error` methods to route it elsewhere, for example a
Nest `Logger`:

```ts
new RemoteReplIoRedisTransport(client, { prefix: 'billing-api:', logger: new Logger('RemoteRepl') });
```

`ioredis` and `redis` are optional peer dependencies of `@remote-repl/redis`.
Install the one that you use. Both transports extend a small shared base. To
target another broker, subclass `RemoteReplBaseRedisTransport` or implement
`RemoteReplTransport` directly.

## Protocol

The wire protocol is a versioned, language-neutral specification in
[`packages/core/PROTOCOL.md`](./packages/core/PROTOCOL.md). It defines the
transport contract, the three topics and the prefix convention, the message
shapes, the ownership and lease rules, and the SSE event format. The JSON Schema
in `packages/core/schema/protocol.schema.json` is generated from the TypeScript
types, and CI fails when the two diverge. An implementation in another language
that follows the spec can join a cluster and serve the same browser UI: the
Monaco asset tree (the UI bundle) as is, plus a port of the small per-request
UI page template and its escaping rules (spec §7).

The spec version is documentation only. Messages carry no version field, and
there is no handshake. Mixed-version clusters are not a supported scenario:
upgrade every instance of a cluster to the same package version. See
[`docs/adr/`](./docs/adr) for the reasoning behind this and the other
hard-to-reverse decisions.

## Options

The engine options are the same for every transport. In NestJS, pass them to
`register`/`registerAsync`. In Express, pass them as `options` to
`createRemoteReplEngine`.

| Option              | Type             | Default                    | Notes                                              |
| ------------------- | ---------------- | --------------------------- | --------------------------------------------------- |
| `enabled`           | `boolean`        | *(required)*                | When `false`, the routes return 404 and the engine does not subscribe to the transport. |
| `instanceId`        | `string`         | random `inst_xxxxxxxx`      | Shown in `command` SSE events and in internal `remote-repl:sys` claim/release messages. |
| `sessionTtl`        | `number` (ms)    | `1_800_000` (30 min)        | Idle time before the engine releases the ownership of a channel. |
| `replayBufferSize`  | `number`         | `200`                       | Events kept per channel for SSE `Last-Event-ID` replay. |
| `heartbeatInterval` | `number` (ms)    | `15_000`                    | Interval of the SSE `system` `{ ping: true }` event. |
| `ownerHeartbeatInterval` | `number` (ms) | `10_000`                | How often an instance re-announces `claim` for each channel it owns. This keeps its ownership lease alive. |
| `ownerLeaseTtl`     | `number` (ms)    | `30_000`                    | How long an ownership record stays valid after the last claim or heartbeat. After that, another instance can take over the channel. The minimum is `ownerHeartbeatInterval * 2`. If the value is lower, the engine clamps it up to that minimum and logs a warning. It never throws. |

`heartbeatInterval` and `ownerHeartbeatInterval` are independent knobs for
independent mechanisms. The first keeps a browser connection open. The second
keeps an ownership lease alive between instances.

### NestJS extras (`RemoteReplModuleOptions`)

`register`/`registerAsync` also accept two "extras". You pass them next to the
options above, or next to `useFactory`/`inject`/`imports` for the async form, not
inside them. Both are static choices made at module definition time:

| Extra        | Type                  | Default              | Notes                                              |
| ------------ | --------------------- | --------------------- | --------------------------------------------------- |
| `controller` | `Type<RemoteReplController>` | built-in `RemoteReplController` | Bring your own controller (subclass + guards). See [Securing it](#securing-it). |
| `transport`    | `RemoteReplTransport \| Type<RemoteReplTransport> \| { useClass, imports? } \| { useFactory, inject?, imports? }` | `RemoteReplInMemoryTransport` | Multi-instance coordination. See [Transport / multi-instance](#transport--multi-instance). |

`RemoteReplModule.registerAsync({ useFactory, inject, imports, controller?, transport? })`
is available for options that need DI, for example to read a `ConfigService`.

### Express factory (`createRemoteReplEngine`)

| Argument       | Type                              | Notes                                                     |
| -------------- | --------------------------------- | --------------------------------------------------------- |
| `options`      | `RemoteReplOptions`                  | The engine options above.                                 |
| `transport`    | `RemoteReplTransport` (optional)       | A Redis transport for a cluster. Default: `RemoteReplInMemoryTransport`. |
| `context`      | `object`                          | The globals of every session (shallow copy per session). Exactly one of `context` / `buildContext`. |
| `buildContext` | `() => object`                    | Called once per session, synchronously; returns the plain object that becomes the session's globals (no Promise). |
| `logger`       | `{ warn, error }`                 | Default `console`.                                        |

## Exports

Every export of the `@remote-repl` packages carries the product name: classes
and types `RemoteRepl*`, constants and DI tokens `REMOTE_REPL_*`, factories
`createRemoteRepl*` (see `docs/adr/0005-proper-names.md`).

**`@remote-repl/nestjs`**: `RemoteReplModule`, `RemoteReplController`,
`RemoteReplService`, and the DI tokens `REMOTE_REPL_OPTIONS` (the resolved
options), `REMOTE_REPL_TRANSPORT` and `REMOTE_REPL_CLOCK`. Use
`REMOTE_REPL_OPTIONS` to inject the options into a controller subclass that
you register next to the module. The package also re-exports
`RemoteReplInMemoryTransport` and the types `RemoteReplTransport`,
`RemoteReplEvent` and `RemoteReplSseEventType` from core, and exports its own
types `RemoteReplModuleOptions`, `RemoteReplModuleExtras` and
`RemoteReplTransportConfig`.

**`@remote-repl/express`**: `createRemoteReplEngine` and `createRemoteReplRouter`,
with the types `RemoteReplEngineOptions`, `RemoteReplRouterOptions` and
`RemoteReplRouterEngine`.

**`@remote-repl/redis`**: `RemoteReplIoRedisTransport`,
`RemoteReplNodeRedisTransport`, `RemoteReplBaseRedisTransport`, and the types
`RemoteReplRedisTransportOptions`, `RemoteReplRedisLogger`,
`RemoteReplIoRedisLike` and `RemoteReplNodeRedisLike`.

**`@remote-repl/core`**: `RemoteReplEngine`, `RemoteReplInMemoryTransport`,
`RemoteReplDisabledError`, `RemoteReplInvalidCommandError`,
`createRemoteReplHandlers`, `parseRemoteReplLastEventId`,
`REMOTE_REPL_SSE_RESPONSE_HEADERS`, `REMOTE_REPL_SSE_STREAM_PREAMBLE`,
`REMOTE_REPL_TOPICS` and `REMOTE_REPL_DEFAULTS`, plus the types
`RemoteReplOptions`, `RemoteReplTransport`, `RemoteReplSession`,
`RemoteReplHandlers`, `RemoteReplEvent` and the wire message types. The ring
buffer, the Node session implementation, the UI renderer and the Monaco asset
resolver are internal: the handlers reach them. You need core directly only to
write a new framework package or a new transport.

**`nestjs-web-repl`** (the shim): all of the above from `@remote-repl/nestjs`
and, under `nestjs-web-repl/redis`, from `@remote-repl/redis`, plus every
2.3.x name as a `@deprecated` alias. See the next section.

## Migrating from nestjs-web-repl

An app on `nestjs-web-repl` 2.3.x needs no code change to move to 2.4.0. Every
legacy name still resolves, and `WebReplModule.register({ adapter })` passes
the `adapter` extra on as `transport`. Your editor shows the replacement of
each deprecated name on hover.

To move to `@remote-repl/nestjs`, install it (and `@remote-repl/redis` if you
use a Redis transport) and rename the imports. The full old → new table is in
[`packages/nestjs-web-repl/README.md`](./packages/nestjs-web-repl/README.md).
The three renames that matter most:

| 2.3.x                        | 1.0.0                                         |
| ---------------------------- | --------------------------------------------- |
| `WebReplModule`              | `RemoteReplModule`                            |
| `register({ adapter })`      | `register({ transport })`, same values        |
| `IoRedisWebReplAdapter`      | `RemoteReplIoRedisTransport`                  |

**Wire change.** 2.4.0 and 1.0.0 speak the `remote-repl:*` topics. A 2.3.x
instance and a 2.4.0 instance on one Redis do not see each other. During a
rolling upgrade the two groups run as two clusters. When the last 2.3.x
instance stops, its leases expire and the cluster is whole again
(`PROTOCOL.md` §8.1).

## Runtime support

CI runs the full suite on Node 22, 24 and 26, on Bun and on Deno, and a red
run on any of them blocks a release. The exact Bun and Deno versions are pinned
in the repo's `mise.toml`. The declared minimum (`engines`) is still Node 20,
which CI does not run. The one file that depends on Node
internals is the `node:repl` session layer. The engine talks to it through a
session interface, so a runtime-specific session can replace it without engine
changes.

## AI skills

The repository ships [Claude Code](https://claude.com/claude-code) skills that
teach coding agents how to install the REPL safely and how to drive it: when a
live session beats a fresh test process, the POST + SSE pair read until the
`done` event, the REPL vocabulary, and how state persists per channel. They
live as plain files under `skills/` and install through the
[skills.sh](https://skills.sh) ecosystem; pick the one for your package:

```bash
# @remote-repl/nestjs (RemoteReplModule, transport, @remote-repl/redis)
npx skills add p-dim-popov/remote-repl/skills/remote-repl-nestjs

# nestjs-web-repl shim (legacy names: WebReplModule, adapter, nestjs-web-repl/redis)
npx skills add p-dim-popov/remote-repl/skills/nestjs-web-repl

# @remote-repl/express (createRemoteReplEngine + createRemoteReplRouter, your own context)
npx skills add p-dim-popov/remote-repl/skills/remote-repl-express
```

The two NestJS skills differ only in their setup section; their usage text is
identical and a test keeps it so. Each command writes the skill's `SKILL.md`
into your agent's skills directory. Your agent picks it up in its next session.
Run the command again to refresh the skill after a package upgrade.

## Limitations

- **No autocomplete or IntelliSense** against your providers. Monaco is configured
  for plain TypeScript syntax highlighting only, not for a live language service.
- **No session persistence.** REPL sessions and their variables live only in
  process memory. A restart of the owner instance loses all channel state, which
  includes the replay buffer.
- **Ownership races are last-claim-wins.** If two instances receive the first
  command for a new channel at almost the same time, both can briefly believe that
  they own it. The internal `claim` message (on the `remote-repl:sys` transport topic)
  that the group processes last decides the owner from then on. This window is
  narrow. It only exists for the first command on a channel. The protocol as
  implemented does not fully resolve it.
- **The channel of a crashed or restarted owner is taken over, but loses its
  in-memory variables.** Ownership is a lease (see
  [Transport / multi-instance](#transport--multi-instance)). A live owner keeps
  it alive with `claim` heartbeats every `ownerHeartbeatInterval`. If the owner
  of a channel crashes or restarts without a clean shutdown, its heartbeats
  stop. After `ownerLeaseTtl`, the origin instance of the next command for that
  channel takes over and starts a fresh session. The variables of the dead
  session are gone. The channel becomes usable again instead of stuck
  cluster-wide. This is better than a permanent stuck channel, but it is still a
  data loss on unclean owner death. Like last-claim-wins above, it is a narrow
  multi-instance edge case.
- **The NestJS package relies on a deep import of `@nestjs/core` internals**
  (`@nestjs/core/nest-application-context`, `@nestjs/core/repl/repl-context`) to
  build an app-wide REPL context. Only the `repl()` bootstrap function itself is
  part of the public entrypoint of `@nestjs/core`. The peer range of the package
  pins `@nestjs/core`. A future `@nestjs/core` major that moves these modules can
  break it. The import is isolated in one file of `@remote-repl/nestjs`.

## Releasing

Releases are automated with [changesets](https://github.com/changesets/changesets).
The flow has three steps:

1. A PR that changes a published package adds a changeset file
   (`npx changeset`) that names the packages and the bump level.
2. On merge to `main`, the release workflow opens or updates a
   "Version Packages" PR that applies every pending changeset to the package
   versions and changelogs.
3. On merge of that PR, the workflow publishes the bumped packages to npm.

Each package has its own version line. The four `@remote-repl` packages start
at 1.0.0. `nestjs-web-repl` stays on its 2.x line and follows them through
`^1.0.0` dependency ranges, not through a shared version number. A change to
`@remote-repl/core` bumps every package that depends on it. Never hand-edit a
`version` field or create a release tag by hand. Write the PR title as a
[Conventional Commit](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
`docs:`, and so on). PRs merge as a single squash commit.

## How this was built (transparency)

An AI agent (Claude Code) built this library under human direction. The workflow was
plan-first and test-driven: a written spec and implementation plan, then
task-by-task implementation. A separate agent reviewed each task before the next
one started, and the fixes went in first. A whole-repository review followed.
The split into the `@remote-repl` packages followed the same process.

We tell you this so that you can judge the code on its merits and not guess at its
origins. If you are skeptical of AI-written code, look at these things:

- **The tests.** A thorough automated suite. It includes two-instance end-to-end
  scenarios that prove cross-instance command routing, output fan-out, the
  owner lease and SSE replay, and a runtime suite of consumer apps
  (`runtime-tests/`) that drive the built packages over real HTTP on Node 22,
  24 and 26, Bun and Deno. It also includes an execution-proof test that
  resolves a real provider through the live REPL context. `npm test`,
  `npm run build`, the typecheck and the protocol schema check all run green
  in CI.
- **The commit history.** The TDD trail is preserved: failing test,
  implementation, fixes. It includes several rounds where review caught real
  defects. The hardest two were `node:repl` completion detection on modern Node,
  and a runtime-vs-registration security bug. An earlier async-registration API
  could have shipped the arbitrary-code endpoint live with `enabled: false`.
  `registerAsync` now enforces `enabled` at runtime instead.
- **The security invariants.** They are documented in [`AGENTS.md`](./AGENTS.md)
  and enforced by tests, not left as prose.

AI assistance does not exempt the code from scrutiny. It raises the bar for it.
Issues and fixes are welcome from anyone who finds something we missed.

## Contributing

Contributions are welcome. See [`CONTRIBUTING.md`](./CONTRIBUTING.md). AI-assisted
PRs are fine. We only ask that you disclose the assistance and that you understand
what you submit. Agents that work in this repo should start with
[`AGENTS.md`](./AGENTS.md), [`GLOSSARY.md`](./GLOSSARY.md) and
[`docs/adr/`](./docs/adr).

PRs merge as a single squash commit. Write the PR title as a
[Conventional Commit](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
`docs:`, and so on) for readable history. Version bumps are driven by
[changesets](https://github.com/changesets/changesets), not by commit messages:
a PR that changes what a package does must include a changeset file
(`npx changeset`) that names the packages it touches, the bump
(`patch` / `minor` / `major`) and a short release note. On merge to `main`, the
release workflow collects pending changesets into a "Version Packages" PR;
merging that PR publishes the bumped packages to npm and writes their
`CHANGELOG.md` files. `nestjs-web-repl` always carries the same version as
`@remote-repl/nestjs`.

## License

[MIT](./LICENSE) © Petar Popov
