/**
 * Keep the latest value of something in a ref.
 *
 * So an effect can USE a callback without DEPENDING on it. Host callbacks are
 * almost always inline arrow functions, whose identity changes on every render;
 * an effect that listed one in its dependencies would tear down and rebuild
 * what it set up on every render. For an IntersectionObserver that means it
 * never settles long enough to report anything. For a listener on a frame's
 * document it is worse: the teardown removes the listener, the rebuild only
 * waits for a `load` that has already fired, and the frame's links and
 * right-click go dead until the body changes.
 *
 * The write is in an effect, not in the render body. A render can be thrown
 * away before it commits, and a ref written by a discarded render would then
 * hold a value the reader never saw. Every consumer reads `.current` from an
 * observer or event callback — asynchronous, long after commit — and calls this
 * hook above the effects that use it, so the ref is always current by then.
 *
 * Internal: shared by the components, not part of the public entry.
 */
import { useEffect, useRef, type MutableRefObject } from 'react';

export function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
