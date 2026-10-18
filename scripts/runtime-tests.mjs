#!/usr/bin/env node
// The runtime suite (ADR 0006): run the given vitest command in every
// consumer app under runtime-tests/*, so vitest runs under THAT runtime (the
// root `npm test` would run it under Node, because vitest's bin has a node
// shebang). The apps resolve the packages' built dist/, so build first.
//
//   npm run test:runtime -- bun --bun x vitest run
//   npm run test:runtime -- deno run -A npm:vitest run --pool=threads
//   npm run test:runtime -- mise x node@22 -- npx vitest run
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('usage: npm run test:runtime -- <vitest command...>');
  process.exit(2);
}
const dir = join(fileURLToPath(import.meta.url), '..', '..', 'runtime-tests');
const apps = readdirSync(dir).filter((d) => existsSync(join(dir, d, 'package.json')));
let ok = true;
for (const app of apps) {
  console.log(`\n== runtime-tests/${app}: ${[cmd, ...args].join(' ')}`);
  const result = spawnSync(cmd, args, { cwd: join(dir, app), stdio: 'inherit' });
  ok = ok && result.status === 0;
}
process.exit(ok ? 0 : 1);
