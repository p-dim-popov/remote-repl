import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );

// @remote-repl/core is the framework-free heart of the monorepo. Every
// framework package (nestjs today, express/bun/deno later) depends on it, so
// it must never pull a framework, a transport client, or rxjs into consumers.
describe('@remote-repl/core package boundary', () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  const allDeps = () =>
    Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
      ...pkg.optionalDependencies,
    });

  it('has zero @nestjs/*, express, redis, ioredis or rxjs dependencies', () => {
    const forbidden = allDeps().filter(
      (d) => d.startsWith('@nestjs/') || ['express', 'redis', 'ioredis', 'rxjs'].includes(d),
    );
    expect(forbidden).toEqual([]);
  });

  // Static imports, side-effect imports, require() and dynamic import() alike.
  const FRAMEWORK_IMPORT =
    /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"](?:@nestjs\/|express\b|rxjs\b)/;

  it('has no source file importing @nestjs/*, express or rxjs (the handlers included)', () => {
    const offenders = walk(join(process.cwd(), 'src'))
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => FRAMEWORK_IMPORT.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
