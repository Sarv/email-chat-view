import { describe, expect, it } from 'vitest';

import {
  buildSenderColorMap,
  colorForHue,
  MIN_HUE_SEP,
  resolveSenderColor,
  senderHue,
  type SenderColor,
} from '../../src/ui/sender-colors.js';

/** Recover the hue out of an assigned `hsl(...)` string. */
function hueOf(color: SenderColor): number {
  const match = /^hsl\((-?[\d.]+)/.exec(color.avatar);
  if (!match?.[1]) throw new Error(`unrecognised colour: ${color.avatar}`);
  return Number(match[1]);
}

function shortestHueGap(left: number, right: number): number {
  const delta = Math.abs(left - right) % 360;
  return Math.min(delta, 360 - delta);
}

describe('senderHue', () => {
  // Regression: the whole point of a hash is that a person keeps their colour.
  // A change in the algorithm (or a platform-dependent multiply) would silently
  // recolour every thread.
  it('is stable for the same address', () => {
    expect(senderHue('alice@acme.example')).toBe(senderHue('alice@acme.example'));
    expect(senderHue('alice@acme.example')).toBe(307);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(senderHue('  ALICE@Acme.example ')).toBe(senderHue('alice@acme.example'));
  });

  // Regression: an unidentified sender must not hash to a different colour on
  // every message just because one had an empty address and one had spaces.
  it('folds every unusable address onto one identity', () => {
    expect(senderHue('')).toBe(senderHue('unknown'));
    expect(senderHue('   ')).toBe(senderHue('unknown'));
  });

  it('stays inside the colour wheel', () => {
    for (let index = 0; index < 200; index += 1) {
      const hue = senderHue(`person-${index}@acme.example`);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
});

describe('colorForHue', () => {
  it('produces an opaque avatar fill and a translucent bubble wash', () => {
    const color = colorForHue(200);
    expect(color.avatar).toBe('hsl(200.0 58% 43%)');
    expect(color.bubble).toBe('hsl(200.0 60% 50% / 0.12)');
  });

  // Regression: the golden-angle rotation runs the hue past 360, and a negative
  // or out-of-range value in an `hsl()` string is an invalid colour in some
  // engines — the avatar would render transparent.
  it('normalizes hues outside 0–360', () => {
    expect(colorForHue(380).avatar).toBe(colorForHue(20).avatar);
    expect(colorForHue(-20).avatar).toBe(colorForHue(340).avatar);
  });
});

describe('buildSenderColorMap', () => {
  it('assigns one colour per distinct address, in order of appearance', () => {
    const colors = buildSenderColorMap([
      'alice@acme.example',
      'ALICE@acme.example',
      'bob@acme.example',
    ]);
    expect([...colors.keys()]).toEqual(['alice@acme.example', 'bob@acme.example']);
  });

  // Regression: burning a hue on the reader pushes a real participant's colour
  // away for nothing — the reader's own bubbles use the brand fill.
  it('skips the reader’s own addresses, case-insensitively', () => {
    const colors = buildSenderColorMap(
      ['me@acme.example', 'alice@acme.example'],
      ['  ME@Acme.example  '],
    );
    expect(colors.has('me@acme.example')).toBe(false);
    expect(colors.has('alice@acme.example')).toBe(true);
  });

  it('ignores empty, null and undefined entries on both lists', () => {
    const colors = buildSenderColorMap(['', null, undefined, 'alice@acme.example'], ['', null]);
    expect([...colors.keys()]).toEqual(['alice@acme.example']);
  });

  // Regression: THE reason this module is not just a hash. Two participants
  // whose identity hues collide have to be pulled apart, or the colour stops
  // telling them apart — which is the only job it has.
  it('rotates a colliding hue away from one already taken', () => {
    // Found rather than hard-coded, so the test keeps holding if the hash
    // changes: any two addresses whose identity hues are too close will do.
    let pair: [string, string] | null = null;
    for (let left = 0; left < 400 && !pair; left += 1) {
      for (let right = left + 1; right < 400; right += 1) {
        const leftAddress = `p${left}@acme.example`;
        const rightAddress = `p${right}@acme.example`;
        if (shortestHueGap(senderHue(leftAddress), senderHue(rightAddress)) < MIN_HUE_SEP) {
          pair = [leftAddress, rightAddress];
          break;
        }
      }
    }
    expect(pair).not.toBeNull();

    const [first, second] = pair!;
    const colors = buildSenderColorMap([first, second]);
    const gap = shortestHueGap(hueOf(colors.get(first)!), hueOf(colors.get(second)!));
    expect(gap).toBeGreaterThanOrEqual(MIN_HUE_SEP);
  });

  // Regression: a wheel too full for another 28-degree gap must still give
  // everyone a colour. Giving up and returning no colour would render an
  // unpainted avatar for the rest of a large thread.
  it('still colours every participant once the wheel is saturated', () => {
    const addresses = Array.from({ length: 40 }, (_unused, index) => `p${index}@acme.example`);
    const colors = buildSenderColorMap(addresses);
    expect(colors.size).toBe(40);
    for (const address of addresses) {
      expect(colors.get(address)?.avatar).toMatch(/^hsl\(/);
    }
  });
});

describe('resolveSenderColor', () => {
  it('returns the thread’s assigned colour when there is one', () => {
    const colors = buildSenderColorMap(['alice@acme.example']);
    expect(resolveSenderColor(colors, 'ALICE@acme.example ')).toEqual(
      colors.get('alice@acme.example'),
    );
  });

  // Regression: a sender who never made it into the map (a message appended
  // after it was built) must render a colour, not a hole.
  it('falls back to the identity hue for an unmapped sender', () => {
    expect(resolveSenderColor(new Map(), 'zoe@acme.example')).toEqual(
      colorForHue(senderHue('zoe@acme.example')),
    );
  });

  it('falls back for a missing address too', () => {
    expect(resolveSenderColor(new Map(), null)).toEqual(colorForHue(senderHue('')));
  });
});
