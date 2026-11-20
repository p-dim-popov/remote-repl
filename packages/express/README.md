# @remote-repl/express

The Express package for remote-repl: an Express `Router` that exposes a live,
in-process Node.js REPL over HTTP. It gives you a command endpoint, an SSE
output stream and a Monaco browser UI, backed by the framework-free engine in
`@remote-repl/core`.

> **Security.** The routes execute arbitrary code inside your process by
> design. The package ships no authentication. Gate `enabled` behind an
> environment variable and put your own middleware in front of the router.

## Install

```bash
npm install @remote-repl/express
```

`express` (`^4.16 || ^5`) is a peer dependency. Node 22+ is required.

## Usage

```ts
import express from 'express';
import { createRemoteRepl } from '@remote-repl/express';

const enabled = process.env.REPL_ENABLED === 'true';

const app = express();
const repl = createRemoteRepl({
  enabled,
  // no `transport`: the in-memory default, for one process
  context: { db }, // the context every REPL session sees, next to `app`
});
app.use('/repl', requireAdmin, repl);
const server = app.listen(3000);

// on shutdown: stop the REPL first, it ends the open SSE streams
await repl.close();
server.close();
```

The mount path is the base path. Every session sees the Express app that
mounts the router as `app`, next to your `context` (or what
`buildContext({ app })` returns). The engine starts when `createRemoteRepl()`
is called; `await repl.ready` to make a failed start fail the boot, or pass
`autoStart: false` and call `await repl.start()` from your own lifecycle.
`enabled` is set once: the engine refuses commands and streams, and every
route returns 404. One process needs no transport. For several replicas, pass
a transport from `@remote-repl/redis`. The lower-level `createRemoteReplEngine`
and `createRemoteReplRouter` stay available for full control.

## Runtimes

Node 22, 24 and 26, Bun and Deno are supported and release-blocking. A plain
Express app that depends on this package (`runtime-tests/express-app` in the
repository) runs against the published build on every one of them in CI:
multi-line input, top-level `await`, error recovery, `Last-Event-ID` replay,
the UI and Monaco assets, and the 404 rail when `enabled` is false.

Full documentation, the options table and the security notes are in the
repository README: https://github.com/p-dim-popov/remote-repl#readme

## License

MIT
