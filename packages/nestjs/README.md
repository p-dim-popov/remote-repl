# @remote-repl/nestjs

The NestJS package for remote-repl: `RemoteReplModule` exposes a live NestJS REPL
over HTTP. It gives you a command endpoint, an SSE output stream and a Monaco
browser UI, backed by real `@nestjs/core` REPL sessions that see the whole DI
container of your app.

> **Security.** The routes execute arbitrary code inside your process by
> design. The package ships no authentication. Gate `enabled` behind an
> environment variable and put your own guard in front of the routes.

## Install

```bash
npm install @remote-repl/nestjs
```

`@nestjs/common`, `@nestjs/core` (`^10 || ^11`) and `rxjs` are peer
dependencies. Node 22+ is required. Existing apps can keep the
`nestjs-web-repl` package name: it is a shim that re-exports this package.

## Usage

```ts
import { Module } from '@nestjs/common';
import { RemoteReplModule } from '@remote-repl/nestjs';

@Module({
  imports: [
    RemoteReplModule.register({
      enabled: process.env.REPL_ENABLED === 'true',
    }),
  ],
})
export class AppModule {}
```

Start the app with `REPL_ENABLED=true` and open
`http://localhost:3000/repl/dev/ui`. `registerAsync` reads the options from
DI. The `controller` extra takes a guarded subclass of `RemoteReplController`.
The `transport` extra takes a transport from `@remote-repl/redis` for several
replicas.

Full documentation, the options table and the security notes are in the
repository README: https://github.com/p-dim-popov/remote-repl#readme

## License

MIT
