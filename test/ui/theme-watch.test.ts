// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { watchHostTheme } from '../../src/ui/theme-watch.js';

/** Let jsdom deliver the MutationObserver records queued so far. */
const flushMutations = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A `matchMedia` whose `change` the test fires by hand. */
function stubMatchMedia() {
  const listeners = new Set<() => void>();
  const media = {
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  );
  return { media, fire: () => listeners.forEach((listener) => listener()) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.className = '';
  document.body.removeAttribute('data-theme');
});

describe('watchHostTheme', () => {
  // Regression: an app that switches theme with a class on <html> left every
  // frame already on screen in the old theme — dark table rows inside a page
  // that had just turned light.
  it('reports a theme switched on <html> or <body>', async () => {
    const onChange = vi.fn();
    const stop = watchHostTheme(document.createElement('div'), onChange);
    // A detached element still belongs to the document, which is what is watched.
    document.documentElement.className = 'dark';
    await flushMutations();
    expect(onChange).toHaveBeenCalledTimes(1);
    document.body.setAttribute('data-theme', 'light');
    await flushMutations();
    expect(onChange).toHaveBeenCalledTimes(2);
    stop();
  });

  // Regression: a host that follows the platform's appearance changes theme
  // without touching a single attribute.
  it('reports the platform switching between light and dark', () => {
    const { fire } = stubMatchMedia();
    const onChange = vi.fn();
    const stop = watchHostTheme(document.body, onChange);
    fire();
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
  });

  // Regression: a frame that has gone away must not keep being told — and
  // re-read — on every later theme change.
  it('stops reporting once unsubscribed', async () => {
    const { media, fire } = stubMatchMedia();
    const onChange = vi.fn();
    watchHostTheme(document.body, onChange)();
    document.documentElement.className = 'dark';
    await flushMutations();
    fire();
    expect(onChange).not.toHaveBeenCalled();
    expect(media.removeEventListener).toHaveBeenCalled();
  });

  // Regression: server rendering and old environments have no element, no
  // MutationObserver or no matchMedia; watching must degrade, not throw.
  it('watches nothing it cannot, without throwing', () => {
    expect(() => watchHostTheme(null, vi.fn())()).not.toThrow();
    vi.stubGlobal('MutationObserver', undefined);
    vi.stubGlobal('matchMedia', undefined);
    expect(() => watchHostTheme(document.body, vi.fn())()).not.toThrow();
  });
});
