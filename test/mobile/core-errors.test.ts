import { describe, expect, it, vi } from 'vitest';

import { createCore } from '../../src/mobile/core.js';
import { parser } from '../helpers/parser.js';

const rejections = vi.hoisted(() => [new Error('truncated message'), 'not an error']);

vi.mock('../../src/raw/parse-raw-mail.js', () => ({
  parseRawMail: () => Promise.reject(rejections.shift()),
}));

describe('the native core, when a parse rejects', () => {
  it('turns the rejection into a failed envelope, whatever was thrown', async () => {
    const core = createCore(parser);

    core.startParseRawMail('x', '{}');
    await Promise.resolve();
    await Promise.resolve();
    expect(JSON.parse(core.takeParsedMail())).toEqual({ ok: false, error: 'truncated message' });

    core.startParseRawMail('x', '{}');
    await Promise.resolve();
    await Promise.resolve();
    expect(JSON.parse(core.takeParsedMail())).toEqual({ ok: false, error: 'not an error' });
  });
});
