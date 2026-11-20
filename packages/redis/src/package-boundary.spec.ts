import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// @remote-repl/redis is a transport package: it bridges the core protocol to
// a Redis pub/sub bus. It depends on core (the RemoteReplTransport interface) and
// nothing else; the Redis clients themselves are OPTIONAL peers so a consumer
// installs exactly the one it uses. It must never pull a framework or rxjs in.
describe('@remote-repl/redis package boundary', () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));

  it('depends on @remote-repl/core and nothing else at runtime', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['@remote-repl/core']);
  });

  it('has zero @nestjs/*, express or rxjs dependencies of any kind', () => {
    const all = Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
      ...pkg.optionalDependencies,
    });
    const forbidden = all.filter(
      (d) => d.startsWith('@nestjs/') || ['express', 'rxjs', 'reflect-metadata'].includes(d),
    );
    expect(forbidden).toEqual([]);
  });
});
