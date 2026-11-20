import { JSDOM } from 'jsdom';
import { renderReplUi } from './repl-ui.html';

describe('renderReplUi', () => {
  const html = renderReplUi('main');

  it('places the Run bar between the output and the editor', () => {
    const out = html.indexOf('id="out"');
    const bar = html.indexOf('id="bar"');
    const editor = html.indexOf('id="editor"');
    expect(out).toBeGreaterThanOrEqual(0);
    expect(bar).toBeGreaterThan(out);
    expect(editor).toBeGreaterThan(bar);
  });

  it('sizes the app to the dynamic viewport so the bar is not clipped on mobile', () => {
    expect(html).toContain('100dvh');
  });

  it('enlarges Run and hides the Ctrl+Enter hint on narrow screens', () => {
    expect(html).toMatch(/@media\s*\(max-width:\s*600px\)/);
    expect(html).toMatch(/#run\s+\.kbd-hint\s*\{\s*display:\s*none/);
    expect(html).toMatch(/min-height:\s*44px/);
  });

  it('wraps the bar as whole items and gives Run its own full-width row on mobile', () => {
    // Prevents the crammed "Run" over "▶" / "channel:" over "dev" wrapping.
    expect(html).toMatch(/#bar\{[^}]*flex-wrap:\s*wrap/);
    expect(html).toMatch(/#bar>span\{[^}]*white-space:\s*nowrap/);
    expect(html).toContain('class="run-wrap"');
    expect(html).toMatch(/\.run-wrap\{[^}]*flex:\s*1 0 100%/);
  });

  it('rebalances the editor to a usable height on narrow screens', () => {
    // Mobile gives the editor a floor so it is not a thin strip under a huge
    // output pane.
    expect(html).toMatch(/#editor\{[^}]*min-height:\s*200px/);
  });

  it('loads the Monaco loader from a relative vs path', () => {
    expect(html).toContain('src="vs/loader.js"');
  });

  it('derives the require.config vs base from document.baseURI', () => {
    expect(html).toMatch(/paths:\s*\{\s*vs:\s*new URL\('vs',\s*document\.baseURI\)\.href\s*\}/);
  });
});

// Security invariant 2 (AGENTS.md): the channel name is attacker-controlled
// (a URL path segment) and SSE payloads are command output. The page is
// loaded the way a browser loads it: the HTML parser first, then the inline
// script, with EventSource, fetch and Monaco stubbed.
describe('renderReplUi in a DOM (security invariant 2)', () => {
  type FakeEventSource = { url: string; onmessage?: (m: { data: string }) => void };

  const load = (channel: string) => {
    const streams: FakeEventSource[] = [];
    const posts: string[] = [];
    const dom = new JSDOM(renderReplUi(channel), {
      url: 'http://localhost/repl/x/ui',
      runScripts: 'dangerously',
      beforeParse(window) {
        const w = window as unknown as Record<string, unknown>;
        w.EventSource = class {
          constructor(public url: string) {
            streams.push(this as unknown as FakeEventSource);
          }
          close() {}
        };
        w.fetch = async (url: string) => {
          posts.push(String(url));
          return {};
        };
        const editor = { value: '1 + 1', getValue() { return this.value; }, setValue(v: string) { this.value = v; }, addCommand() {} };
        w.monaco = { editor: { create: () => editor }, KeyMod: { CtrlCmd: 0 }, KeyCode: { Enter: 0 } };
        w.require = Object.assign((_deps: string[], ready: () => void) => ready(), { config: () => {} });
      },
    });
    const { document } = dom.window;
    return { dom, document, streams, posts, out: document.getElementById('out')! };
  };

  const pwn = 'window.pwned=1';
  it.each([
    `</script><img src=x onerror=${pwn}>`,
    `</SCRIPT ><img src=x onerror=${pwn}>`,
    `</ScRiPt/><img src=x onerror=${pwn}>`,
    `<!--<script>${pwn}</script>-->`,
    'line\u2028and\u2029paragraph separators',
    'spaces / slashes ? query # hash %20 & "quotes" \'apostrophes\'',
  ])('a channel named %j stays one string: no markup injected, the script runs with the exact name', (channel) => {
    const { dom, document, streams } = load(channel);
    expect(document.querySelectorAll('script')).toHaveLength(2);
    expect(document.querySelector('img')).toBeNull();
    expect((dom.window as unknown as { pwned?: number }).pwned).toBeUndefined();
    // The inline script ran and saw the exact name: it opens the stream at
    // the URL-encoded channel.
    expect(streams.map((s) => s.url)).toEqual(['../' + encodeURIComponent(channel)]);
  });

  it('posts commands to the URL-encoded channel', async () => {
    const channel = 'a b/c?d#e';
    const { document, posts } = load(channel);
    document.getElementById('run')!.dispatchEvent(new document.defaultView!.Event('click'));
    await new Promise((r) => setTimeout(r, 0));
    expect(posts).toEqual(['../' + encodeURIComponent(channel)]);
  });

  it('renders every SSE payload as text, never as markup', () => {
    const { document, streams, out } = load('dev');
    const html = `<img src=x onerror=${pwn}><b>bold</b>`;
    const send = (event: object) => streams[0].onmessage!({ data: JSON.stringify(event) });
    send({ id: 1, type: 'command', commandId: 'c1', data: { command: html, instanceId: html } });
    send({ id: 2, type: 'output', commandId: 'c1', data: html });
    send({ id: 3, type: 'system', commandId: 'c1', data: { error: html } });
    send({ id: 4, type: 'system', commandId: null, data: { notice: html } });

    expect(out.querySelector('img, b')).toBeNull();
    expect(document.getElementById('owner')!.querySelector('img, b')).toBeNull();
    expect(out.textContent!.split(html).length - 1).toBe(4);
  });
});
