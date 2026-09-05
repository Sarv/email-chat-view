// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  canSanitize,
  sanitizeFrameHtml,
  sanitizeInlineHtml,
  type Purifier,
} from '../../src/ui/sanitize.js';

/**
 * A DOMPurify that reports itself unusable, which is what the real one does
 * with no DOM — and it then returns the input UNCHANGED. That behaviour is the
 * hazard this module exists to close, and jsdom always has a window, so the
 * only way to reach the branch is to hand it a stub.
 */
const unsupported: Purifier = {
  isSupported: false,
  sanitize: (html) => html,
};

describe('sanitizeInlineHtml', () => {
  it('keeps the markup a chat message is made of', () => {
    const clean = sanitizeInlineHtml(
      '<p>Hi <b>Alice</b>, see <a href="https://x.example">this</a>.</p><ul><li>one</li></ul>',
    );
    expect(clean).toBe(
      '<p>Hi <b>Alice</b>, see <a href="https://x.example">this</a>.</p><ul><li>one</li></ul>',
    );
  });

  it('removes scripts and event handlers', () => {
    expect(sanitizeInlineHtml('<p onclick="steal()">hi</p><script>steal()</script>')).toBe(
      '<p>hi</p>',
    );
    expect(sanitizeInlineHtml('<img src=x onerror="steal()">')).toBe('');
  });

  // Regression: THE reason the inline policy is this narrow. A `style` or
  // `class` surviving here reaches the host application's cascade, and a
  // sender's `td { display: none }` restyles the app rather than the bubble.
  it('removes anything that could reach the host’s stylesheet', () => {
    expect(sanitizeInlineHtml('<p style="position:fixed;inset:0">hi</p>')).toBe('<p>hi</p>');
    expect(sanitizeInlineHtml('<p class="btn-primary" id="app">hi</p>')).toBe('<p>hi</p>');
    expect(sanitizeInlineHtml('<style>body{display:none}</style><p>hi</p>')).toBe('<p>hi</p>');
  });

  // Regression: a `javascript:` href handed to the host's link opener runs the
  // sender's code.
  it('drops a link whose scheme is not a link', () => {
    expect(sanitizeInlineHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeInlineHtml('<a href="data:text/html,<script>">x</a>')).toBe('<a>x</a>');
    expect(sanitizeInlineHtml('<a href="mailto:a@b.example">x</a>')).toBe(
      '<a href="mailto:a@b.example">x</a>',
    );
  });

  // Regression: `target` would let a message open a tab the app did not
  // sanction; link opening goes through the host's callback instead.
  it('drops the target attribute', () => {
    expect(sanitizeInlineHtml('<a href="https://x.example" target="_blank">x</a>')).toBe(
      '<a href="https://x.example">x</a>',
    );
  });

  // Regression: `KEEP_CONTENT`. Outlook wraps sentences in `<o:p>` and old mail
  // in `<font>`; deleting the wrapper AND its text is how a perfectly ordinary
  // message renders as a blank bubble.
  it('unwraps an unknown tag but keeps the sentence inside it', () => {
    expect(sanitizeInlineHtml('<font size="2">Hello there</font>')).toBe('Hello there');
    expect(sanitizeInlineHtml('<o:p>Hello there</o:p>')).toBe('Hello there');
  });

  it('has nothing to say about an empty body', () => {
    expect(sanitizeInlineHtml('')).toBe('');
    expect(sanitizeInlineHtml(null)).toBe('');
    expect(sanitizeInlineHtml(undefined)).toBe('');
    expect(sanitizeInlineHtml('   ')).toBe('');
  });

  // Regression: the worst bug this package could ship. With no DOM, DOMPurify
  // returns its input untouched, so a naive wrapper would hand raw
  // attacker-controlled HTML to `dangerouslySetInnerHTML` during SSR — on the
  // one platform where nobody is watching. It must fail CLOSED.
  it('returns nothing at all when there is no DOM to sanitize with', () => {
    expect(sanitizeInlineHtml('<script>steal()</script>', unsupported)).toBe('');
    expect(sanitizeFrameHtml('<script>steal()</script>', unsupported)).toBe('');
  });
});

describe('sanitizeFrameHtml', () => {
  // Regression: the frame's whole purpose is that the sender's layout survives.
  // Applying the inline policy here would flatten every newsletter.
  it('keeps the layout and presentation a designed email needs', () => {
    const clean = sanitizeFrameHtml(
      '<table><tr><td style="padding:8px">Hi</td></tr></table><style>td{color:red}</style>',
    );
    expect(clean).toContain('<table>');
    expect(clean).toContain('style="padding:8px"');
    expect(clean).toContain('<style>td{color:red}</style>');
  });

  it('keeps the message’s own inline images', () => {
    expect(sanitizeFrameHtml('<img src="cid:logo@1">')).toContain('cid:logo@1');
    expect(sanitizeFrameHtml('<img src="data:image/gif;base64,R0lGOD">')).toContain('data:image');
  });

  it('removes the executable and navigational surface', () => {
    const clean = sanitizeFrameHtml(
      '<script>steal()</script><iframe src="https://x.example"></iframe>' +
        '<form action="https://x.example"><input name="p"></form>' +
        '<p onmouseover="steal()">hi</p>',
    );
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('<iframe');
    expect(clean).not.toContain('<form');
    expect(clean).not.toContain('<input');
    expect(clean).not.toContain('onmouseover');
    expect(clean).toContain('<p>hi</p>');
  });

  it('has nothing to say about an empty body', () => {
    expect(sanitizeFrameHtml('')).toBe('');
    expect(sanitizeFrameHtml(null)).toBe('');
  });
});

describe('canSanitize', () => {
  it('is true where there is a DOM and false where there is not', () => {
    expect(canSanitize()).toBe(true);
    expect(canSanitize(unsupported)).toBe(false);
  });
});
