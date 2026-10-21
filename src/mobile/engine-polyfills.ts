/**
 * The web APIs `parseRawMail` needs that a bare JavaScript engine lacks.
 *
 * The native data API runs the transform in JavaScriptCore (iOS) and a V8
 * isolate (Android) — engines with the language and nothing else: no
 * `TextDecoder`, no `TextEncoder`, no `Blob`, no `atob`. postal-mime uses the
 * first three to decode a message, and the HTML parser's entity tables are
 * base64 decoded with `atob` as the bundle loads, so the core bundle brings
 * stand-ins, installed only where the real one is missing. A browser or Node
 * never sees them.
 *
 * One more is about age, not bareness: `Object.hasOwn`, which JavaScriptCore
 * gained only in iOS 15.4. The HTML parser's selector engine calls it, and the
 * package supports iOS 15.0.
 *
 * Deliberately small. Only the charsets mail is overwhelmingly written in are
 * decoded here — UTF-8, UTF-16 and Windows-1252 (which the Encoding Standard
 * also uses for Latin-1 and ASCII). Any other label throws, exactly as a real
 * `TextDecoder` throws on a charset it was built without, and postal-mime
 * already falls back to Windows-1252 for those.
 */

const REPLACEMENT = 0xfffd;

/** Windows-1252's 0x80–0x9F, where it departs from Latin-1. */
const WINDOWS_1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152,
  0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122,
  0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];

type Encoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

/** Encoding Standard labels for the encodings decoded here. */
const LABELS: ReadonlyMap<string, Encoding> = new Map([
  ...[
    'utf-8',
    'utf8',
    'unicode-1-1-utf-8',
    'unicode11utf8',
    'unicode20utf8',
    'x-unicode20utf8',
  ].map((label) => [label, 'utf-8'] as const),
  ...['utf-16le', 'utf-16', 'ucs-2', 'unicode', 'csunicode', 'iso-10646-ucs-2', 'unicodefeff'].map(
    (label) => [label, 'utf-16le'] as const,
  ),
  ...['utf-16be', 'unicodefffe'].map((label) => [label, 'utf-16be'] as const),
  ...[
    'windows-1252',
    'ansi_x3.4-1968',
    'ascii',
    'cp1252',
    'cp819',
    'csisolatin1',
    'ibm819',
    'iso-8859-1',
    'iso-ir-100',
    'iso8859-1',
    'iso88591',
    'iso_8859-1',
    'iso_8859-1:1987',
    'l1',
    'latin1',
    'us-ascii',
    'x-cp1252',
  ].map((label) => [label, 'windows-1252'] as const),
]);

/** Code points to a string, in slices small enough for any engine's argument limit. */
function fromCodePoints(codePoints: readonly number[]): string {
  const SLICE = 8192;
  return Array.from({ length: Math.ceil(codePoints.length / SLICE) }, (_, index) =>
    String.fromCodePoint(...codePoints.slice(index * SLICE, (index + 1) * SLICE)),
  ).join('');
}

/** The bytes of whatever a decoder or a blob part was handed. */
function bytesOf(input: ArrayBuffer | ArrayBufferView): Uint8Array {
  return input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

/** The lead byte's payload bits, continuation count and allowed second-byte range. */
function utf8Lead(lead: number): [number, number, number, number] | null {
  if (lead >= 0xc2 && lead <= 0xdf) return [lead & 0x1f, 1, 0x80, 0xbf];
  if (lead >= 0xe0 && lead <= 0xef) {
    return [lead & 0x0f, 2, lead === 0xe0 ? 0xa0 : 0x80, lead === 0xed ? 0x9f : 0xbf];
  }
  if (lead >= 0xf0 && lead <= 0xf4) {
    return [lead & 0x07, 3, lead === 0xf0 ? 0x90 : 0x80, lead === 0xf4 ? 0x8f : 0xbf];
  }
  return null;
}

/**
 * UTF-8 as the Encoding Standard decodes it: each malformed sequence becomes
 * one U+FFFD and decoding resumes at the byte that broke it, so a stray Latin-1
 * byte in a "UTF-8" mail costs one character, not the rest of the line.
 */
export function decodeUtf8(bytes: Uint8Array): string {
  const codePoints: number[] = [];
  let index = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (index < bytes.length) {
    const lead = bytes[index] as number;
    if (lead < 0x80) {
      codePoints.push(lead);
      index += 1;
      continue;
    }
    const shape = utf8Lead(lead);
    if (!shape) {
      codePoints.push(REPLACEMENT);
      index += 1;
      continue;
    }
    const [payload, needed] = shape;
    let [, , lower, upper] = shape;
    let codePoint = payload;
    let seen = 0;
    while (seen < needed) {
      const next = bytes[index + 1 + seen];
      if (next === undefined || next < lower || next > upper) break;
      codePoint = (codePoint << 6) | (next & 0x3f);
      lower = 0x80;
      upper = 0xbf;
      seen += 1;
    }
    codePoints.push(seen === needed ? codePoint : REPLACEMENT);
    index += 1 + seen;
  }
  return fromCodePoints(codePoints);
}

/** Whether a UTF-16 code unit is the lead or the trail half of a pair. */
const isLead = (unit: number | undefined): boolean =>
  unit !== undefined && unit >= 0xd800 && unit <= 0xdbff;
const isTrail = (unit: number | undefined): boolean =>
  unit !== undefined && unit >= 0xdc00 && unit <= 0xdfff;

/**
 * UTF-16 in the given byte order, as the Encoding Standard decodes it: an
 * unpaired surrogate is U+FFFD, and so is an odd trailing byte — one U+FFFD in
 * all when that byte is the cut-off rest of a pair.
 */
function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  const units = Array.from({ length: Math.floor(bytes.length / 2) }, (_, index) => {
    const first = bytes[index * 2] as number;
    const second = bytes[index * 2 + 1] as number;
    return littleEndian ? first | (second << 8) : (first << 8) | second;
  });
  const body = units[0] === 0xfeff ? units.slice(1) : units;
  const wellFormed = body.map((unit, index) => {
    if (isLead(unit)) return isTrail(body[index + 1]) ? unit : REPLACEMENT;
    if (isTrail(unit)) return isLead(body[index - 1]) ? unit : REPLACEMENT;
    return unit;
  });
  const text = Array.from({ length: Math.ceil(wellFormed.length / 8192) }, (_, index) =>
    String.fromCharCode(...wellFormed.slice(index * 8192, (index + 1) * 8192)),
  ).join('');
  const cutPair = isLead(body[body.length - 1]);
  return bytes.length % 2 && !cutPair ? `${text}\ufffd` : text;
}

