// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { cascadedValue, declarationsFor } from '../helpers/stylesheet.js';

// Where the quick actions land, and when they appear, is carried entirely by
// the stylesheet: `ChatBubble` only renders `.sec-bubble-anchor` and
// `.sec-quick` (see its tests for the DOM half). jsdom does no layout, so what
// is pinned here is what the browser is TOLD, read back as real `CSSRule`s.

describe('.sec-quick', () => {
  // Regression: the cluster belongs on the bubble's bottom inline-end corner —
  // bottom right in a left-to-right page — for every bubble. Physical
  // `right`/`bottom` would put it on the wrong corner in a right-to-left page,
  // and a start-side inset on EVERY row would pin the reader's own cluster to
  // the far edge of a narrow bubble (the one row that gets it is below).
  it('sits on its anchor’s bottom inline-end corner', () => {
    expect(cascadedValue('.sec-quick', 'position')).toBe('absolute');
    expect(cascadedValue('.sec-quick', 'inset-block-end')).toBe('0');
    expect(cascadedValue('.sec-quick', 'inset-inline-end')).toBe('var(--sec-quick-inset)');
    for (const property of [
      'inset',
      'inset-block-start',
      'inset-inline-start',
      'top',
      'right',
      'bottom',
      'left',
    ]) {
      expect(cascadedValue('.sec-quick', property), property).toBe('');
    }
  });

  // Regression: laid wholly inside the bubble, a one-line reply's words are
  // under the buttons. A zero-height box lying on the bottom edge, with its
  // buttons centred on it, puts half of them out — the inner half in the
  // bottom padding, which is the whole reason for the corner.
  it('straddles the bubble’s bottom edge, half outside it', () => {
    expect(cascadedValue('.sec-quick', 'block-size')).toBe('0');
    expect(cascadedValue('.sec-quick', 'align-items')).toBe('center');
    for (const property of ['height', 'min-block-size', 'min-height', 'padding']) {
      expect(cascadedValue('.sec-quick', property), property).toBe('');
    }
  });

  // Regression: found in Chrome. The straddle used to be `translateY(50%)`,
  // which made the cluster the containing block of every `position: fixed`
  // element in it — and a host's tooltip on a reply button is one, placed
  // from the viewport. It landed off the screen, and the thread's scroll box
  // clipped it. Each of these properties does the same.
  it('never becomes the containing block of the host’s fixed tooltips', () => {
    for (const property of [
      'transform',
      'translate',
      'scale',
      'rotate',
      'filter',
      'backdrop-filter',
      'perspective',
      'will-change',
      'contain',
      'container-type',
    ]) {
      expect(cascadedValue('.sec-quick', property), property).toBe('');
      expect(cascadedValue('.sec-row--theirs .sec-quick', property), property).toBe('');
      expect(cascadedValue('.sec-row:hover .sec-quick', property), property).toBe('');
      expect(cascadedValue('.sec-bubble-anchor', property), property).toBe('');
    }
  });

  // Regression: a box narrower than its buttons squeezes them — flex items
  // shrink before they overflow — so on a bubble narrower than the cluster
  // the host's icons were crushed rather than moved.
  it('is never narrower than the host’s buttons', () => {
    expect(cascadedValue('.sec-quick', 'min-inline-size')).toBe('max-content');
  });

  // Regression: found in Chrome. On someone else's "OK", narrower than the
  // cluster, the cluster pinned to the inline-end corner overflowed toward
  // the inline START — past the avatar and out of the thread, which clipped
  // the Reply button in half. On their rows the box spans the bubble from its
  // start edge and packs the buttons at its end, so a wide bubble is
  // unchanged and a narrow one's cluster reaches into the free column instead.
  it('lets a cluster wider than someone else’s short reply reach into the free side', () => {
    expect(cascadedValue('.sec-row--theirs .sec-quick', 'inset-inline-start')).toBe('0');
    expect(cascadedValue('.sec-row--theirs .sec-quick', 'justify-content')).toBe('flex-end');
    // The reader's own row overflows inward already, and must keep doing so.
    expect(cascadedValue('.sec-row--mine .sec-quick', 'inset-inline-start')).toBe('');
    expect(cascadedValue('.sec-quick', 'justify-content')).toBe('');
  });

  // Regression: found in Chrome. The hidden cluster's lower half lies over the
  // top of the next row's bubble, and it stayed hit-testable at `opacity: 0`:
  // hovering there revealed the PREVIOUS row's controls, and a right-click
  // there hit an invisible Reply button instead of opening the message menu.
  it('takes no pointer events until it is revealed', () => {
    expect(cascadedValue('.sec-quick', 'pointer-events')).toBe('none');
    expect(cascadedValue('.sec-row:hover .sec-quick', 'pointer-events')).toBe('auto');
    expect(cascadedValue('.sec-row:focus-within .sec-quick', 'pointer-events')).toBe('auto');
  });

  // Regression: the inset is a knob like every other value here, not a
  // literal — and it must stay a token a host can move on an ancestor.
  it('takes its inset from a token that resolves through the host’s spacing', () => {
    expect(declarationsFor(':root').getPropertyValue('--sec-quick-inset')).toBe('var(--sec-pad)');
  });

  // Regression: the half hanging below the bubble overlaps the next row, and
  // is painted under that row's bubble without a stacking level of its own.
  it('stacks above the neighbouring bubble it overhangs', () => {
    expect(cascadedValue('.sec-quick', 'z-index')).toBe('var(--sec-z-actions)');
  });

  // Regression: a chat with three buttons on every message stops reading as a
  // conversation, so they are hidden until the row is hovered; and without
  // `:focus-within` they are unreachable by keyboard — tabbing onto an
  // invisible button leaves the reader on a control they cannot see.
  it('is hidden until its row is hovered or focused', () => {
    expect(cascadedValue('.sec-quick', 'opacity')).toBe('0');
    expect(cascadedValue('.sec-row:hover .sec-quick', 'opacity')).toBe('1');
    expect(cascadedValue('.sec-row:focus-within .sec-quick', 'opacity')).toBe('1');
  });

  // Regression: two host slots on one row that fade on different cues or at
  // different speeds read as a glitch. The quick actions reveal exactly as
  // the row actions do.
  it('fades exactly like the row actions', () => {
    expect(cascadedValue('.sec-quick', 'transition')).toBe('opacity var(--sec-dur) ease-out');
    expect(cascadedValue('.sec-quick', 'transition')).toBe(
      cascadedValue('.sec-actions', 'transition'),
    );
  });

  // Regression: the fade is decorative, and a reader who asked the OS for
  // less motion must get the buttons without it.
  it('stops fading for a reader who asked for less motion', () => {
    expect(cascadedValue('.sec-quick', 'transition', 'prefers-reduced-motion')).toBe('none');
    expect(cascadedValue('.sec-actions', 'transition', 'prefers-reduced-motion')).toBe('none');
  });
});

