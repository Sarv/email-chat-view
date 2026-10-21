import { describe, expect, it } from 'vitest';

import { bytesFromBinary, createCore } from '../../src/mobile/core.js';
import type { Mail } from '../../src/types.js';
import { parser } from '../helpers/parser.js';

const MARCH_3 = Date.UTC(2025, 2, 3, 10, 0, 0);

const mails: Mail[] = [
  {
    id: '1',
    fromAddress: 'ann@acme.example',
    date: MARCH_3,
    body: '<div>Hello <b>there</b></div>',
  },
];

/** Let a parse that settles in microtasks settle, as the engines do between calls. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const RAW = [
  'From: "Lee, Ann" <ann@acme.example>',
  'Date: Tue, 06 Oct 2026 10:00:00 +0000',
  'Content-Type: text/plain; charset=iso-8859-1',
  '',
  'Caf\xe9',
].join('\r\n');

describe('the native core', () => {
  it('answers a messages request with an envelope of chat messages', () => {
    const core = createCore(parser);
    const reply = JSON.parse(core.messages(JSON.stringify({ mails, containsThreadStart: true })));
    expect(reply).toMatchObject({
      ok: true,
      value: [{ id: '1', body: '<div>Hello <b>there</b></div>' }],
    });
  });

  it('passes every option through, plain text included', () => {
    const core = createCore(parser);
    const reply = JSON.parse(
      core.messages(
        JSON.stringify({
          mails,
          bodyFormat: 'text',
          currentUserAddress: ['ann@acme.example'],
          includeDrafts: true,
          containsThreadStart: false,
        }),
      ),
    );
    expect(reply.value[0]).toMatchObject({ body: 'Hello there', isFromMe: true });
  });

  // Regression: an exception thrown inside the engine reaches native as an
  // opaque failure or not at all. It has to arrive as data.
  it('reports a bad request as a failed envelope instead of throwing', () => {
    const core = createCore(parser);
    expect(JSON.parse(core.messages('not json'))).toMatchObject({ ok: false });
    expect(JSON.parse(core.messages('{}')).ok).toBe(false);
  });

  it('parses raw bytes sent as a binary string, collected on the next call', async () => {
    const core = createCore(parser);
    core.startParseRawMail(RAW, JSON.stringify({ id: 'eml-1' }));
    await settle();
    const reply = JSON.parse(core.takeParsedMail());
    expect(reply).toMatchObject({
      ok: true,
      value: { id: 'eml-1', fromName: 'Lee, Ann', body: '<div>Café</div>' },
    });
  });

  it('reports pending once the result is taken, and before any parse', async () => {
    const core = createCore(parser);
    expect(JSON.parse(core.takeParsedMail())).toEqual({
      ok: false,
      error: 'pending: no parse has settled',
    });
    core.startParseRawMail(RAW, '{}');
    await settle();
    core.takeParsedMail();
    expect(JSON.parse(core.takeParsedMail()).error).toMatch(/^pending/);
  });

  it('reports a bad parse request as a failed envelope', () => {
    const core = createCore(parser);
    core.startParseRawMail(RAW, 'not json');
    expect(JSON.parse(core.takeParsedMail())).toMatchObject({ ok: false });
  });
});

describe('bytesFromBinary', () => {
  it('takes one byte from each char', () => {
    expect(Array.from(bytesFromBinary('A\xe9ǿ'))).toEqual([0x41, 0xe9, 0xff]);
  });
});
