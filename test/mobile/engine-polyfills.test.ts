import { describe, expect, it } from 'vitest';

import {
  decodeUtf8,
  engineAtob,
  EngineBlob,
  EngineTextDecoder,
  EngineTextEncoder,
  engineHasOwn,
  installEnginePolyfills,
} from '../../src/mobile/engine-polyfills.js';

/**
 * Every stand-in is checked against the real thing Node ships, so "what a
 * browser would have decoded" is the spec rather than a hand-written expectation.
 */
const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

const MALFORMED_UTF8: Uint8Array[] = [
  bytes(0x80), // lone continuation
  bytes(0xc0, 0x80), // overlong lead
  bytes(0xc3), // truncated at end
  bytes(0xc3, 0x41), // truncated mid-stream
  bytes(0xe0, 0x80, 0x80), // overlong three-byte
  bytes(0xed, 0xa0, 0x80), // encoded surrogate
  bytes(0xf0, 0x80, 0x80, 0x80), // overlong four-byte
  bytes(0xf4, 0x90, 0x80, 0x80), // above U+10FFFF
  bytes(0xf5, 0x41), // never a lead
  bytes(0xe2, 0x82), // truncated three-byte
  bytes(0xf0, 0x9f, 0x98), // truncated four-byte
];

describe('EngineTextDecoder', () => {
  it('decodes UTF-8 exactly as the platform does, BOM and astral planes included', () => {
    const text = '﻿Hi café — 日本 😀';
    const encoded = new TextEncoder().encode(text);
    expect(new EngineTextDecoder().decode(encoded)).toBe(new TextDecoder().decode(encoded));
  });

  // Regression: a "UTF-8" mail with one stray Latin-1 byte is common. Each bad
  // sequence must cost exactly one U+FFFD, the way a browser shows it.
  it.each(MALFORMED_UTF8.map((input) => [Array.from(input).join(' '), input] as const))(
    'replaces malformed UTF-8 the way the platform does: %s',
    (_, input) => {
      expect(decodeUtf8(input)).toBe(new TextDecoder().decode(input));
    },
  );

  // Spelled out from the WHATWG index rather than asked of the platform: Node
  // 20's own TextDecoder decodes 0x80-0x9F as Latin-1 control characters.
  it('decodes every Windows-1252 byte per the Encoding Standard, under its Latin-1 labels too', () => {
    const all = Uint8Array.from({ length: 256 }, (_, index) => index);
    const latin1 = (from: number, to: number): string =>
      String.fromCharCode(...all.slice(from, to + 1));
    const high = '€\x81‚ƒ„…†‡ˆ‰Š‹Œ\x8dŽ\x8f' + '\x90‘’“”•–—˜™š›œ\x9džŸ';
    const expected = `${latin1(0x00, 0x7f)}${high}${latin1(0xa0, 0xff)}`;
    expect(new EngineTextDecoder('windows-1252').decode(all)).toBe(expected);
    expect(new EngineTextDecoder(' ISO-8859-1 ').decode(all)).toBe(expected);
    expect(new EngineTextDecoder('us-ascii').encoding).toBe('windows-1252');
  });

  /** Code units as bytes in one byte order. */
  const utf16 = (units: number[], littleEndian: boolean): Uint8Array => {
    const buffer = new Uint8Array(units.length * 2);
    const view = new DataView(buffer.buffer);
    units.forEach((unit, index) => view.setUint16(index * 2, unit, littleEndian));
    return buffer;
  };

  it.each(['utf-16le', 'utf-16be'])(
    'decodes %s as the platform does, malformed input included',
    (label) => {
      const littleEndian = label === 'utf-16le';
      const cases = [
        utf16([0xfeff, 0x48, 0xe9, 0x20, 0xd83d, 0xde00], littleEndian), // BOM, astral pair
        utf16([0x41, 0xdc00, 0x42, 0xd800, 0x43, 0xd800], littleEndian), // unpaired halves
        utf16([0x41, 0xd83d, 0xde00], littleEndian).slice(0, -1), // pair cut mid-byte
        utf16([0x41, 0x42], littleEndian).slice(0, -1), // odd trailing byte
      ];
      cases.forEach((input) => {
        expect(new EngineTextDecoder(label).decode(input)).toBe(
          new TextDecoder(label).decode(input),
        );
      });
    },
  );

  it('decodes a view at an offset, and an ArrayBuffer', () => {
    const backing = new TextEncoder().encode('xxHello');
    const view = new Uint8Array(backing.buffer, 2);
    expect(new EngineTextDecoder().decode(view)).toBe('Hello');
    expect(new EngineTextDecoder().decode(new TextEncoder().encode('ab').buffer)).toBe('ab');
  });

  // Regression: String.fromCodePoint(...hugeArray) throws a RangeError past the
  // engine's argument limit — a long mail body would fail to decode at all.
  it('decodes inputs far longer than one argument list', () => {
    const long = 'é'.repeat(70_000);
    const utf8 = new TextEncoder().encode(long);
    expect(new EngineTextDecoder().decode(utf8)).toBe(long);
    const utf16 = new Uint8Array(
      new Uint16Array(Array.from(long, (char) => char.charCodeAt(0))).buffer,
    );
    expect(new EngineTextDecoder('utf-16le').decode(utf16)).toBe(long);
  });

  it('is empty with nothing to decode', () => {
    expect(new EngineTextDecoder().decode()).toBe('');
  });

  it('refuses a charset it cannot decode, as a real decoder built without it does', () => {
    expect(() => new EngineTextDecoder('shift_jis')).toThrow(RangeError);
  });
});

