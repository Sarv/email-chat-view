/**
 * jsdom globals, installed on import.
 *
 * A side-effecting module on purpose, and it MUST be imported before anything
 * from `dist/`: the sanitizer resolves DOMPurify against `window` at module
 * load, so a bare Node render sanitizes every body down to nothing and the
 * bubbles come out saying "no new content". The ordering constraint is the
 * whole reason this is a file rather than four lines in each script — a copy
 * that gets moved below the `dist/` import fails silently, as a picture of an
 * empty thread.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Node = dom.window.Node;

export { dom };
