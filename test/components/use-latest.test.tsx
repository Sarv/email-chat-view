// @vitest-environment jsdom
import { render } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import { describe, expect, it } from 'vitest';

import { useLatest } from '../../src/components/use-latest.js';

/** Hands each render's ref out, so the test can compare them across renders. */
function Probe({
  value,
  onRef,
}: {
  value: string;
  onRef: (ref: MutableRefObject<string>) => void;
}) {
  onRef(useLatest(value));
  return null;
}

describe('useLatest', () => {
  // Regression: the whole point is ONE ref for the component's life. A new ref
  // per render would be a new dependency per render, and the effect it feeds
  // would tear down its observers and listeners every time — which for a
  // frame's document means its links and right-click go dead after the first
  // re-render.
  it('keeps one ref across renders and holds the latest committed value', () => {
    const refs: MutableRefObject<string>[] = [];
    const { rerender } = render(<Probe value="first" onRef={(ref) => refs.push(ref)} />);
    expect(refs[0]?.current).toBe('first');

    rerender(<Probe value="second" onRef={(ref) => refs.push(ref)} />);
    expect(refs[1]).toBe(refs[0]);
    expect(refs[0]?.current).toBe('second');
  });
});