describe('EngineTextEncoder', () => {
  it('encodes every UTF-8 width as the platform does', () => {
    const text = 'a é € 😀';
    expect(Array.from(new EngineTextEncoder().encode(text))).toEqual(
      Array.from(new TextEncoder().encode(text)),
    );
  });

  it('encodes a lone surrogate as U+FFFD, and nothing as nothing', () => {
    const lone = 'a\ud800b';
    expect(Array.from(new EngineTextEncoder().encode(lone))).toEqual(
      Array.from(new TextEncoder().encode(lone)),
    );
    expect(new EngineTextEncoder().encode()).toHaveLength(0);
    expect(new EngineTextEncoder().encoding).toBe('utf-8');
  });
});

describe('EngineBlob', () => {
  it('joins strings, buffers, views and other blobs into one byte run', async () => {
    const inner = new EngineBlob(['ü']);
    const blob = new EngineBlob(['a', new Uint8Array([0x62]).buffer, bytes(0x63), inner], {
      type: 'message/rfc822',
    });
    expect(blob.size).toBe(5);
    expect(blob.type).toBe('message/rfc822');
    expect(new TextDecoder().decode(await blob.arrayBuffer())).toBe('abcü');
  });

  it('is empty and untyped by default', () => {
    const blob = new EngineBlob();
    expect(blob.size).toBe(0);
    expect(blob.type).toBe('');
  });
});

describe('engineAtob', () => {
  it.each([
    '',
    'YQ',
    'YQ==',
    'YWI=',
    'YWJj',
    'YW Jj\nZA',
    '/+/+',
    btoa(String.fromCharCode(...Array.from({ length: 256 }, (_, index) => index))),
  ])('decodes %j as the platform does', (input) => {
    expect(engineAtob(input)).toBe(atob(input));
  });

  // The HTML spec's forgiving-base64 rules. Node 18's own atob is laxer about
  // misplaced padding, so the platform is not the oracle here.
  it.each(['Y', 'YQ*', 'a===', 'YQ=a'])('rejects %j', (input) => {
    expect(() => engineAtob(input)).toThrow();
  });
});

/** Node's own `Object.hasOwn`; the TS lib this package targets predates it. */
const realHasOwn = (Object as unknown as { hasOwn: typeof engineHasOwn }).hasOwn;

describe('installEnginePolyfills', () => {
  it('fills only what the engine lacks', () => {
    const bare: Record<string, unknown> = {};
    installEnginePolyfills(bare);
    expect(bare).toEqual({
      atob: engineAtob,
      TextDecoder: EngineTextDecoder,
      TextEncoder: EngineTextEncoder,
      Blob: EngineBlob,
    });

    const browser: Record<string, unknown> = { atob, TextDecoder, TextEncoder, Blob };
    installEnginePolyfills(browser);
    expect(browser).toEqual({ atob, TextDecoder, TextEncoder, Blob });
  });

  // Regression: iOS 15.0–15.3 JavaScriptCore has no Object.hasOwn, and the
  // HTML parser's selector engine calls it.
  it('gives an Object without hasOwn one, and leaves a real one alone', () => {
    const oldObject: Record<string, unknown> = {};
    installEnginePolyfills({ Object: oldObject });
    expect(oldObject.hasOwn).toBe(engineHasOwn);

    const modern: Record<string, unknown> = { Object };
    installEnginePolyfills(modern);
    expect((modern.Object as Record<string, unknown>).hasOwn).toBe(realHasOwn);
  });
});

describe('engineHasOwn', () => {
  it('answers as Object.hasOwn does, inherited and shadowed keys included', () => {
    const shadowing = Object.assign(Object.create({ inherited: 1 }) as object, {
      own: 1,
      hasOwnProperty: () => true,
    });
    for (const key of ['own', 'inherited', 'missing', 'hasOwnProperty']) {
      expect(engineHasOwn(shadowing, key)).toBe(realHasOwn(shadowing, key));
    }
  });
});
