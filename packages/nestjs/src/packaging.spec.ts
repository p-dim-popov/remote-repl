import { execFileSync } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

// `npm pack --json` prints an array of pack results up to npm 11 and, from
// npm 12, an object keyed by package name. Accept both.
const packedPaths = (packJson: string): string[] => {
  const parsed = JSON.parse(packJson);
  const result = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  return (result as { files: { path: string }[] }).files.map((f) => f.path);
};

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const repoRoot = join(process.cwd(), '..', '..');

const manifestsUnder = (dir: string) =>
  readdirSync(join(repoRoot, dir))
    .map((d) => join(repoRoot, dir, d, 'package.json'))
    .filter((p) => existsSync(p));

describe('packaging', () => {
  const pkg = read(join(process.cwd(), 'package.json'));

  // ADR 0001: the Redis transports and the `./redis` subpath belong to
  // @remote-repl/redis and the shim, never to this package.
  it('has no runtime dependency on @remote-repl/redis and no redis client peers', () => {
    expect(Object.keys(pkg.dependencies)).toEqual(['@remote-repl/core']);
    expect(Object.keys(pkg.peerDependencies).sort()).toEqual([
      '@nestjs/common',
      '@nestjs/core',
      'rxjs',
    ]);
    expect(pkg.peerDependenciesMeta).toBeUndefined();
  });
});

// What npm actually ships, for every workspace package. Entry points are
// checked after the build by `npm run check:packages` (publint and attw).
// Build leftovers only exist once dist/ does, which CI builds before testing.
describe('published tarballs', () => {
  const packages = manifestsUnder('packages').map((p) => p.slice(0, -'/package.json'.length));

  it.each(packages.map((dir) => [dir.slice(repoRoot.length + 1), dir]))(
    '%s packs its LICENSE and README, and no sources or build leftovers',
    (_rel, dir) => {
      const paths = packedPaths(
        execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: dir, encoding: 'utf8' }),
      );
      expect(paths).toEqual(expect.arrayContaining(['LICENSE', 'README.md', 'package.json']));
      expect(paths.filter((p) => p.startsWith('src/') || p.endsWith('.tsbuildinfo'))).toEqual([]);
    },
    30_000,
  );
});

// runtime-tests/* are consumer apps, not packages: private, driven only by
// `npm run test:runtime` through their `probe` script, and never picked up
// by the root `build` / `test` / `typecheck` delegates (which run
// `--workspaces --if-present`, so an app without those scripts is skipped).
describe('runtime-tests/* (consumer apps)', () => {
  const apps = manifestsUnder('runtime-tests');

  it.each(apps.map((p) => [p.slice(repoRoot.length + 1), p]))(
    '%s is private, unscoped, has a probe script and none of build/test/typecheck',
    (_rel, p) => {
      const app = read(p);
      expect(app.private).toBe(true);
      expect(app.name.startsWith('@')).toBe(false);
      expect(app.scripts.probe).toBeDefined();
      expect(Object.keys(app.scripts)).not.toContain('build');
      expect(Object.keys(app.scripts)).not.toContain('test');
      expect(Object.keys(app.scripts)).not.toContain('typecheck');
    },
  );

  // A vitest alias, as the packages' own configs have, would make an app
  // test the sources instead of the built dist/ a consumer installs.
  it('no app aliases a package to its source (it must resolve dist/)', () => {
    for (const p of apps) {
      const dir = p.slice(0, -'package.json'.length);
      for (const cfg of ['vitest.config.ts', 'vitest.config.mts', 'vitest.config.js', 'vite.config.ts']) {
        if (!existsSync(join(dir, cfg))) continue;
        expect(readFileSync(join(dir, cfg), 'utf8')).not.toMatch(/alias/);
      }
    }
  });
});

// Agent skills are plain files under skills/<dir>/SKILL.md at the repo root,
// installed by consumers with `npx skills add p-dim-popov/remote-repl/skills/<dir>`.
// Their code samples and protocol samples are checked in docs.spec.ts.
describe('agent skills (skills.sh layout)', () => {
  const SKILLS = readdirSync(join(repoRoot, 'skills'));
  const skill = (dir: string) => readFileSync(join(repoRoot, 'skills', dir, 'SKILL.md'), 'utf8');
  const frontmatter = (body: string) => {
    const m = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    expect(m).not.toBeNull();
    const fm = m![1];
    return {
      name: fm.match(/^name:\s*(.+)$/m)?.[1].trim(),
      description: fm.match(/^description:\s*(.+)$/m)?.[1].trim(),
    };
  };
  // An H2 section runs from its heading to the next H2.
  const section = (body: string, heading: string) => {
    const m = body.match(new RegExp(`^## ${heading}[^\\n]*\\r?\\n([\\s\\S]*?)(?=^## )`, 'm'));
    expect(m).not.toBeNull();
    return m![1];
  };

  // skills.sh keys a skill on its frontmatter name; the legacy skill's
  // `nestjs-web-repl` name is what existing installs point at.
  it.each(SKILLS.map((s) => [s]))('skills/%s/SKILL.md has a frontmatter name equal to its directory and a description', (dir) => {
    const fm = frontmatter(skill(dir));
    expect(fm.name).toBe(dir);
    expect(fm.description && fm.description.length).toBeGreaterThan(0);
  });

  // The two NestJS skills differ only in setup: an edit to the shared
  // sections must land in both copies.
  it.each(['Use it', 'Security first'])('the two NestJS skills share their "%s" section verbatim', (heading) => {
    expect(section(skill('remote-repl-nestjs'), heading)).toBe(section(skill('nestjs-web-repl'), heading));
  });
});
