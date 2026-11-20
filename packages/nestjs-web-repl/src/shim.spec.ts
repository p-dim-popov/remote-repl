import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as shim from 'nestjs-web-repl';
import * as shimRedis from 'nestjs-web-repl/redis';
import * as nestjsPkg from '@remote-repl/nestjs';
import * as redisPkg from '@remote-repl/redis';

// `nestjs-web-repl` is the legacy name. It resolves every pre-split public
// name as a deprecated alias of its @remote-repl/* replacement (same object
// identity, so DI tokens and instanceof checks agree across the two names),
// and it also exposes the new names so an app can migrate one import at a
// time. `WebReplModule` is the one alias with logic: it translates the
// legacy `adapter` extra to `transport` and delegates to `RemoteReplModule`.
describe('nestjs-web-repl legacy aliases', () => {
  it('resolves every legacy runtime name to its replacement', () => {
    expect(shim.WebReplController).toBe(nestjsPkg.RemoteReplController);
    expect(shim.WebReplService).toBe(nestjsPkg.RemoteReplService);
    expect(shim.InMemoryWebReplAdapter).toBe(nestjsPkg.RemoteReplInMemoryTransport);
    expect(shim.WEB_REPL_OPTIONS).toBe(nestjsPkg.REMOTE_REPL_OPTIONS);
    expect(typeof shim.WebReplModule.register).toBe('function');
    expect(typeof shim.WebReplModule.registerAsync).toBe('function');
  });

  it('resolves every legacy /redis name to its replacement', () => {
    expect(shimRedis.IoRedisWebReplAdapter).toBe(redisPkg.RemoteReplIoRedisTransport);
    expect(shimRedis.NodeRedisWebReplAdapter).toBe(redisPkg.RemoteReplNodeRedisTransport);
    expect(shimRedis.BaseRedisWebReplAdapter).toBe(redisPkg.RemoteReplBaseRedisTransport);
  });

  it('also exposes the new names, so an app can migrate import by import', () => {
    const isNew = (key: string) => /^(RemoteRepl|REMOTE_REPL_)/.test(key);
    const newNestjs = Object.keys(nestjsPkg).filter(isNew) as (keyof typeof nestjsPkg)[];
    const newRedis = Object.keys(redisPkg).filter(isNew) as (keyof typeof redisPkg)[];
    expect(newNestjs).toContain('RemoteReplModule');
    expect(newRedis).toContain('RemoteReplIoRedisTransport');
    for (const key of newNestjs) expect(shim[key], key).toBe(nestjsPkg[key]);
    for (const key of newRedis) expect(shimRedis[key], key).toBe(redisPkg[key]);
  });

  it('WebReplModule.register returns the RemoteReplModule dynamic module', () => {
    const dynamic = shim.WebReplModule.register({ enabled: false });
    expect(dynamic.module).toBe(nestjsPkg.RemoteReplModule);
  });
});

// The migration tables (this package's README and the root README) tell a
// reader which new name replaces each legacy one. Every runtime row must name
// the export the legacy alias really is, and every legacy runtime export of
// the shim must have a row in this package's table.
describe('nestjs-web-repl migration tables', () => {
  const legacy = { ...shim, ...shimRedis } as Record<string, unknown>;
  const current = { ...nestjsPkg, ...redisPkg } as Record<string, unknown>;
  const rows = (rel: string) =>
    readFileSync(join(process.cwd(), rel), 'utf8')
      .split('\n')
      .map((line) => line.match(/^\|\s*`(\w+)`\s*\|\s*`(\w+)`/))
      .filter((m): m is RegExpMatchArray => m !== null && m[1] in legacy)
      .map((m) => [m[1], m[2]] as const);
  const isNew = (key: string) => /^(RemoteRepl|REMOTE_REPL_)/.test(key);

  it.each(['README.md', '../../README.md'])('%s maps each legacy runtime name to the export it aliases', (rel) => {
    const table = rows(rel);
    expect(table.length).toBeGreaterThan(0);
    for (const [old, replacement] of table) {
      expect(current[replacement], `${old} -> ${replacement}`).toBeDefined();
      // WebReplModule is the one alias with logic: it delegates to RemoteReplModule.
      if (old === 'WebReplModule') expect(shim.WebReplModule.register({ enabled: false }).module).toBe(current[replacement]);
      else expect(legacy[old], `${old} -> ${replacement}`).toBe(current[replacement]);
    }
  });

  it('README.md has a row for every legacy runtime export', () => {
    const listed = rows('README.md').map(([old]) => old);
    expect(Object.keys(legacy).filter((key) => !isNew(key)).sort()).toEqual([...new Set(listed)].sort());
  });
});

// The deprecation must reach the consumer's editor: the legacy names carry a
// JSDoc `@deprecated` tag in the EMITTED declarations, not only in source. A
// build-config change (`removeComments`, a bundler) would strip every tag at
// once, so one check per entry point is enough.
describe('nestjs-web-repl emitted declarations', () => {
  // Emit declarations for the shim's sources alone (siblings resolve through
  // the typecheck `paths`, so no prior build is needed).
  const outDir = mkdtempSync(join(tmpdir(), 'nestjs-web-repl-dts-'));
  beforeAll(() => {
    execFileSync(
      join(process.cwd(), '..', '..', 'node_modules', '.bin', 'tsc'),
      ['-p', 'tsconfig.typecheck.json', '--noEmit', 'false', '--declaration', '--emitDeclarationOnly', '--outDir', outDir],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
  }, 120_000);

  const declared = (file: string) => readFileSync(join(outDir, 'nestjs-web-repl', 'src', file), 'utf8');

  it.each(['index.d.ts', 'redis.d.ts'])('%s keeps the @deprecated tags of the legacy names', (file) => {
    expect(declared(file)).toMatch(/\/\*\*[^]*?@deprecated[^]*?\*\/\s*export /);
  });
});
