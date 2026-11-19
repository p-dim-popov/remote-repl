import { Router, type Application, type NextFunction, type Request, type Response } from 'express';
import type { RemoteReplEngine, RemoteReplLogger, RemoteReplOptions, RemoteReplTransport } from '@remote-repl/core';
import { createRemoteReplEngine } from './repl-engine';
import { createRemoteReplRouter } from './repl-router';

type RemoteReplMiddlewareBaseOptions = RemoteReplOptions & {
  /** The pub/sub transport: Redis for a cluster. Default: in-memory (one instance). */
  transport?: RemoteReplTransport;
  /** Defaults to `console`. */
  logger?: RemoteReplLogger;
  /**
   * Starts the engine when `createRemoteRepl()` is called. Default `true`.
   * With `false`, the caller calls `start()`, and until then every route
   * answers 503. The engine never starts on the first request (ADR 0007).
   */
  autoStart?: boolean;
};

/**
 * The engine options (flat), plus what every session sees next to `app`:
 * a `context` object, or a `buildContext` callback, or neither. A key the
 * caller gives wins over the injected `app`.
 */
export type RemoteReplMiddlewareOptions =
  | (RemoteReplMiddlewareBaseOptions & {
      /** Globals every session sees next to `app` (a shallow copy per session). */
      context?: Record<string, unknown>;
      buildContext?: never;
    })
  | (RemoteReplMiddlewareBaseOptions & {
      /**
       * Called once per session, synchronously, with the app that mounts the
       * router. Returns the globals that session sees next to `app`.
       */
      buildContext: (env: { app: Application }) => Record<string, unknown>;
      context?: never;
    });

/** The Express router of the REPL, with the engine and its lifecycle attached. */
export type RemoteReplMiddleware = Router & {
  readonly engine: RemoteReplEngine;
  /**
   * Settles with the first start of the engine: resolves when it completes,
   * rejects when it fails (the failure is logged either way). Await it to
   * make a failed start fail the boot of the app.
   */
  readonly ready: Promise<void>;
  /**
   * Starts the engine and returns the same promise as `ready`. Idempotent:
   * with `autoStart` (the default) the start already runs, and a failed
   * start is not retried.
   */
  start(): Promise<void>;
  /** Stops the engine: ends every SSE stream. Call it before `server.close()`. */
  close(): Promise<void>;
};

const NOT_STARTED = Object.freeze({ statusCode: 503, message: 'remote-repl is not started' });
const START_FAILED = Object.freeze({ statusCode: 503, message: 'remote-repl failed to start' });

/**
 * The one-call setup: builds the engine, starts it, and returns its router as
 * Express middleware. Mount it behind the app's own auth middleware:
 * `app.use('/repl', requireAdmin, createRemoteRepl({ enabled }))`. Every
 * session gets the app that mounts the router (`req.app`) as `app`.
 */
export function createRemoteRepl(opts: RemoteReplMiddlewareOptions): RemoteReplMiddleware {
  const { transport, logger, context, buildContext, autoStart = true, ...options } = opts;
  // The app that mounts the router, read from each request. The owner of a
  // channel is always the origin of a command it received over HTTP, so the
  // router has seen a request before the engine builds a session.
  let app: Application | undefined;
  const engine = createRemoteReplEngine({
    options,
    transport,
    logger,
    // `app` is set by the first request through the router (see above).
    buildContext: () => ({ app, ...(buildContext ? buildContext({ app: app as Application }) : context) }),
  });

  // `ready` settles with the first start, whoever makes it. A failed start
  // is logged here, so an unawaited `ready` must not become an unhandled
  // rejection that takes the host app down. `ready` adopts `started`, which
  // also marks `started` as handled when the caller ignores `start()`.
  let settleReady!: (start: Promise<void>) => void;
  const ready = new Promise<void>((resolve) => (settleReady = resolve));
  ready.catch(() => {});
  let started: Promise<void> | undefined;
  const start = (): Promise<void> => {
    if (!started) {
      started = engine.start().catch((err: unknown) => {
        (logger ?? console).error(`remote-repl failed to start: ${String(err)}`);
        throw err;
      });
      settleReady(started);
    }
    return started;
  };
  if (autoStart) void start();

  const router = Router();
  router.use((req: Request, res: Response, next: NextFunction) => {
    app = req.app;
    // A disabled engine goes straight to the router, which 404s every route
    // (security invariant 1: the 404 comes before any other answer).
    if (!engine.enabled) {
      next();
      return;
    }
    if (!started) {
      res.status(503).json(NOT_STARTED);
      return;
    }
    // A start in progress holds the request until it completes.
    started.then(
      () => next(),
      () => res.status(503).json(START_FAILED),
    );
  });
  router.use(createRemoteReplRouter({ engine }));

  return Object.assign(router, {
    engine,
    ready,
    start,
    close: () => engine.stop(),
  });
}
