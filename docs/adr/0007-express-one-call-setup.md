---
status: accepted
---

# The Express one-call setup starts the engine at construction, never on the first request

## Context

`@remote-repl/express` gave the caller two calls, `createRemoteReplEngine` and
`createRemoteReplRouter`, and left the context, the start and the stop to the
caller. The NestJS package starts and stops the engine in its module lifecycle
and puts the DI container in the context. Express has no lifecycle and no
container. A one-call setup, `createRemoteRepl()`, returns the router as Express
middleware and adds `app` (`req.app`) to the context. This setup must decide
when the engine starts.

The engine must be subscribed to the transport before its instance handles a
command. An engine that is not subscribed does not receive the claims of the
other instances. If it got a command for a channel that a live owner holds, it
would see the channel as ownerless and claim it. That is a preemption, which
the lease rules forbid.

## Decision

`createRemoteRepl()` starts the engine when it is called: `autoStart` is `true`
by default. The returned middleware exposes `ready`, a promise that settles
when the start completes. A caller with its own lifecycle sets
`autoStart: false` and calls `start()`. The engine never starts on the first
request.

Until the start completes, the routes give these answers, in this order:

1. The engine is disabled: 404, always first (security invariant 1).
2. A start is in progress: the request waits for it.
3. No start was called: 503.
4. The start failed: 503. The error is logged once, `ready` rejects, and there
   is no retry.

The gate that gives these answers lives in the Express package, not in the
shared handler layer of the core. It is lifecycle wiring that only Express
needs: the NestJS package starts the engine in its module lifecycle, before
the app serves a request, so its routes never see an engine that has not
started.

## Considered options

- **Start on the first request**, like the `lazyConnect` option of ioredis.
  Rejected: the first request would reach an engine that has not received the
  claims of the other instances, which can cause a preemption.
- **A required `await start()` before the router is mounted**, like Apollo
  Server 4 with `expressMiddleware`. Rejected as the default: it adds back the
  step that the one-call setup removes. Apollo fails the boot on a start error
  because GraphQL is the app. The REPL is a side tool, so a transport that is
  down at boot must not stop the app from serving traffic. `autoStart: false`
  plus `await repl.start()` keeps this shape for callers who want it.
- **Start and stop on `http.Server` events.** Rejected: `server.close()` waits
  for the open SSE connections, and only `stop()` ends them. A stop on the
  `close` event never runs.

## Consequences

- With the in-memory transport the start cannot fail. Only a transport such as
  Redis can make `ready` reject.
- A missing `start()` gives a 503. With the two-call API, the same mistake
  gives a 202 for a command that never runs.
- The stop stays with the caller: `await repl.close()`, then `server.close()`.
- `createRemoteReplEngine` and `createRemoteReplRouter` stay unchanged, as the
  lower-level API under `createRemoteRepl()`.
