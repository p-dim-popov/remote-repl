import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { REMOTE_REPL_DEFAULTS } from '@remote-repl/core';

// Repo-level documentation checked against the code and the tree, never
// against its own wording (TESTING.md, "Docs and skills"). Lives in this
// package because its vitest config reaches the repo root.
const repoRoot = join(process.cwd(), '..', '..');
const readDoc = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');
const packageDirs = readdirSync(join(repoRoot, 'packages'));

// Path-like tokens in backticks (`packages/core/src/...`) or in relative
// markdown links (`](./examples/stackblitz)`). Root-anchored prefixes are
// checked from the repo root. Package-relative prefixes (`src/...`,
// `test/...`, `example/...`, `scripts/...`, `schema/...`) resolve against the
// package whose `- \`packages/<name>/\`` list item they sit under, and
// against any package elsewhere. Globs are checked up to the first `*`;
// build outputs (`dist/`) and generic placeholders (`<name>`) are skipped.
const ROOT_PREFIX = /^(packages|runtime-tests|docs|skills|examples|\.github)\//;
const PACKAGE_PREFIX = /^(src|test|example|scripts|schema)\//;
const PATH_CHARS = /^[\w./*-]+$/;
const PACKAGE_ITEM = /^- `packages\/([\w-]+)\/`/;

type Reference = { path: string; pkg?: string };

function referencedPaths(markdown: string): Reference[] {
  const out = new Map<string, Reference>();
  let pkg: string | undefined;
  for (const line of markdown.split('\n')) {
    if (/^#/.test(line) || /^- /.test(line)) pkg = line.match(PACKAGE_ITEM)?.[1];
    const tokens = [...line.matchAll(/`([^`\n]+)`/g), ...line.matchAll(/\]\(\.\/([^)#\s]+)/g)].map((m) => m[1]);
    for (const token of tokens) {
      const path = token.replace(/\/$/, '');
      if (!PATH_CHARS.test(path)) continue;
      if (!ROOT_PREFIX.test(path) && !PACKAGE_PREFIX.test(path)) continue;
      const ref = { path: path.split('*')[0].replace(/\/$/, ''), pkg: PACKAGE_PREFIX.test(path) ? pkg : undefined };
      out.set(`${ref.pkg}:${ref.path}`, ref);
    }
  }
  return [...out.values()];
}

function exists({ path, pkg }: Reference): boolean {
  if (pkg) return existsSync(join(repoRoot, 'packages', pkg, path));
  if (existsSync(join(repoRoot, path))) return true;
  return PACKAGE_PREFIX.test(path) && packageDirs.some((p) => existsSync(join(repoRoot, 'packages', p, path)));
}

describe.each(['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'TESTING.md'])('%s', (doc) => {
  it('references only paths that exist in the tree', () => {
    const missing = referencedPaths(readDoc(doc))
      .filter((ref) => !exists(ref))
      .map((ref) => (ref.pkg ? `packages/${ref.pkg}/${ref.path}` : ref.path));
    expect(missing).toEqual([]);
  });
});

describe('README.md', () => {
  const readme = readDoc('README.md');

  it('has the skills.sh install command of every skill', () => {
    for (const dir of readdirSync(join(repoRoot, 'skills'))) {
      expect(readme).toContain(`npx skills add p-dim-popov/remote-repl/skills/${dir}`);
    }
  });

  // The options table states every engine default; it must state the real one.
  it('the options table gives every REMOTE_REPL_DEFAULTS value', () => {
    const table = readme.slice(readme.indexOf('## Options'), readme.indexOf('### NestJS extras'));
    for (const [name, value] of Object.entries(REMOTE_REPL_DEFAULTS)) {
      const row = table.split('\n').find((line) => line.startsWith(`| \`${name}\``));
      expect(row, `no options row for ${name}`).toBeDefined();
      const cells = row!.split('|').map((c) => c.trim());
      const stated = cells[3].match(/`([\d_]+)`/)?.[1];
      expect(stated && Number(stated.replace(/_/g, '')), name).toBe(value);
    }
  });
});

// Every TypeScript code sample that imports a repo package compiles against
// the packages' public barrels, so a renamed export or option fails here
// instead of in a reader's editor. Names a sample leaves to the reader
// (`catService`, `requireAdmin`, a local `./admin.guard`) are declared `any`;
// a third-party module that is not installed becomes an `any` module.
describe('TypeScript code samples in the docs', () => {
  const REPO_MODULES: Record<string, string> = {
    '@remote-repl/core': 'packages/core/src/index.ts',
    '@remote-repl/nestjs': 'packages/nestjs/src/index.ts',
    '@remote-repl/express': 'packages/express/src/index.ts',
    '@remote-repl/redis': 'packages/redis/src/index.ts',
    'nestjs-web-repl': 'packages/nestjs-web-repl/src/index.ts',
    'nestjs-web-repl/redis': 'packages/nestjs-web-repl/src/redis.ts',
  };
  const IMPORTS_REPO_MODULE = /from ['"](@remote-repl\/[\w-]+|nestjs-web-repl(?:\/redis)?)['"]/;
  const docs = [
    'README.md',
    ...readdirSync(join(repoRoot, 'skills')).map((d) => join('skills', d, 'SKILL.md')),
    ...packageDirs.map((d) => join('packages', d, 'README.md')),
  ].filter((rel) => existsSync(join(repoRoot, rel)));

  type Sample = { at: string; file: string; code: string };
  const samples: Sample[] = docs.flatMap((rel) => {
    const lines = readDoc(rel).split('\n');
    const found: Sample[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^```(ts|typescript)\s*$/.test(lines[i])) continue;
      const start = i + 1;
      let end = start;
      while (end < lines.length && !/^```\s*$/.test(lines[end])) end++;
      const code = lines.slice(start, end).join('\n');
      if (IMPORTS_REPO_MODULE.test(code)) {
        const at = `${rel}:${i + 1}`;
        found.push({ at, file: join(repoRoot, '.doc-samples', `${at.replace(/[^\w]+/g, '_')}.ts`), code });
      }
      i = end;
    }
    return found;
  });

  // `import { A, B } from './local'` names files the reader has, not us.
  const withoutLocalImports = (code: string) =>
    code.replace(/^import\s+\{([^}]+)\}\s+from\s+['"]\.{1,2}\/[^'"]+['"];?\s*$/gm, (_m, names: string) =>
      `declare const ${names.split(',').map((n) => `${n.trim()}: any`).join(', ')};`,
    );

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    types: ['node'],
    strict: true,
    esModuleInterop: true,
    experimentalDecorators: true,
    skipLibCheck: true,
    noEmit: true,
    baseUrl: repoRoot,
    paths: Object.fromEntries(Object.entries(REPO_MODULES).map(([name, path]) => [name, [path]])),
  };
  // "Cannot find name", "Did you mean", "No value exists in scope for the shorthand property".
  const CANNOT_FIND_NAME = new Set([2304, 2552, 18004]);
  const CANNOT_FIND_MODULE = new Set([2307]);

  // Compile all samples in one program; declare the names and third-party
  // modules they leave open, then compile again until nothing new is open.
  const compile = () => {
    const sources = new Map(samples.map((s) => [s.file, withoutLocalImports(s.code)]));
    const ambient = join(repoRoot, '.doc-samples', 'ambient.d.ts');
    const anyModules = new Set<string>();
    for (let round = 0; ; round++) {
      const files = new Map(sources);
      files.set(ambient, [...anyModules].map((m) => `declare module '${m}';`).join('\n'));
      const host = ts.createCompilerHost(options);
      const getSourceFile = host.getSourceFile.bind(host);
      host.getSourceFile = (name, lang, ...rest) =>
        files.has(name) ? ts.createSourceFile(name, files.get(name)!, lang) : getSourceFile(name, lang, ...rest);
      const fileExists = host.fileExists.bind(host);
      host.fileExists = (name) => files.has(name) || fileExists(name);
      const readFile = host.readFile.bind(host);
      host.readFile = (name) => files.get(name) ?? readFile(name);
      const program = ts.createProgram([...files.keys()], options, host);

      const errors = samples.map((s) => ({
        sample: s,
        diagnostics: [
          ...program.getSyntacticDiagnostics(program.getSourceFile(s.file)),
          ...program.getSemanticDiagnostics(program.getSourceFile(s.file)),
        ],
      }));
      let opened = false;
      for (const { sample, diagnostics } of errors) {
        for (const d of diagnostics) {
          const text = ts.flattenDiagnosticMessageText(d.messageText, '\n');
          const quoted = text.match(/'([^']+)'/)?.[1];
          if (!quoted) continue;
          if (CANNOT_FIND_NAME.has(d.code) && !sources.get(sample.file)!.includes(`declare const ${quoted}: any;`)) {
            sources.set(sample.file, `declare const ${quoted}: any;\n${sources.get(sample.file)}`);
            opened = true;
          } else if (CANNOT_FIND_MODULE.has(d.code) && !(quoted in REPO_MODULES) && !anyModules.has(quoted)) {
            anyModules.add(quoted);
            opened = true;
          }
        }
      }
      if (!opened || round === 5) {
        return errors.map(({ sample, diagnostics }) => ({
          at: sample.at,
          messages: diagnostics.map((d) => {
            const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line : 0;
            const code = sources.get(sample.file)!.split('\n')[line]?.trim();
            return `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')} (in: ${code})`;
          }),
        }));
      }
    }
  };

  it('finds the samples (README, the skills and the package READMEs)', () => {
    expect(samples.map((s) => s.at.split(':')[0])).toEqual(expect.arrayContaining(['README.md', join('skills', 'remote-repl-express', 'SKILL.md')]));
  });

  it(
    'every sample compiles against the public API',
    () => {
      const failing = compile().filter((r) => r.messages.length > 0);
      expect(failing).toEqual([]);
    },
    60_000,
  );
});