function decodeWindows1252(bytes: Uint8Array): string {
  return fromCodePoints(
    Array.from(bytes, (byte) =>
      byte >= 0x80 && byte <= 0x9f ? (WINDOWS_1252_HIGH[byte - 0x80] as number) : byte,
    ),
  );
}

/** `TextDecoder` for UTF-8, UTF-16 and Windows-1252. Other labels throw. */
export class EngineTextDecoder {
  readonly encoding: Encoding;

  constructor(label = 'utf-8') {
    const encoding = LABELS.get(label.trim().toLowerCase());
    if (!encoding) throw new RangeError(`The encoding label provided ('${label}') is invalid.`);
    this.encoding = encoding;
  }

  decode(input?: ArrayBuffer | ArrayBufferView): string {
    if (!input) return '';
    const bytes = bytesOf(input);
    if (this.encoding === 'utf-8') return decodeUtf8(bytes);
    if (this.encoding === 'windows-1252') return decodeWindows1252(bytes);
    return decodeUtf16(bytes, this.encoding === 'utf-16le');
  }
}

/** `TextEncoder`: a string as UTF-8 bytes, a lone surrogate as U+FFFD. */
export class EngineTextEncoder {
  readonly encoding = 'utf-8';

  encode(input = ''): Uint8Array {
    const bytes = Array.from(input).flatMap((character) => {
      const point = character.codePointAt(0) as number;
      const codePoint = point >= 0xd800 && point <= 0xdfff ? REPLACEMENT : point;
      if (codePoint < 0x80) return [codePoint];
      if (codePoint < 0x800) return [0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f)];
      if (codePoint < 0x10000) {
        return [
          0xe0 | (codePoint >> 12),
          0x80 | ((codePoint >> 6) & 0x3f),
          0x80 | (codePoint & 0x3f),
        ];
      }
      return [
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      ];
    });
    return Uint8Array.from(bytes);
  }
}

type BlobPart = ArrayBuffer | ArrayBufferView | string | EngineBlob;

/** `Blob`, as far as joining byte chunks and reading them back. */
export class EngineBlob {
  readonly type: string;
  private readonly bytes: Uint8Array;

  constructor(parts: readonly BlobPart[] = [], options: { type?: string } = {}) {
    const chunks = parts.map((part) => {
      if (typeof part === 'string') return new EngineTextEncoder().encode(part);
      if (part instanceof EngineBlob) return part.bytes;
      return bytesOf(part);
    });
    const joined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
    chunks.reduce((offset, chunk) => {
      joined.set(chunk, offset);
      return offset + chunk.length;
    }, 0);
    this.bytes = joined;
    this.type = options.type ?? '';
  }

  get size(): number {
    return this.bytes.length;
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return Promise.resolve(this.bytes.slice().buffer);
  }
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * `atob`: base64 to a binary string, one char per byte. Whitespace is skipped
 * and padding is optional, as in the platform; anything else outside the
 * alphabet throws.
 */
export function engineAtob(data: string): string {
  const compact = data.replace(/[\t\n\f\r ]/g, '').replace(/={1,2}$/, '');
  const sextets = Array.from(compact, (char) => BASE64_ALPHABET.indexOf(char));
  if (compact.length % 4 === 1 || sextets.includes(-1)) {
    throw new Error('The string to be decoded is not correctly encoded.');
  }
  const bits = sextets.map((sextet) => sextet.toString(2).padStart(6, '0')).join('');
  const bytes = Array.from({ length: Math.floor(bits.length / 8) }, (_, index) =>
    parseInt(bits.slice(index * 8, index * 8 + 8), 2),
  );
  return fromCodePoints(bytes);
}

/** `Object.hasOwn`, for JavaScriptCore before iOS 15.4. */
export function engineHasOwn(target: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

/** Install each stand-in on `scope` where the engine has no real one. */
export function installEnginePolyfills(scope: Record<string, unknown>): void {
  const objectConstructor = scope.Object as Record<string, unknown> | undefined;
  if (objectConstructor) objectConstructor.hasOwn ??= engineHasOwn;
  scope.atob ??= engineAtob;
  scope.TextDecoder ??= EngineTextDecoder;
  scope.TextEncoder ??= EngineTextEncoder;
  scope.Blob ??= EngineBlob;
}
