---
'@remote-repl/express': minor
---

Add `createRemoteRepl()`, a one-call setup: it builds the engine, starts it, and returns an Express router to mount behind your auth middleware (`app.use('/repl', requireAdmin, createRemoteRepl({ enabled }))`). Every session sees the Express app that mounts the router as `app`, next to `context` or what `buildContext({ app })` returns. The router carries `ready` (settles with the start; a failed start is logged and answers 503, it never crashes the app), `start()` (with `autoStart: false`, for an app that starts the REPL from its own lifecycle), `close()` and `engine`. `createRemoteReplEngine` and `createRemoteReplRouter` are unchanged.
