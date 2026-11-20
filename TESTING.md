# Testing strategy

This file says what the test suite is for, what to test, at which layer, and how to check that a test can catch anything. It applies to every contributor, human or agent.

It came out of the audit in #50. That audit found that a large part of the suite pinned wording and configuration. Those tests went red on deliberate edits and stayed green when the code drifted.

## The rule

A test earns its place when an ordinary future change can turn it red for a real reason.

Before writing a test, and when reviewing one, ask:

> What ordinary change, made by someone who is not thinking about this test, would turn it red for a real reason?

- **There is one.** Write or keep the test.
- **Only an edit of the exact line the test pins.** The test pins a one-off change: a rename, a removed feature, a config or CI decision. A reviewer sees that edit in the diff, so the test can only fail on purpose. Delete it before merge. If the decision needs a record, write an ADR in `docs/adr/` or explain it in the commit message.
- **Only an editorial edit** (wording, a heading, the order of sections). The test pins text. Replace it with a check against the real thing (see "Docs and skills"), or delete it.

Ordinary changes in this repo include:

- edits to the engine, the session, the shared handlers, a framework package or the UI;
- a new dependency, import, source file or export;
- a new package, skill or runtime app;
- a major bump of a dependency or a runtime (NestJS, Express, TypeScript, npm, Node, Bun, Deno);
- a rename or a signature change of a public export or option;
- a restructured CI workflow.

## Test-first, and its scope

Write the failing test first for new behaviour, for a bug fix and for a refactor that touches behaviour. A bug fix ships with the test that is red on the bug.

One-off changes, configuration and generated files are outside this rule. A scratch test can prove such a change while it is made. Delete it before merge, and check the change with the build, `npm pack`, the diff or the CI run.

When a test goes red for a real reason, fix the code. Change or delete a test only when the test itself is wrong: it pins a one-off, pins wording, repeats a test that belongs at another layer, or cannot fail. Give the reason in the commit message.

## Check that a test can fail

Do this for every new test before merge, and for any existing test whose value is in doubt:

1. Put the regression the test guards against into the code, doc or config. Run only that spec (`npx vitest run <file>` from the package directory). It must go red.
2. For a test that reads a doc, a manifest or a workflow, make an edit that changes the wording but not the meaning or the behaviour. It must stay green.
3. Revert both edits.

A test that stays green in step 1 cannot catch the regression. Fix it or delete it. A test that goes red in step 2 pins wording. Replace it.

[Stryker](https://stryker-mutator.io/docs/stryker-js/vitest-runner/) automates step 1 across a whole package. It suits a periodic audit, not a merge gate.

## Layers

Test each behaviour at the layer that owns it. Prefer the layer closest to what a consumer sees.

| Layer | What it proves | Where |
|---|---|---|
| Consumer seam | A real app with a real engine behaves as documented over HTTP and SSE: multi-instance ownership, the lease, replay, the `enabled` 404s | `packages/nestjs/test/`, `packages/express/test/*.suite.ts` (on both Express majors), `runtime-tests/*` |
| Engine and session | The logic, driven by the injected clock and the in-memory transport. Tests assert what an observer sees: which instance ran a command, how many times, which events and in what order | `packages/core/src/engine/`, `packages/core/src/session/` |
| Contracts | The wire protocol and the public API. Events captured from a real engine run validate against `packages/core/schema/protocol.schema.json`. A snapshot of each barrel's runtime exports shows every API change in the diff | `packages/core/src/protocol/`, `packages/core/src/index.spec.ts` |
| Artifacts | What npm ships. Each package is packed and the tarball checked: entry points resolve, `LICENSE` is present, no build leftovers | the packaging specs |
| Docs and skills | Code samples compile against the built types, referenced paths exist, deliberate copies stay identical | `packages/nestjs/src/docs.spec.ts`, `packages/nestjs/src/packaging.spec.ts` |
| Fences | Rules that ordinary work can break without noticing: a package's allowed dependencies and imports, Node-only types in core, the shape of a runtime app | `packages/*/src/package-boundary.spec.ts`, `packages/core/src/runtime-portability.spec.ts` |

A behaviour tested at two layers costs two edits on every change. Keep it at the layer that owns the code and delete the copy. Consumer-seam scenarios are the exception: they may overlap with unit tests, because wiring bugs show up only there.

## Security invariants

The three invariants in `AGENTS.md` get the strongest tests in the suite.

- Each invariant is tested at every layer it lives in: the engine, the shared handlers, and each framework package on all five routes.
- Inputs are adversarial, with more than one sample. For the UI that means close tags in any case and with whitespace (`</SCRIPT >`), channel names that need URL encoding, and output that contains HTML.
- Assertions run on the parsed result (the number of `<script>` elements, the DOM nodes created), never on the presence of a string.

## Types

`npm run typecheck` covers specs, test helpers and examples, not only the build sources. A public export renamed in the code but still used under its old name in a spec or an example must fail the typecheck.

`expectTypeOf` does nothing at runtime ([Vitest](https://v2.vitest.dev/api/expect-typeof)). Type assertions go in `*.test-d.ts` files, run with `vitest --typecheck`.

## Docs and skills

Docs and skills are tested against the code, never for wording.

- Every TypeScript code fence that imports a repo package compiles against the built `dist` types, so a renamed export or option turns it red.
- Every repo path a doc names exists.
- Expected values come from the code. To check that a skill shows the completion event, capture the real event from an engine run and look for that JSON.
- The two NestJS skills share two sections byte for byte, and a test keeps the copies equal.

Headings, word lists and section order are editorial choices. Reviewers check them; the suite does not.

## Patterns to replace

| Pattern | Why it fails | Replace with |
|---|---|---|
| A wording pin on a doc or skill | Red on an editorial edit, green on API drift | Typechecked code fences; expected text derived from the code |
| A `package.json` string compared with a literal | Green when the file it names is missing from the tarball | Pack and inspect the tarball ([publint](https://publint.dev/docs/), [`attw --pack`](https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/packages/cli/README.md)) |
| A literal version or inventory ("exactly five packages", `^1.`) | Red on a legitimate major or a new package | A value derived from the tree or the manifests, or nothing |
| A grep of source or YAML for a behaviour | Misses equivalent forms (`require`, `\|\| true`), red on a quote change | A test of the behaviour, or a parse of the file |
| A test that cannot fail (`expectTypeOf` without `--typecheck`, a regex that matches every file) | Reports coverage that does not exist | A fix that makes step 1 go red, or deletion |
| A test that reads private fields through `as any` | Pins the implementation and keeps engine members off `#private` | An assertion on the observable outcome |
| One behaviour pinned in several specs | One change, many red tests | One test, at the owning layer |

## Out of scope by design

- **A real Redis server.** CI runs no services (ADR 0006). The transports run against `ioredis-mock` and a fake node-redis client. A type-level test checks that the real client types satisfy the `*Like` interfaces.
- **One-off decisions.** ADRs record them.

## Open decisions

This section lists what the draft leaves open. Remove each item once it is decided.

- **Where repo-level checks live.** The docs, CI and workspace checks sit in `packages/nestjs/src/` today. A root Vitest project is the alternative.
- **New devDependencies.** publint and `@arethetypeswrong/cli` for artifacts; an HTML parser or DOM for the UI tests; a headless browser for one end-to-end UI test.
- **Fastify.** `AGENTS.md` says the NestJS package works on Fastify, and the #50 audit found that it fails at boot. Either add a Fastify leg or remove the claim.
- **NestJS 10.** The peer range includes it and no leg runs it. Either add a leg (like the `express4` alias) or narrow the range.
