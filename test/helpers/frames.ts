/**
 * jsdom's own `srcdoc` load, flushed deliberately.
 *
 * Anything that renders a rich body gets an iframe, and jsdom queues a real
 * `load` for it on a later task. Measured outside React's batching that load
 * produces nothing but act(...) warnings — so every test that renders a frame
 * flushes it here, while the frame still holds jsdom's own empty document,
 * which measures zero and therefore changes no state.
 */
import { act } from '@testing-library/react';

export async function settleFrameLoad(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
