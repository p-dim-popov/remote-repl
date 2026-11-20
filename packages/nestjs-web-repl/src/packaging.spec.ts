import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { subset } from 'semver';

// `nestjs-web-repl` keeps a 2.3.x install resolving with zero changes. Its
// peers may widen (a new NestJS major) but never narrow: every range a 2.3.x
// app satisfied must still be accepted.
const PEERS_2_3 = {
  '@nestjs/common': '^10 || ^11',
  '@nestjs/core': '^10 || ^11',
  rxjs: '^7',
  ioredis: '^5',
  redis: '^4 || ^5',
};

describe('nestjs-web-repl packaging', () => {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));

  it.each(Object.entries(PEERS_2_3))('still accepts the 2.3.x peer range of %s (%s)', (name, legacy) => {
    expect(pkg.peerDependencies[name], name).toBeDefined();
    expect(subset(legacy, pkg.peerDependencies[name]), `${legacy} within ${pkg.peerDependencies[name]}`).toBe(true);
  });
});
