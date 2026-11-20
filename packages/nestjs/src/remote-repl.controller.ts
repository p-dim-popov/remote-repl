import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Redirect,
  Req,
  Sse,
  StreamableFile,
  type MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  createRemoteReplHandlers,
  RemoteReplInvalidCommandError,
  parseRemoteReplLastEventId,
  RemoteReplDisabledError,
  type RemoteReplHandlers,
} from '@remote-repl/core';
import { REMOTE_REPL_OPTIONS } from './constants';
import type { RemoteReplModuleOptions } from './interfaces/remote-repl-options.interface';
import { RemoteReplService } from './remote-repl.service';

const VS_ASSET_ROUTE = vsAssetRoute();

/**
 * Thin HTTP wiring over core's shared route handlers (`createRemoteReplHandlers`).
 * All route logic -- body validation, landing redirect, UI rendering, the
 * Monaco asset traversal guard, SSE heartbeat id-stamping -- lives in core;
 * this class only maps Nest params in and core's errors out.
 */
@Controller('repl')
export class RemoteReplController {
  private readonly handlers: RemoteReplHandlers;

  constructor(
    protected readonly service: RemoteReplService,
    @Inject(REMOTE_REPL_OPTIONS) private readonly options: RemoteReplModuleOptions,
  ) {
    // CRITICAL: register/registerAsync always register this controller;
    // `enabled` is enforced at runtime so a disabled module 404s on every
    // route. The handlers read `options.enabled` on every call (the options
    // object is shared, not copied), and `RemoteReplDisabledError` maps to 404 below.
    this.handlers = createRemoteReplHandlers(service, options);
  }

  // Landing route: a visit with no channel gets a random one. Runs on this
  // controller deliberately -- the documented security story is "subclass
  // the controller, add your guard", so guard subclasses cover this route
  // with no changes.
  @Get()
  @Redirect()
  landing(@Req() req: { url: string }): { url: string; statusCode: number } {
    return { url: guard(() => this.handlers.landing(req.url)), statusCode: 302 };
  }

  @Post(':channel')
  @HttpCode(202)
  async dispatch(
    @Param('channel') channel: string,
    @Body() body: unknown,
  ): Promise<{ accepted: true; commandId: string }> {
    const { commandId } = await this.handlers.post(channel, body).catch((err: unknown) => {
      throw toHttpException(err);
    });
    return { accepted: true, commandId };
  }

  @Sse(':channel')
  stream(
    @Param('channel') channel: string,
    @Headers('last-event-id') lastEventId?: string,
  ): Observable<MessageEvent> {
    // Opened eagerly here (not at subscribe time) so a disabled module fails
    // the request with 404 before Nest commits the SSE headers.
    const frames = guard(() => this.handlers.streamFrames(channel, parseRemoteReplLastEventId(lastEventId)));
    return fromAsyncIterator(frames);
  }

  @Get(':channel/ui')
  @Header('content-type', 'text/html')
  ui(@Param('channel') channel: string): string {
    return guard(() => this.handlers.ui(channel));
  }

  // Serves the bundled Monaco editor from our own origin so the UI needs no
  // CDN. The handler applies the traversal guard and returns null (-> 404)
  // for any escape or miss.
  @Get(VS_ASSET_ROUTE)
  vsAsset(@Param() params: { path?: string[]; 0?: string }): StreamableFile {
    const relative = params.path ? params.path.join('/') : (params[0] ?? '');
    const asset = guard(() => this.handlers.asset(relative));
    if (!asset) throw new NotFoundException();
    return new StreamableFile(asset.buffer, { type: asset.contentType });
  }
}

/**
 * The asset route's trailing wildcard. NestJS 11 routes through Express 5,
 * which wants a named splat (`*path`, a string[] of segments); NestJS 10
 * routes through Express 4, which only matches a bare `*` (the string
 * `params[0]`). Both are in the `^10 || ^11` peer range.
 */
function vsAssetRoute(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { version } = require('@nestjs/core/package.json') as { version: string };
  return Number(version.split('.')[0]) >= 11 ? ':channel/vs/*path' : ':channel/vs/*';
}

/** Runs a synchronous handler call, mapping core's errors to Nest's. */
function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw toHttpException(err);
  }
}

function toHttpException(err: unknown): unknown {
  if (err instanceof RemoteReplDisabledError) return new NotFoundException();
  if (err instanceof RemoteReplInvalidCommandError) return new BadRequestException(err.message);
  return err;
}

/**
 * Adapts the handler's frame iterator to the `Observable<MessageEvent>` Nest's
 * `@Sse()` expects (the platform-agnostic convention: no raw req/res here).
 * Unsubscribing (client disconnect) calls `return()`, which is what closes the
 * engine subscription and lets the channel be GC'd.
 */
function fromAsyncIterator<T>(iterator: AsyncIterator<T>): Observable<T> {
  return new Observable<T>((subscriber) => {
    let closed = false;
    (async () => {
      try {
        for (;;) {
          const { value, done } = await iterator.next();
          if (done || closed) return;
          subscriber.next(value);
        }
      } catch (err) {
        if (!closed) subscriber.error(err);
        return;
      }
    })().then(() => {
      if (!closed) subscriber.complete();
    });
    return () => {
      closed = true;
      void iterator.return?.(undefined);
    };
  });
}
