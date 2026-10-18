// A consumer app, exactly as the README shows it: `@remote-repl/express` and
// `@remote-repl/core` come from the workspace links, which resolve to each
// package's built `dist/` (there is no vitest alias here, on purpose).
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createRemoteReplEngine, createRemoteReplRouter } from '@remote-repl/express';

export interface App {
  /** `http://127.0.0.1:<port>`, no trailing slash. */
  url: string;
  close(): Promise<void>;
}

export const startApp = async ({ enabled }: { enabled: boolean }): Promise<App> => {
  const engine = createRemoteReplEngine({
    options: { enabled, heartbeatInterval: 150 },
    context: { greeting: 'hello from the host app' },
    logger: { warn() {}, error() {} },
  });
  await engine.start();
  const app = express();
  app.use('/repl', createRemoteReplRouter({ engine }));
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await engine.stop();
    },
  };
};