describe('.sec-bubble-anchor', () => {
  // Regression: the positioning box has to be the anchor. Left `static`, the
  // cluster is positioned against the column instead — whose corner is past
  // the bubble's whenever the header is wider than a short reply.
  it('is the positioning box for the quick actions', () => {
    expect(cascadedValue('.sec-bubble-anchor', 'position')).toBe('relative');
  });

  // Regression: a short reply hugs its text, so its anchor must shrink-wrap
  // the bubble. A width here would widen every quick-action bubble into a
  // banner, and move the corner away from the words.
  it('hugs a short bubble', () => {
    expect(cascadedValue('.sec-bubble-anchor', 'width')).toBe('');
    // …but never past the column, which is what caps a long unbroken address.
    expect(cascadedValue('.sec-bubble-anchor', 'max-width')).toBe('100%');
    expect(cascadedValue('.sec-bubble-anchor', 'min-width')).toBe('0');
  });

  // Regression: found in a real browser. As a plain block, the anchor sent a
  // bubble wider than itself — every wide bubble, in a host without a global
  // `box-sizing: border-box` — overflowing toward the inline end: on the
  // reader's own row, into their avatar. The column had always pushed that
  // overflow the other way, so the anchor must lay the bubble out as the
  // column does, aligned to the same side.
  it('lays the bubble out exactly as the column does', () => {
    expect(cascadedValue('.sec-bubble-anchor', 'display')).toBe('flex');
    expect(cascadedValue('.sec-bubble-anchor', 'flex-direction')).toBe('column');
    expect(cascadedValue('.sec-bubble-anchor', 'align-items')).toBe('inherit');
  });

  // Regression: a wide bubble is `width: 100%` OF ITS PARENT, which is now the
  // anchor. A shrink-wrapped anchor gives a framed body the iframe's 300px
  // default — the tiny-document bug `.sec-col` exists to prevent.
  it('takes the whole column for a wide bubble', () => {
    expect(cascadedValue('.sec-bubble-anchor--wide', 'width')).toBe('100%');
  });
});

describe('.sec-actions', () => {
  // Regression: the row actions now share their base rule with the quick
  // actions. The split must not move them off the column's outer edge, level
  // with the header.
  it('still hangs level with the header', () => {
    expect(cascadedValue('.sec-actions', 'position')).toBe('absolute');
    expect(cascadedValue('.sec-actions', 'inset-block-start')).toBe('0');
    expect(cascadedValue('.sec-actions', 'opacity')).toBe('0');
    expect(cascadedValue('.sec-row:hover .sec-actions', 'opacity')).toBe('1');
    expect(cascadedValue('.sec-row:focus-within .sec-actions', 'opacity')).toBe('1');
  });
});
