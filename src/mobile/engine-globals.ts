/**
 * Installs the engine stand-ins as a side effect of being imported.
 *
 * Its own module, imported FIRST by `core-entry.ts`, because postal-mime builds
 * a `TextEncoder` and a `TextDecoder` while its module is being evaluated —
 * before any statement in the entry itself would run.
 */
import { installEnginePolyfills } from './engine-polyfills.js';

installEnginePolyfills(globalThis as unknown as Record<string, unknown>);
