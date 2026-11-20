---
'@remote-repl/nestjs': patch
---

The browser UI now loads its Monaco editor on NestJS 10. The asset route used the Express 5 wildcard (`*path`), which NestJS 10, on Express 4, never matched, so every `vs/` asset answered 404. The route now uses the wildcard of the installed NestJS major.
