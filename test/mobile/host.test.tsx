// @vitest-environment jsdom
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DOM_EVENT, type NativeEvent } from '../../src/mobile/bridge.js';
import { bootMobileHost, mountMobileHost, type MobileHostApi } from '../../src/mobile/host.js';
import type { Mail } from '../../src/types.js';
import { settleFrameLoad } from '../helpers/frames.js';
import { chatMessage, TODAY_AT_TEN } from '../helpers/messages.js';
import { installIntersectionObserver } from '../helpers/observers.js';

const mails: Mail[] = [
  {
    id: 'm1',
    fromAddress: 'alice@acme.example',
    fromName: 'Alice',
    date: TODAY_AT_TEN,
    body: '<p>Lunch?</p>',
  },
  { id: 'm2', fromAddress: 'me@acme.example', date: TODAY_AT_TEN + 60_000, body: '<p>Sure.</p>' },
];

function mountInBody(): { api: MobileHostApi; events: NativeEvent[] } {
  const container = document.createElement('div');
  document.body.append(container);
  const events: NativeEvent[] = [];
  return { api: mountMobileHost(container, (event) => events.push(event)), events };
}

function renderState(api: MobileHostApi, state: unknown) {
  act(() => api.render(state));
}

function bubbleText() {
  return [...document.querySelectorAll('[data-sec-index]')].map((bubble) => bubble.textContent);
}

beforeEach(() => {
  installIntersectionObserver();
});

afterEach(async () => {
  await settleFrameLoad();
  document.documentElement.removeAttribute('style');
  delete (window as { EmailChatViewAndroid?: unknown }).EmailChatViewAndroid;
  vi.unstubAllGlobals();
});

describe('mountMobileHost', () => {
  it('runs the transform over mails sent as a JSON string', () => {
    const { api } = mountInBody();
    renderState(api, JSON.stringify({ mails, currentUserAddress: 'me@acme.example' }));
    const text = bubbleText();
    expect(text).toHaveLength(2);
    expect(text[0]).toContain('Lunch?');
    expect(document.querySelectorAll('.sec-bubble--mine')).toHaveLength(1);
  });

  it('renders resolved messages as given, ignoring mails', () => {
    const { api } = mountInBody();
    renderState(api, { mails, messages: [chatMessage({ id: 'x', body: 'Pre-resolved' })] });
    expect(bubbleText()).toEqual([expect.stringContaining('Pre-resolved')]);
  });

  it('renders an empty thread when native sends no mails yet', () => {
    const { api } = mountInBody();
    renderState(api, {});
    expect(bubbleText()).toEqual([]);
  });

  it('throws on a malformed state instead of rendering nothing', () => {
    const { api } = mountInBody();
    expect(() => api.render('[1, 2]')).toThrow(TypeError);
  });

  it('sets token overrides on the root and clears the ones native drops', () => {
    const { api } = mountInBody();
    const { style } = document.documentElement;
    renderState(api, { mails, tokens: { brand: '#0b57d0', surface: '#fafafa' } });
    expect(style.getPropertyValue('--brand')).toBe('#0b57d0');
    expect(style.getPropertyValue('--surface')).toBe('#fafafa');

    renderState(api, { mails, tokens: { brand: '#0b57d0' } });
    expect(style.getPropertyValue('--brand')).toBe('#0b57d0');
    expect(style.getPropertyValue('--surface')).toBe('');
  });
});

describe('bootMobileHost', () => {
  it('publishes the API before announcing ready', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const apiAtReady = vi.fn();
    window.addEventListener(
      DOM_EVENT,
      (event) =>
        apiAtReady(
          (event as CustomEvent).detail,
          (window as { EmailChatView?: unknown }).EmailChatView,
        ),
      { once: true },
    );
    const api = bootMobileHost(window);
    expect(apiAtReady).toHaveBeenCalledWith({ type: 'ready' }, api);

    renderState(api, { mails });
    expect(bubbleText()).toHaveLength(2);
  });

  it('prefers the native bridge when the platform installed one', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const postMessage = vi.fn();
    (window as { EmailChatViewAndroid?: unknown }).EmailChatViewAndroid = { postMessage };
    bootMobileHost(window);
    expect(postMessage).toHaveBeenCalledWith('{"type":"ready"}');
  });

  it('fails loudly on a page with no #root', () => {
    document.body.innerHTML = '';
    expect(() => bootMobileHost(window)).toThrow(/#root/);
  });
});
