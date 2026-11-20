import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import { RemoteReplEngine } from '../engine/remote-repl-engine';
import { RemoteReplInMemoryTransport } from '../transport/in-memory.transport';
import { REMOTE_REPL_TOPICS } from './constants';
import type { RemoteReplEvent } from './messages';

// The committed JSON Schema is the language-neutral contract (PROTOCOL.md).
// These samples are the exact shapes the engine publishes on the transport
// and writes into SSE `data:` lines; a schema that rejects any of them, or
// accepts the malformed variants, is wrong.
const schemaPath = join(__dirname, '..', '..', 'schema', 'protocol.schema.json');

describe('protocol JSON Schema (schema/protocol.schema.json)', () => {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ strict: false });
  ajv.addSchema(schema, 'protocol');
  const validate = (def: string, value: unknown) => ajv.validate(`protocol#/definitions/${def}`, value);

  it('accepts the command message the origin instance publishes on remote-repl:cmd', () => {
    expect(
      validate('RemoteReplCmdMessage', {
        channel: 'dev',
        commandId: 'cmd_1_ab12',
        command: 'get(CatService).findAll()',
        originInstanceId: 'inst_a',
      }),
    ).toBe(true);
  });

  it('rejects a command message with a missing field or a non-string command', () => {
    expect(validate('RemoteReplCmdMessage', { channel: 'dev', commandId: 'cmd_1', command: '1+1' })).toBe(false);
    expect(
      validate('RemoteReplCmdMessage', { channel: 'dev', commandId: 'cmd_1', command: 1, originInstanceId: 'a' }),
    ).toBe(false);
  });

  // Exactly what the engine emits (remote-repl-engine.ts emit/executeCommand,
  // onCmd's catch branch, and stream()'s heartbeat).
  const commandEvent = {
    id: 1,
    type: 'command',
    commandId: 'cmd_1_ab12',
    data: { command: 'const v = 10', instanceId: 'inst_a' },
  };
  const outputEvent = { id: 2, type: 'output', commandId: 'cmd_1_ab12', data: '10\n' };
  const doneEvent = { id: 3, type: 'system', commandId: 'cmd_1_ab12', data: { done: true } };
  const errorEvent = { id: 4, type: 'system', commandId: 'cmd_1_ab12', data: { error: 'boom' } };
  const pingEvent = { id: 0, type: 'system', commandId: null, data: { ping: true } };

  it('accepts a stray output chunk tagged with a null command id', () => {
    expect(validate('RemoteReplWireOutMessage', { channel: 'dev', event: { ...outputEvent, commandId: null } })).toBe(true);
  });

  it('rejects an event whose data does not match its type', () => {
    expect(validate('RemoteReplWireOutMessage', { channel: 'dev', event: { ...outputEvent, data: { chunk: 'x' } } })).toBe(false);
    expect(validate('RemoteReplWireOutMessage', { channel: 'dev', event: { ...commandEvent, data: { command: 'x' } } })).toBe(false);
    expect(validate('RemoteReplWireOutMessage', { channel: 'dev', event: { ...doneEvent, data: { done: false } } })).toBe(false);
    expect(validate('RemoteReplWireOutMessage', { channel: 'dev', event: { ...doneEvent, type: 'status' } })).toBe(false);
  });

  it('the heartbeat is an SSE-only event: valid in an SSE data line, never on the transport', () => {
    expect(validate('RemoteReplSseEvent', pingEvent)).toBe(true);
    expect(validate('RemoteReplWireOutMessage', { channel: 'dev', event: pingEvent })).toBe(false);
    expect(validate('RemoteReplTransportEvent', pingEvent)).toBe(false);
  });

  it('accepts claim and release system messages and rejects any other kind', () => {
    expect(validate('RemoteReplSysMessage', { channel: 'dev', kind: 'claim', instanceId: 'inst_a' })).toBe(true);
    expect(validate('RemoteReplSysMessage', { channel: 'dev', kind: 'release', instanceId: 'inst_a' })).toBe(true);
    expect(validate('RemoteReplSysMessage', { channel: 'dev', kind: 'heartbeat', instanceId: 'inst_a' })).toBe(false);
  });

  it('the RemoteReplTopic definition enumerates exactly the three transport topics', () => {
    for (const t of Object.values(REMOTE_REPL_TOPICS)) expect(validate('RemoteReplTopic', t)).toBe(true);
    expect(validate('RemoteReplTopic', 'remote-repl:other')).toBe(false);
  });

  // The samples above are hand-written; these are not. A drift between what
  // the engine really publishes and the committed schema (and so PROTOCOL.md
  // and every non-TS client) turns this red.
  it('accepts every message of a real engine run: cmd, out and sys topics, and the SSE events with a heartbeat', async () => {
    const transport = new RemoteReplInMemoryTransport();
    const wire: { topic: string; message: unknown }[] = [];
    for (const topic of Object.values(REMOTE_REPL_TOPICS)) {
      await transport.subscribe(topic, (m) => wire.push({ topic, message: JSON.parse(m) }));
    }
    const engine = new RemoteReplEngine(
      { enabled: true, instanceId: 'inst_schema', heartbeatInterval: 20 },
      transport,
      () => ({}),
      () => Date.now(),
      { warn: () => {}, error: () => {} },
    );
    await engine.start();
    const iter = engine.events('dev', null);
    const sse: RemoteReplEvent[] = [];
    // One end-of-command system event per command, plus one heartbeat.
    const ended = (e: RemoteReplEvent) => e.type === 'system' && e.commandId !== null;
    const pump = (async () => {
      while (sse.filter(ended).length < 2 || !sse.some((e) => e.id === 0)) {
        const { value, done } = await iter.next();
        if (done) return;
        sse.push(value);
      }
    })();
    await engine.dispatch('dev', '1 + 1');
    await engine.dispatch('dev', 'console.log("side effect"); undefinedName');
    await pump;
    await iter.return?.(undefined);
    await engine.stop();

    const definition: Record<string, string> = {
      [REMOTE_REPL_TOPICS.cmd]: 'RemoteReplCmdMessage',
      [REMOTE_REPL_TOPICS.out]: 'RemoteReplWireOutMessage',
      [REMOTE_REPL_TOPICS.sys]: 'RemoteReplSysMessage',
    };
    expect(new Set(wire.map((w) => w.topic))).toEqual(new Set(Object.values(REMOTE_REPL_TOPICS)));
    for (const { topic, message } of wire) {
      expect(validate(definition[topic], message), `${topic} ${JSON.stringify(message)}`).toBe(true);
    }
    for (const event of sse) {
      expect(validate('RemoteReplSseEvent', event), JSON.stringify(event)).toBe(true);
    }
  });

  // Every `data:` sample line the docs show a reader is a real SSE event.
  const repoRoot = join(__dirname, '..', '..', '..', '..');
  const docs = [
    'README.md',
    ...readdirSync(join(repoRoot, 'skills')).map((d) => join('skills', d, 'SKILL.md')),
    ...readdirSync(join(repoRoot, 'packages')).map((d) => join('packages', d, 'README.md')),
  ].filter((rel) => existsSync(join(repoRoot, rel)));
  const samples = docs.flatMap((rel) =>
    readFileSync(join(repoRoot, rel), 'utf8')
      .split('\n')
      .map((line, i) => ({ at: `${rel}:${i + 1}`, json: line.match(/^\s*data: (\{.*\})\s*$/)?.[1] }))
      .filter((s): s is { at: string; json: string } => s.json !== undefined),
  );

  it('finds the SSE samples of the docs (the skills teach the stream with them)', () => {
    expect(samples.length).toBeGreaterThan(0);
  });

  it.each(samples.map((s) => [s.at, s.json]))('the SSE sample at %s is a valid RemoteReplSseEvent', (_at, json) => {
    expect(validate('RemoteReplSseEvent', JSON.parse(json))).toBe(true);
  });
});
