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

`express` (`^4.16 || ^5`) is a peer dependency. Node 20+ is required.

## Usage

```ts
import express from 'express';
import { createRemoteReplEngine, createRemoteReplRouter } from '@remote-repl/express';

const enabled = process.env.REPL_ENABLED === 'true';

const engine = createRemoteReplEngine({
  options: { enabled },
  // no `transport`: the in-memory default, for one process
  context: { db }, // what every REPL session sees as globals
});
await engine.start(); // no-op when disabled

const app = express();
app.use('/repl', requireAdmin, createRemoteReplRouter({ engine }));
app.listen(3000);
```

The mount path is the base path. `enabled` is set once, on the engine: the
engine refuses commands and streams, and the router reads `engine.enabled` and
returns 404 on every route. One process needs no transport. For several
replicas, pass a transport from `@remote-repl/redis`.

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
