import express, { type NextFunction, type Request, type Response } from 'express';
import { createRemoteRepl } from '../src';
import { CatService } from './cat.service';

// Off by default: the REPL executes arbitrary code, so it must be opted into
// explicitly (`REPL_ENABLED=true npm run example:express`).
const enabled = process.env.REPL_ENABLED === 'true';
const port = Number(process.env.PORT ?? 3000);

// The host app's own auth goes IN FRONT of the router; the library ships
// none. This demo gate is a static bearer token (`REPL_TOKEN`, default
// "dev-token") -- replace it with the app's real session/auth middleware.
const token = process.env.REPL_TOKEN ?? 'dev-token';
function requireReplToken(req: Request, res: Response, next: NextFunction): void {
  const header = req.get('authorization') ?? '';
  const fromQuery = typeof req.query.token === 'string' ? req.query.token : '';
  if (header === `Bearer ${token}` || fromQuery === token) {
    next();
    return;
  }
  res.status(401).json({ statusCode: 401, message: 'Unauthorized' });
}

async function bootstrap(): Promise<void> {
  const catService = new CatService();
  const app = express();
  app.get('/', (_req, res) => {
    res.type('text/plain').send('express example up; the REPL lives under /repl');
  });

  const repl = createRemoteRepl({
    enabled,
    instanceId: process.env.INSTANCE_ID,
    // No `transport`: the in-memory default, correct for this one process.
    // The context every REPL session sees, next to `app`.
    context: { catService },
  });
  app.use('/repl', requireReplToken, repl); // 404s everything when disabled
  await repl.ready; // the engine starts on its own; a failed start fails the boot

  const server = app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `remote-repl express example on :${port} (REPL ${enabled ? 'ENABLED' : 'disabled'}) ` +
        `— open /repl/dev/ui?token=${token}`,
    );
  });

  // Stop the REPL first: it ends the open SSE streams, which `server.close()`
  // waits for.
  const shutdown = async (): Promise<void> => {
    await repl.close();
    server.close();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

void bootstrap();
