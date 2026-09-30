// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { cascadedValue, stylesheetRules } from '../helpers/stylesheet.js';

// A run follower's slim header is a `.sec-head` with one extra class
// (`ChatBubble` renders it; see its tests for the DOM half). How it looks is
// carried by the stylesheet, and jsdom does no layout, so what is pinned here is
// what the browser is TOLD.

describe('.sec-head--run', () => {
  // Regression: the follower's time has to read as the same small, muted
  // metadata as the full header's, in either scheme. It gets that by being a
  // `.sec-head` and declaring no colour or size of its own — a literal here
  // would ignore the host's tokens and the dark-scheme fallbacks, and leave a
  // dark-on-dark timestamp under a dark app.
  it('takes the header’s muted, small type from the tokens', () => {
    expect(cascadedValue('.sec-head', 'color')).toBe('var(--sec-muted)');
    expect(cascadedValue('.sec-head', 'font-size')).toBe('var(--sec-fs-meta)');
    for (const property of ['color', 'font-size', 'font-weight', 'background', 'opacity']) {
      expect(cascadedValue('.sec-head--run', property), property).toBe('');
    }
    // And the token it leans on has a fallback for the dark scheme too.
    expect(
      stylesheetRules().some(
        (rule) =>
          rule instanceof CSSMediaRule &&
          rule.media.mediaText.includes('prefers-color-scheme: dark') &&
          Array.from(rule.cssRules).some(
            (inner) =>
              inner instanceof CSSStyleRule && inner.style.getPropertyValue('--sec-muted') !== '',
          ),
      ),
    ).toBe(true);
  });

  // Regression: the follower's time lines up with the full header's sender
  // above it only while both headers share the same inline padding. An inset
  // of its own would put the run's times on a different edge from its names.
  it('keeps the header’s own inline padding, lining up with the full header', () => {
    expect(cascadedValue('.sec-head', 'padding-inline')).toBe('var(--sec-gap-sm)');
    for (const property of ['padding', 'padding-inline', 'padding-inline-start', 'margin']) {
      expect(cascadedValue('.sec-head--run', property), property).toBe('');
    }
  });

  // Regression: the gap between a run's bubbles is the only thing saying they
  // belong together. The slim header is set solid so it adds as little height
  // as a line of meta text can, rather than a full line-box above every
  // follower.
  it('is set solid, so the run stays tight', () => {
    expect(cascadedValue('.sec-head--run', 'line-height')).toBe('1');
  });

  // Regression: set solid, the time's line box (11px) is shorter than a host's
  // 16px shield, and on `.sec-head`'s baseline the time rode at the top of the
  // row while the shield (`align-self: center`) sat 2.5px lower — so a run
  // follower's time and mark disagreed with the full header's right above it.
  // Centring the row puts both on its middle.
  it('centres its row, so the time sits level with the host’s mark', () => {
    expect(cascadedValue('.sec-head', 'align-items')).toBe('baseline');
    expect(cascadedValue('.sec-head--run', 'align-items')).toBe('center');
    expect(cascadedValue('.sec-head__meta', 'align-self')).toBe('center');
  });
});
