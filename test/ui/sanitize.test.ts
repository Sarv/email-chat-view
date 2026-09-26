// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import {
  canSanitize,
  FRAME_URI_SAFE_ATTR,
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

  // Regression: a letter of any length renders inline now, and real mail has
  // section headings in it. Without them on the allowlist `KEEP_CONTENT`
  // unwraps a heading and it reads as the first line of the paragraph below.
  it('keeps the headings a long letter is written with', () => {
    expect(sanitizeInlineHtml('<h2>Next steps</h2><p>Run the seed script.</p>')).toBe(
      '<h2>Next steps</h2><p>Run the seed script.</p>',
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

  // Regression: DOMPurify runs the scheme pattern over every attribute it does
  // not know to be URL-free, so `width="64"` failed it and was dropped. A Google
  // Sheets range pasted into Gmail sizes its columns ONLY through `<col width>`
  // under `table-layout:fixed;width:0px`, and without them it collapsed to one
  // pixel wide: a bubble that read as a screen of blank lines.
  it('keeps the column widths a pasted spreadsheet is sized by', () => {
    const clean = sanitizeFrameHtml(
      '<table cellspacing="0" cellpadding="0" dir="ltr" border="1" ' +
        'style="table-layout:fixed;width:0px;border-collapse:collapse">' +
        '<colgroup><col width="64"><col width="215"></colgroup>' +
        '<tbody><tr><td>SL NO</td><td>Description</td></tr></tbody></table>',
    );
    expect(clean).toContain('<col width="64"><col width="215">');
    expect(clean).toContain('cellspacing="0"');
    expect(clean).toContain('cellpadding="0"');
    expect(clean).toContain('dir="ltr"');
    expect(clean).toContain('border="1"');
    expect(clean).toContain('style="table-layout:fixed;width:0px;border-collapse:collapse"');
  });

  // Regression: merged cells, alignment and cell colours were lost the same
  // way. Without `colspan` a report's merged header shifts every column under
  // it, and without `bgcolor` the frame's own cell wash has nothing to soften.
  it('keeps the table structure and cell presentation', () => {
    const clean = sanitizeFrameHtml(
      '<table><tbody><tr><td colspan="2" rowspan="3" align="center" valign="top" ' +
        'width="50%" height="20" bgcolor="#c6e0b4" nowrap="nowrap">Total</td></tr></tbody></table>',
    );
    expect(clean).toContain(
      '<td colspan="2" rowspan="3" align="center" valign="top" width="50%" height="20" ' +
        'bgcolor="#c6e0b4" nowrap="nowrap">Total</td>',
    );
  });

  // Regression: `dir` is what lays out Arabic and Hebrew mail right to left,
  // and `<font>` is how older clients still colour their text.
  it('keeps text direction, language and legacy font attributes', () => {
    expect(sanitizeFrameHtml('<p dir="rtl" lang="ar">مرحبا</p>')).toBe(
      '<p dir="rtl" lang="ar">مرحبا</p>',
    );
    expect(sanitizeFrameHtml('<font color="#1f497d" face="Calibri" size="2">Hi</font>')).toBe(
      '<font color="#1f497d" face="Calibri" size="2">Hi</font>',
    );
  });

  // Regression: dropping `hidden` SHOWS what the sender hid, such as a
  // preheader written for the inbox list and never meant for the body.
  it('keeps content hidden when the sender hid it', () => {
    expect(sanitizeFrameHtml('<div hidden="hidden">preheader</div>')).toBe(
      '<div hidden="hidden">preheader</div>',
    );
  });

  // Guards the list itself. A name DOMPurify does not allow is stripped
  // whatever this list says, so an entry that fails here protects nothing.
  it.each(FRAME_URI_SAFE_ATTR)('keeps %s, which is on DOMPurify’s own allowlist', (name) => {
    const clean = sanitizeFrameHtml(
      `<table><tbody><tr><td ${name}="layout-value">x</td></tr></tbody></table>`,
    );
    expect(clean).toContain(`${name}="layout-value"`);
  });

  // Regression: exempting the layout attributes must not loosen the ones that
  // ARE URLs. A protocol-relative or relative link resolves against the host
  // application's own base URL, so only the listed schemes may survive.
  it('still checks the scheme of every attribute that is a URL', () => {
    expect(sanitizeFrameHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeFrameHtml('<a href="//evil.example/login">x</a>')).toBe('<a>x</a>');
    expect(sanitizeFrameHtml('<a href="/login">x</a>')).toBe('<a>x</a>');
    expect(sanitizeFrameHtml('<img src="//evil.example/pixel.gif">')).toBe('<img>');
    expect(
      sanitizeFrameHtml(
        '<table><tbody><tr><td background="javascript:alert(1)">x</td></tr></tbody></table>',
      ),
    ).toBe('<table><tbody><tr><td>x</td></tr></tbody></table>');
    expect(sanitizeFrameHtml('<a href="https://x.example">x</a>')).toBe(
      '<a href="https://x.example">x</a>',
    );
  });

  // Regression: an exempted attribute is never a way in. The exemption skips
  // only the scheme test, so event handlers on the same element still go.
  it('still removes event handlers beside the layout attributes', () => {
    expect(
      sanitizeFrameHtml(
        '<table><tbody><tr><td width="64" onclick="steal()">x</td></tr></tbody></table>',
      ),
    ).toBe('<table><tbody><tr><td width="64">x</td></tr></tbody></table>');
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
