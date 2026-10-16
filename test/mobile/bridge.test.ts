// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import {
  ANDROID_INTERFACE,
  DOM_EVENT,
  domChannel,
  IOS_HANDLER,
  mailIdOf,
  nativeChannel,
  parseState,
  tokenDeclarations,
  visibleMailIds,
} from '../../src/mobile/bridge.js';
import { chatMessage } from '../helpers/messages.js';

describe('nativeChannel', () => {
  it('posts JSON strings to the WebKit message handler on iOS', () => {
    const postMessage = vi.fn();
    const post = nativeChannel({ webkit: { messageHandlers: { [IOS_HANDLER]: { postMessage } } } });
    post?.({ type: 'loadOlder' });
    expect(postMessage).toHaveBeenCalledWith('{"type":"loadOlder"}');
  });

  it('posts JSON strings to the JavaScript interface on Android', () => {
    const postMessage = vi.fn();
    const post = nativeChannel({ [ANDROID_INTERFACE]: { postMessage } });
    post?.({ type: 'openLink', url: 'https://example.com/' });
    expect(postMessage).toHaveBeenCalledWith('{"type":"openLink","url":"https://example.com/"}');
  });

  it('is null in a plain browser, including WebKit without our handler', () => {
    expect(nativeChannel({})).toBeNull();
    expect(nativeChannel({ webkit: { messageHandlers: {} } })).toBeNull();
  });
});

describe('domChannel', () => {
  it('dispatches each event as a DOM event carrying it', () => {
    const target = new EventTarget();
    const seen = vi.fn();
    target.addEventListener(DOM_EVENT, (event) => seen((event as CustomEvent).detail));
    domChannel(target)({ type: 'ready' });
    expect(seen).toHaveBeenCalledWith({ type: 'ready' });
  });
});

describe('parseState', () => {
  it('accepts a JSON string or an already-parsed object', () => {
    expect(parseState('{"hasOlder":true}')).toEqual({ hasOlder: true });
    expect(parseState({ loading: true })).toEqual({ loading: true });
  });

  it('throws on anything that is not an object, so native sees the error', () => {
    expect(() => parseState('[]')).toThrow(TypeError);
    expect(() => parseState('null')).toThrow(TypeError);
    expect(() => parseState(42)).toThrow(TypeError);
    expect(() => parseState('{oops')).toThrow(SyntaxError);
  });
});

describe('tokenDeclarations', () => {
  it('prefixes valid names with the custom-property dashes', () => {
    expect(tokenDeclarations({ brand: '#0b57d0', 'sec-bubble-mine-bg': 'teal' })).toEqual([
      ['--brand', '#0b57d0'],
      ['--sec-bubble-mine-bg', 'teal'],
    ]);
  });

  it('drops names that are not a plain token and values that are not strings', () => {
    const tokens: Record<string, unknown> = { Brand: 'x', '--brand': 'x', 'a;b': 'x', ok: 3 };
    expect(tokenDeclarations(tokens as Record<string, string>)).toEqual([]);
    expect(tokenDeclarations()).toEqual([]);
  });
});

describe('mail ids', () => {
  it('maps a message back to the mail it was split out of', () => {
    expect(mailIdOf(chatMessage({ id: 'm1#2', sourceId: 'm1' }))).toBe('m1');
    expect(mailIdOf(chatMessage({ id: 'm2' }))).toBe('m2');
  });

  it('reports each mail on screen once, in order', () => {
    const messages = [
      chatMessage({ id: 'm0' }),
      chatMessage({ id: 'm1#0', sourceId: 'm1' }),
      chatMessage({ id: 'm1#1', sourceId: 'm1' }),
      chatMessage({ id: 'm2' }),
    ];
    expect(visibleMailIds(messages, { firstIndex: 1, lastIndex: 3 })).toEqual(['m1', 'm2']);
  });
});
