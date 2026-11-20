// The one CI rule that ordinary workflow edits can break without anyone
// noticing: release.yml publishes only behind verify.yml (ADR 0006). Lives in
// this package because its vitest config reaches the repo root (same reason
// as docs.spec.ts).
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(process.cwd(), '..', '..');
const workflow = (name: string) => readFileSync(join(repoRoot, '.github', 'workflows', name), 'utf8');

describe('CI wiring (ADR 0006)', () => {
  it('verify.yml is the one workflow_call recipe, and both pr.yml and release.yml call it', () => {
    expect(workflow('verify.yml')).toMatch(/^on:\s*\n\s+workflow_call:/m);
    expect(workflow('pr.yml')).toContain('uses: ./.github/workflows/verify.yml');
    expect(workflow('release.yml')).toContain('uses: ./.github/workflows/verify.yml');
    expect(workflow('release.yml')).toMatch(/needs:\s*verify/);
  });
});
