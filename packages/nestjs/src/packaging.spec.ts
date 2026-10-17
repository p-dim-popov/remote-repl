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

describe('packaging', () => {
  const pkg = read(join(process.cwd(), 'package.json'));

  it('ships only dist (no skill dir, no bin: skills install via skills.sh)', () => {
    expect(pkg.files).toEqual(['dist']);
    expect(pkg.bin).toBeUndefined();
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const paths: string[] = packedPaths(out);
    expect(paths.some((p) => p.startsWith('skill/') || p.includes('/cli/'))).toBe(false);
  });

  // The `./redis` subpath, its typesVersions fallback and the optional
  // ioredis/redis peers belong to the `nestjs-web-repl` shim
  // (packages/nestjs-web-repl): this package exports only its own API.
  it('exposes only the default entry and package.json in exports', () => {
    expect(pkg.exports).toEqual({
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
      './package.json': './package.json',
    });
    expect(pkg.typesVersions).toBeUndefined();
  });

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

describe('workspace layout', () => {
  // This package lives at packages/nestjs inside an npm-workspaces monorepo.
  // The root manifest is private (never published) and owns the workspace.
  const rootPkg = () => read(join(repoRoot, 'package.json'));

  it('sits under a private workspace root that lists packages/*', () => {
    expect(rootPkg().private).toBe(true);
    expect(rootPkg().workspaces).toContain('packages/*');
  });

  it('is reached from the workspace root by its package name', () => {
    expect(read(join(process.cwd(), 'package.json')).name).toBe('@remote-repl/nestjs');
    expect(process.cwd().endsWith(join('packages', 'nestjs'))).toBe(true);
  });

  const manifestsUnder = (dir: string) =>
    readdirSync(join(repoRoot, dir))
      .map((d) => join(repoRoot, dir, d, 'package.json'))
      .filter((p) => existsSync(p));

  it('has no package with a bin field anywhere in the workspace', () => {
    const manifests = [...manifestsUnder('packages'), ...manifestsUnder('runtime-tests')];
    expect(manifests.length).toBeGreaterThan(0);
    for (const p of [join(repoRoot, 'package.json'), ...manifests]) {
      expect(read(p).bin, p).toBeUndefined();
    }
  });

  // runtime-tests/* are consumer apps, not packages: private, driven only by
  // `npm run test:runtime` through their `probe` script, and never picked up
  // by the root `build` / `test` / `typecheck` delegates (which run
  // `--workspaces --if-present`, so an app without those scripts is skipped).
  describe('runtime-tests/* (consumer apps)', () => {
    const apps = manifestsUnder('runtime-tests');

    it('is a workspace glob with at least the Express app', () => {
      expect(rootPkg().workspaces).toContain('runtime-tests/*');
      expect(apps.map((p) => p.split('/').at(-2))).toContain('express-app');
    });

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

    it('the root delegates skip workspaces without the script', () => {
      for (const name of ['build', 'test', 'typecheck']) {
        expect(rootPkg().scripts[name]).toContain('--workspaces --if-present');
      }
    });

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
});

// Agent skills are plain files under skills/<dir>/SKILL.md at the repo root,
// installed by consumers with `npx skills add p-dim-popov/remote-repl/skills/<dir>`.
describe('agent skills (skills.sh layout)', () => {
  const skill = (dir: string) =>
    readFileSync(join(repoRoot, 'skills', dir, 'SKILL.md'), 'utf8');
  const frontmatter = (body: string) => {
    const m = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    expect(m).not.toBeNull();
    const fm = m![1];
    return {
      name: fm.match(/^name:\s*(.+)$/m)?.[1].trim(),
      description: fm.match(/^description:\s*(.+)$/m)?.[1].trim(),
    };
  };

  const SKILLS = ['nestjs-web-repl', 'remote-repl-nestjs', 'remote-repl-express'];
  // The "## Use it" section runs from its heading to the next H2.
  const usageSection = (body: string) => {
    const m = body.match(/^## Use it\r?\n([\s\S]*?)(?=^## )/m);
    expect(m).not.toBeNull();
    return m![1];
  };

  it('skills/ holds exactly the three documented skill directories', () => {
    expect(readdirSync(join(repoRoot, 'skills')).sort()).toEqual([...SKILLS].sort());
  });

  it.each(SKILLS.map((s) => [s, s]))('skills/%s/SKILL.md has frontmatter name %s and a description', (dir, name) => {
    const fm = frontmatter(skill(dir));
    expect(fm.name).toBe(name);
    expect(fm.description && fm.description.length).toBeGreaterThan(0);
  });

  it.each(SKILLS)(
    'skills/%s leads with the security warning before the wiring instructions',
    (dir) => {
      const body = skill(dir);
      const securityIdx = body.indexOf('Security first');
      const wireIdx = body.indexOf('## Wire it up');
      expect(securityIdx).toBeGreaterThan(-1);
      expect(wireIdx).toBeGreaterThan(-1);
      expect(securityIdx).toBeLessThan(wireIdx);
    },
  );

  // Setup is only half the job: an agent that installs a skill must also
  // learn when the REPL is worth using and how to drive it from a shell.
  it.each(SKILLS)('skills/%s teaches usage: the POST + SSE pair read until done', (dir) => {
    const usage = usageSection(skill(dir));
    expect(usage).toContain('curl');
    expect(usage).toContain('"done":true');
    expect(usage).toContain('commandId');
    expect(usage).toContain('Last-Event-ID');
  });

  // The legacy words are assembled from fragments so the vocabulary guard
  // below does not trip on this spec.
  it('the legacy-package skill documents the deprecated module.register({ <legacy transport key> }) aliases', () => {
    const body = skill('nestjs-web-repl');
    expect(body).toContain(['Web', 'Repl', 'Module', '.register('].join(''));
    expect(body).toContain(['adap', 'ter'].join(''));
    expect(body).toContain('nestjs-web-repl/redis');
    expect(body).toContain('deprecated');
    expect(body).toContain('packages/nestjs-web-repl/README.md');
    expect(body).not.toContain('forRoot');
    expect(body).not.toMatch(/npx nestjs-web-repl install/);
  });

  it('the @remote-repl/nestjs skill documents register({ transport }), @remote-repl/redis and the prefix', () => {
    const body = skill('remote-repl-nestjs');
    expect(body).toContain('RemoteReplModule.register(');
    expect(body).toContain('transport');
    expect(body).toContain('@remote-repl/nestjs');
    expect(body).toContain('@remote-repl/redis');
    expect(body).toContain('prefix');
    expect(body).not.toContain('forRoot');
  });

  it('the two NestJS skills share their "Use it" section verbatim (only setup differs)', () => {
    expect(usageSection(skill('remote-repl-nestjs'))).toBe(usageSection(skill('nestjs-web-repl')));
    expect(usageSection(skill('nestjs-web-repl'))).toContain('get(CatService)');
  });

  it('the two NestJS skills share their "Security first" section verbatim', () => {
    const security = (body: string) => {
      const m = body.match(/^## Security first[^\n]*\r?\n([\s\S]*?)(?=^## )/m);
      expect(m).not.toBeNull();
      return m![1];
    };
    expect(security(skill('remote-repl-nestjs'))).toBe(security(skill('nestjs-web-repl')));
  });

  it('the Express skill documents the engine + router API and the lifecycle', () => {
    const body = skill('remote-repl-express');
    expect(body).toContain('@remote-repl/express');
    expect(body).toContain('createRemoteReplEngine(');
    expect(body).toContain('createRemoteReplRouter(');
    expect(body).toContain('engine.start()');
    expect(body).toContain('engine.stop()');
    expect(body).toContain('prefix');
  });
});

// The repo is being renamed to p-dim-popov/remote-repl (ADR 0004; the
// skills.sh install paths already use it). Every URL in the tree that names
// the repo must use that slug so they cannot drift. The root CHANGELOG.md
// keeps the original slug in its released history; everything else is
// scanned for both superseded slugs.
describe('repository slug', () => {
  const OLD_SLUGS = ['nestjs-web-repl', 'node-remote-repl'].map((r) => ['p-dim-popov', r].join('/'));
  // Tracked files only: untracked or ignored local files (scratch dirs,
  // build output) are not part of what ships, so they must not fail the gate.
  const trackedFiles = (): string[] =>
    execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot })
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
      .map((rel) => join(repoRoot, rel))
      .filter((f) => existsSync(f));

  it('no tracked file outside the root CHANGELOG history references a superseded slug', () => {
    const offenders = trackedFiles()
      .filter((f) => f !== join(repoRoot, 'CHANGELOG.md'))
      .filter((f) => {
        const body = readFileSync(f, 'utf8');
        return OLD_SLUGS.some((slug) => body.includes(slug));
      })
      .map((f) => f.slice(repoRoot.length + 1));
    expect(offenders).toEqual([]);
  });
});

// `tsc -b` is incremental and never deletes the output of a source file that
// was removed (seen with a stale dist/cli after the CLI was deleted), so every
// package's `build` empties its dist first. Guarded on dist existing: `npm
// test` needs no prior build, but CI builds first, so there it is live.
describe('built output (when a dist exists)', () => {
  const packagesDir = join(repoRoot, 'packages');
  const listFiles = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) listFiles(full, out);
      else out.push(full);
    }
    return out;
  };
  const built = readdirSync(packagesDir).filter((d) => existsSync(join(packagesDir, d, 'dist')));

  it.each(built)('packages/%s/dist has no output whose source is gone', (name) => {
    const dist = join(packagesDir, name, 'dist');
    const src = join(packagesDir, name, 'src');
    const stale = listFiles(dist)
      .map((f) => f.slice(dist.length + 1))
      .filter((rel) => /\.(js|d\.ts)$/.test(rel))
      // core copies the Monaco tree into dist/ui/vs; it has no .ts sources.
      .filter((rel) => !rel.startsWith(join('ui', 'vs')))
      .filter((rel) => !existsSync(join(src, rel.replace(/\.d\.ts$|\.js$/, '.ts'))));
    expect(stale).toEqual([]);
  });
});

// Ticket #36 / ADR 0005: the @remote-repl/* packages use the product's own
// vocabulary. No export, identifier, file name, comment or README line in
// them uses the two historical words in any spelling; the transport vocabulary
// of GLOSSARY.md is used instead. The only tolerated token is the legacy
// package / skill NAME `nestjs-web-repl` (PROTOCOL.md's legacy-wire note, the
// shim's own package and the skill directory are outside these four
// packages, or are that token). The pattern is assembled from fragments so
// this guard does not trip itself.
describe('vocabulary of the @remote-repl packages', () => {
  const PACKAGES = ['core', 'nestjs', 'express', 'redis'];
  const LEGACY_NAME = ['nestjs', 'web', 'repl'].join('-');
  const FORBIDDEN = new RegExp(['web' + '[\\s_-]?' + 'repl', 'Adap' + 'ter'].join('|'), 'i');
  const trackedFiles = (): string[] =>
    execFileSync('git', ['ls-files', '-z', ...PACKAGES.map((p) => `packages/${p}`)], { cwd: repoRoot })
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
      .filter((rel) => !rel.startsWith('packages/core/src/ui/vs/'))
      .filter((rel) => existsSync(join(repoRoot, rel)));

  it('no tracked file in core, nestjs, express or redis uses the legacy vocabulary', () => {
    const offenders: string[] = [];
    for (const rel of trackedFiles()) {
      const body = readFileSync(join(repoRoot, rel), 'utf8').split(LEGACY_NAME).join('');
      body.split('\n').forEach((line, i) => {
        if (FORBIDDEN.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
