// Pins the CI shape of ADR 0006 (docs/adr/0006-ci-shape.md): one verify
// workflow called by pr.yml and release.yml, every runtime pinned in mise.toml
// and blocking, the runtime suite as a script over runtime-tests/*, no Redis
// service anywhere. Lives in this package because its vitest config reaches
// the repo root (same reason as docs.spec.ts).
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(process.cwd(), '..', '..');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
describe('CI wiring (ADR 0006)', () => {
  const workflows = join(repoRoot, '.github', 'workflows');
  const workflow = (name: string) => readFileSync(join(workflows, name), 'utf8');

  it('mise.toml pins node, and bun and deno to exact versions', () => {
    const mise = readFileSync(join(repoRoot, 'mise.toml'), 'utf8');
    expect(mise).toMatch(/^node = "\d+"$/m);
    expect(mise).toMatch(/^bun = "\d+\.\d+\.\d+"$/m);
    expect(mise).toMatch(/^deno = "\d+\.\d+\.\d+"$/m);
  });

  it('verify.yml is the one workflow_call recipe, and both pr.yml and release.yml call it', () => {
    expect(workflow('verify.yml')).toMatch(/^on:\s*\n\s+workflow_call:/m);
    expect(workflow('pr.yml')).toContain('uses: ./.github/workflows/verify.yml');
    expect(workflow('release.yml')).toContain('uses: ./.github/workflows/verify.yml');
    expect(workflow('release.yml')).toMatch(/needs:\s*verify/);
  });

  it('pr.yml runs only on pull_request; release.yml only on push to main', () => {
    expect(workflow('pr.yml')).toMatch(/^on:\s*\n\s+pull_request:/m);
    expect(workflow('pr.yml')).not.toMatch(/^\s+push:/m);
    expect(workflow('release.yml')).toMatch(/^on:\s*\n\s+push:\s*\n\s+branches: \[main\]/m);
  });

  it('no workflow has a best-effort leg', () => {
    for (const f of readdirSync(workflows)) expect(workflow(f)).not.toContain('continue-on-error');
  });

  it('the runtime suite is a root script, not YAML', () => {
    const root = read(join(repoRoot, 'package.json'));
    expect(root.scripts['test:runtime']).toBe('node scripts/runtime-tests.mjs');
    expect(existsSync(join(repoRoot, 'scripts', 'runtime-tests.mjs'))).toBe(true);
  });

  // Two suites, two homes: the dev job runs `npm test` (unit + integration,
  // no Docker); every runtime leg builds, then runs only runtime-tests/*.
  it('the dev job runs npm test and every runtime leg builds then runs the runtime suite', () => {
    const verify = workflow('verify.yml');
    expect(verify).toMatch(/run: npm test\s*$/m);
    expect(verify).toMatch(/run: npm run test:runtime -- \$\{\{ matrix\.vitest \}\}/);
    const runtimeJob = verify.slice(verify.indexOf('\n  runtime:'));
    expect(runtimeJob.indexOf('run: npm run build')).toBeGreaterThan(-1);
    expect(runtimeJob.indexOf('run: npm run build')).toBeLessThan(runtimeJob.indexOf('run: npm run test:runtime'));
  });

  it('no workflow starts a Redis service or requires one', () => {
    for (const f of readdirSync(workflows)) {
      expect(workflow(f), f).not.toMatch(/^\s+services:/m);
      expect(workflow(f), f).not.toMatch(/REDIS_|image: redis/);
    }
  });
});
