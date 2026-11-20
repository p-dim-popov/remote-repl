import { join } from 'node:path';
import ts from 'typescript';

// @remote-repl/core runs on Node, Bun and Deno (ADR 0006). A consumer on
// Bun or Deno compiles against core's declarations, where the `NodeJS.*`
// type namespace (NodeJS.Timeout, NodeJS.Timer, ...) only exists with
// @types/node. `ReturnType<typeof setTimeout>` is the portable spelling.
// The declarations are emitted in memory, so no build is needed; a private
// member is emitted untyped and may use whatever it likes.
describe('@remote-repl/core runtime portability', () => {
  const declarations = (): Map<string, string> => {
    const configPath = join(process.cwd(), 'tsconfig.build.json');
    const config = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      },
    })!;
    const program = ts.createProgram(config.fileNames, {
      ...config.options,
      composite: false,
      incremental: false,
      tsBuildInfoFile: undefined,
      declaration: true,
      emitDeclarationOnly: true,
      noEmit: false,
    });
    const out = new Map<string, string>();
    program.emit(undefined, (name, text) => {
      if (name.endsWith('.d.ts')) out.set(name, text);
    });
    return out;
  };

  it('emits no declaration that uses the NodeJS.* type namespace', () => {
    const emitted = declarations();
    expect(emitted.size).toBeGreaterThan(0);
    const offenders = [...emitted].filter(([, text]) => /\bNodeJS\./.test(text)).map(([name]) => name);
    expect(offenders).toEqual([]);
  }, 60_000);
});
