/**
 * Fake `IntersectionObserver` / `ResizeObserver` for the component tests.
 *
 * jsdom implements neither, which is a feature rather than a nuisance: the
 * components have to keep working without them (old webviews, SSR hydration,
 * exactly this test environment), so the DEFAULT state of these tests is "no
 * observer", and a test that wants one installs it deliberately and drives it
 * by hand. Driving it by hand is also the only way to test visibility at all —
 * nothing in jsdom lays out, so nothing would ever intersect.
 */
import { vi } from 'vitest';

export interface FakeEntry {
  target: unknown;
  isIntersecting: boolean;
}

export class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  readonly targets: unknown[] = [];
  disconnected = false;
  readonly root: unknown;

  constructor(
    private readonly callback: (entries: FakeEntry[]) => void,
    options?: { root?: unknown },
  ) {
    this.root = options?.root ?? null;
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target: unknown) {
    this.targets.push(target);
  }

  unobserve(target: unknown) {
    const at = this.targets.indexOf(target);
    if (at >= 0) this.targets.splice(at, 1);
  }

  disconnect() {
    this.disconnected = true;
  }

  /** Report visibility, as the browser would. */
  emit(entries: FakeEntry[]) {
    this.callback(entries);
  }

  /** The most recently constructed observer — the one under test. */
  static get latest(): FakeIntersectionObserver {
    const last = FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 1];
    if (!last) throw new Error('no IntersectionObserver was constructed');
    return last;
  }
}

/** Install the fake and clear any instances a previous test left behind. */
export function installIntersectionObserver() {
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  return FakeIntersectionObserver;
}

export class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];

  readonly targets: unknown[] = [];
  disconnected = false;

  constructor(private readonly callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: unknown) {
    this.targets.push(target);
  }

  disconnect() {
    this.disconnected = true;
  }

  /** Report a reflow: an image finished, a font swapped, the window resized. */
  emit() {
    this.callback();
  }

  static get latest(): FakeResizeObserver {
    const last = FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1];
    if (!last) throw new Error('no ResizeObserver was constructed');
    return last;
  }
}

export function installResizeObserver() {
  FakeResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  return FakeResizeObserver;
}
