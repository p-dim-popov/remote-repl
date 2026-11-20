import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// @remote-repl/express is a thin HTTP layer: it wires core's shared route
// handlers onto an Express Router. It depends on core and nothing else at
// runtime; Express itself is the host app's and so a PEER. It must never
// pull NestJS or rxjs in.
describe('@remote-repl/express package boundary', () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));

  it('depends on @remote-repl/core and nothing else at runtime', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['@remote-repl/core']);
  });

  it('declares express as its only peer dependency, spanning 4 and 5', () => {
    expect(Object.keys(pkg.peerDependencies)).toEqual(['express']);
    expect(pkg.peerDependencies.express).toBe('^4.16 || ^5');
  });

  it('has zero @nestjs/*, rxjs or redis dependencies of any kind', () => {
    const all = Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
      ...pkg.optionalDependencies,
    });
    const forbidden = all.filter(
      (d) =>
        d.startsWith('@nestjs/') ||
        ['rxjs', 'reflect-metadata', 'redis', 'ioredis'].includes(d),
    );
    expect(forbidden).toEqual([]);
  });
});
