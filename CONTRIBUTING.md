# Contributing

Thanks for your interest in `nestjs-web-repl`. Contributions from humans and
from people using AI tools are both welcome. The one firm rule is **honesty
about how the work was produced** — see the AI policy below.

## Ground rules

- **Tests must stay green.** Run `npm test`, `npm run build`,
  `npm run typecheck`, `npm run schema:check` and `npm run check:packages`
  before opening a PR. [`TESTING.md`](./TESTING.md) says which tests are
  worth adding and how to check that a new one can fail. When a test goes
  red for a real reason, fix the code, not the test.
- **Read [`AGENTS.md`](./AGENTS.md)** first — it documents the build/test flow,
  the project layout, the security invariants, and the `node:repl` gotchas.
- **Don't regress the security invariants.** In particular, `enabled` must stay
  enforced at runtime, and the UI must keep escaping the channel name. This
  library exposes an arbitrary-code-execution surface by design.
- Keep changes focused; match the existing style.

## AI-assisted contributions: welcome, but disclose

This project was itself built with AI assistance, so we are not anti-AI. But
undisclosed AI authorship erodes reviewer trust and muddies provenance, so we
ask for the same transparency we hold ourselves to:

- **Disclose AI involvement** in any PR where an AI tool wrote or substantially
  shaped the code — a line in the PR description (e.g. "Drafted with <tool>,
  reviewed and tested by me") and/or a `Co-Authored-By:` trailer on the commits
  is enough.
- **You own what you submit.** Whether or not you used AI, you must understand
  your change well enough to explain and maintain it, and you must have the
  right to contribute it under this project's MIT license. "The AI wrote it" is
  not an answer to a review question.
- Purely mechanical AI help (formatting, rename refactors) needs no disclosure.

We don't gate on *whether* AI was used — only on disclosure, comprehension, and
the code meeting the bar. Reviewers who prefer to evaluate AI-assisted PRs more
skeptically are free to; disclosure is what makes that possible.

## Reporting security issues

Because the REPL endpoints execute arbitrary code, treat auth/exposure issues
seriously. For anything sensitive, open a minimal issue asking for a private
channel rather than posting details publicly.
