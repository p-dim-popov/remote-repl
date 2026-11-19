# remote-repl

A live, in-process REPL that an application exposes over HTTP. One engine runs
inside the host app and speaks one protocol, so any web framework and any
message transport can carry it. This glossary is the vocabulary shared by the
spec, the tickets, the code and the docs.

## Language

**Engine**:
The framework-free core that owns channels, runs commands, and fans output out
to subscribers. One engine runs per application instance.
_Avoid_: service, core service, REPL server

**Channel**:
A user-chosen name for one REPL session with its own variables and history.
Channels are how people and tabs share or separate REPL state.
_Avoid_: session (that is what a channel contains), room

**Session**:
The live REPL process behind one channel on its owner instance. A session
exists only on the owner and dies with it.
_Avoid_: REPL, context (the globals a session starts with)

**Context**:
The set of globals a session starts with, built once per session on the owner.
The host app supplies it, and a framework package adds the native objects of
its framework.
_Avoid_: scope, globals (bare), environment

**Helper**:
A function that the NestJS package puts in the context to work with the DI
container, for example `get`, `$` and `resolve`. Express has no helpers.
_Avoid_: native function, built-in, command

**Instance**:
One running process of an application that embeds the engine. Replicas behind a
load balancer are separate instances.
_Avoid_: node, replica (use only for instances of the same app)

**Cluster**:
The set of instances that share one transport namespace and therefore see the
same channels.
_Avoid_: fleet, group

**Owner**:
The single instance that holds the session of a channel and executes its
commands. Every other instance only relays.
_Avoid_: leader, master, primary

**Origin**:
The instance whose HTTP endpoint received a command. The origin publishes the
command, and the owner executes it.
_Avoid_: sender, source

**Transport**:
The pub/sub medium that carries protocol messages between the instances of a
cluster: in-memory for one process, Redis for many. A transport moves opaque
strings and never parses them.
_Avoid_: adapter (the historical name; `nestjs-web-repl` keeps it only in its
deprecated aliases), bus, broker

**Framework package**:
The package that wires the engine to one web framework, for example the NestJS
or Express package: its HTTP routes and the native objects of the framework in
the context. It contains no engine or route logic.
_Avoid_: adapter (the historical name), integration, plugin, binding

**Shared handler layer**:
The framework-free route logic in the core that every framework package calls:
landing, post, stream, UI and asset. It owns SSE formatting, cursor stamping,
UI escaping and the asset path guard.
_Avoid_: controller, handlers (bare), middleware

**Lease**:
The time-limited ownership of a channel. The owner renews it by heartbeat, and
a lease that is not renewed within its TTL makes the channel ownerless.
_Avoid_: lock, grant

**Claim**:
The protocol message an instance publishes to take or renew ownership of a
channel. A repeated claim is the owner heartbeat.
_Avoid_: acquire, announce

**Release**:
The protocol message an owner publishes to give up a channel, for example on
clean shutdown or after the session TTL.
_Avoid_: unclaim, drop

**Takeover**:
The act of the origin instance claiming a channel whose lease has expired. The
takeover starts a fresh session, so the old variables are gone.
_Avoid_: failover, preemption (a takeover of a live owner, which must never
happen)

**Owner heartbeat**:
The periodic claim an owner re-publishes for every channel it owns to keep the
lease alive. Not the SSE ping.
_Avoid_: keep-alive, heartbeat (bare, ambiguous with the SSE ping)

**SSE ping**:
The periodic client-visible event that keeps an idle SSE connection open. It
never changes the replay cursor of the client.
_Avoid_: heartbeat (bare), keep-alive

**Topic**:
One of the three fixed names on the transport: command, output and system
messages.
_Avoid_: queue, stream (reserved for the SSE stream)

**Topic prefix**:
An optional string a transport prepends to every topic name so that several
apps can share one medium without seeing each other. Instances with the same
prefix form one cluster.
_Avoid_: namespace, tenant key

**Protocol**:
The versioned, language-neutral contract that defines the topics, the message
shapes, the ownership and lease rules, and the SSE event format. Any
implementation that follows it can join a cluster.
_Avoid_: API, wire format (only one part of the protocol)

**Replay**:
The re-delivery of buffered channel events to an SSE client that reconnects
with a cursor. The buffer per channel is bounded.
_Avoid_: catch-up, history

**UI bundle**:
The static Monaco editor asset tree (`vs/`) that the core copies from
`monaco-editor` at build time and every framework package serves, unchanged, from the
own origin of the app under `<base>/<channel>/vs/*`. It is the only static
part of the browser UI; the page itself is the UI page.
_Avoid_: frontend, web app, Monaco (the editor, not the tree), static UI

**UI page**:
The small HTML template in the core that a framework package
renders per request for `<base>/<channel>/ui`. It inlines the channel name
into an inline script with script-context escaping and loads the editor from
the UI bundle. It is not a static file: another implementation must port the
template and its escaping rules (protocol §7).
_Avoid_: UI bundle (the asset tree), index.html, static page

**Shim**:
The `nestjs-web-repl` package: the legacy name that keeps every 2.3.x name as
a deprecated alias of the NestJS package and the Redis transports. Its only
logic is the translation of the legacy `adapter` option to `transport`.
_Avoid_: legacy package, wrapper, compatibility layer

**Legacy alias**:
A 2.3.x export name that the shim keeps, marked deprecated, as another name
for its replacement in an `@remote-repl` package.
_Avoid_: old name, backwards-compat export

**Enabled flag**:
The runtime switch that, when off, makes every route return 404 and keeps the
engine off the transport. It is a switch, not an access control.
_Avoid_: feature flag, auth
