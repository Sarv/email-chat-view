import { describe, expect, it } from 'vitest';

import { inspectBody, SIMPLE_TEXT_LIMIT } from '../../src/ui/body-shape.js';
import { bodylessParser, parser, throwingParser } from '../helpers/parser.js';

/** Every call injects the parser, exactly as a server-side consumer must. */
const options = { parser };

describe('inspectBody', () => {
  it('reports nothing to render for a missing body', () => {
    const nothing = { kind: 'empty', html: '', text: '', hasRemoteImages: false };
    expect(inspectBody(undefined, options)).toEqual(nothing);
    expect(inspectBody(null, options)).toEqual(nothing);
    expect(inspectBody('   ', options)).toEqual(nothing);
  });

  // Regression: the strip passes routinely hollow a body out — a reply whose
  // only content was a quote leaves wrapper divs behind. Rendering that as
  // `simple` gives the reader an empty bubble that looks like a bug, instead of
  // the "no new content" note that explains it.
  it('reports markup with no text and no media as empty', () => {
    const shape = inspectBody('<div><div></div><br></div>', options);
    expect(shape.kind).toBe('empty');
    expect(shape.text).toBe('');
    // Nothing to render, so nothing IS rendered — an `empty` shape must not
    // hand the caller markup it would then have to know to ignore.
    expect(shape.html).toBe('');
  });

  it('renders a short text body inline', () => {
    const shape = inspectBody('<p>Sounds good — see you at 4.</p>', options);
    expect(shape.kind).toBe('simple');
    expect(shape.text).toBe('Sounds good — see you at 4.');
    expect(shape.hasRemoteImages).toBe(false);
  });

  it('frames a body longer than the text limit', () => {
    const long = `<p>${'word '.repeat(SIMPLE_TEXT_LIMIT)}</p>`;
    expect(inspectBody(long, options).kind).toBe('rich');
  });

  it('honours a caller’s own text limit', () => {
    const body = '<p>0123456789</p>';
    expect(inspectBody(body, { parser, textLimit: 5 }).kind).toBe('rich');
    expect(inspectBody(body, { parser, textLimit: 50 }).kind).toBe('simple');
  });

  // Regression: THE reason a rich body goes in a frame. A table-based
  // newsletter's own CSS, injected into the host's DOM, restyles the
  // application around it.
  it('frames a body with layout or media, however short', () => {
    for (const markup of [
      '<table><tr><td>Hi</td></tr></table>',
      '<p>Hi</p><img src="cid:logo">',
      '<pre>code</pre>',
      '<svg></svg>',
      '<video></video>',
    ]) {
      expect(inspectBody(markup, options).kind).toBe('rich');
    }
  });

  // Regression: this flag drives the tracking-pixel banner. A remote image the
  // inspection missed turns the protection off silently, which is the one
  // failure mode that cannot be seen in the UI.
  it('spots every remote image scheme, including protocol-relative', () => {
    for (const source of ['http://x.example/p.gif', 'https://x.example/p.gif', '//x.example/p.gif']) {
      expect(inspectBody(`<p>hi</p><img src="${source}">`, options).hasRemoteImages).toBe(true);
    }
    // Uppercase scheme and stray whitespace in the VALUE, which is what this
    // module normalizes. Attribute-NAME casing (`SRC=`) is the parser's job:
    // the browser `DOMParser` lowercases it during parsing, linkedom does not,
    // so that one is a property of the parser a consumer injects.
    expect(inspectBody('<p>hi</p><img src="  HTTPS://x.example/p.gif ">', options).hasRemoteImages).toBe(
      true,
    );
  });

  // Regression: `cid:` is the message's own inline part and `data:` is already
  // embedded — neither touches the network, and treating a signature logo as a
  // tracking pixel puts a privacy banner on ordinary mail.
  it('does not count local image sources as remote', () => {
    expect(inspectBody('<img src="cid:logo">', options).hasRemoteImages).toBe(false);
    expect(inspectBody('<img src="data:image/gif;base64,R0lGOD">', options).hasRemoteImages).toBe(
      false,
    );
    expect(inspectBody('<img>', options).hasRemoteImages).toBe(false);
  });

  it('still reports remote images on a body with no text at all', () => {
    // A one-pixel beacon and nothing else: the classic tracking mail.
    const shape = inspectBody('<img src="https://x.example/p.gif" width="1" height="1">', options);
    expect(shape.kind).toBe('rich');
    expect(shape.hasRemoteImages).toBe(true);
  });

  it('reports the visible text with its whitespace collapsed', () => {
    expect(inspectBody('<p>Hi\n\n  there</p>', options).text).toBe('Hi there');
  });

  // Regression: a body that cannot be parsed must not take the thread down —
  // 199 other messages still have to render. It fails safe on both axes: into
  // the sandboxed frame, with the image banner still up.
  it('falls back to the safest possible answer when the parser fails', () => {
    // The html is the ORIGINAL: a body we could not parse is one we have no
    // business trimming, and returning '' here would blank the message.
    const expected = { kind: 'rich', html: '<p>hi</p>', text: '', hasRemoteImages: true };
    expect(inspectBody('<p>hi</p>', { parser: throwingParser })).toEqual(expected);
    expect(inspectBody('<p>hi</p>', { parser: bodylessParser })).toEqual(expected);
  });

  it('defaults to the platform parser, which this environment does not have', () => {
    // Node with no injected parser is exactly the consumer mistake the
    // transform layer documents — and it must degrade, not throw.
    expect(inspectBody('<p>hi</p>')).toEqual({
      kind: 'rich',
      html: '<p>hi</p>',
      text: '',
      hasRemoteImages: true,
    });
  });
});

describe('inspectBody trailing dead space', () => {
  // Regression: THE "why is there a screenful of blank under this message"
  // bug. A bubble is sized to its content and the frame's measured height
  // counts empty ELEMENTS as layout, so a tail of `<div><br></div>` — which is
  // what Gmail and Outlook leave behind, and what stripping a signature or a
  // quote leaves behind — reserves real space the reader cannot explain.
  it('drops a tail of empty wrappers', () => {
    const shape = inspectBody(
      '<div>Thanks!</div><div><br></div><div>&nbsp;</div><div><div><br></div></div><br>',
      options,
    );
    expect(shape.html).toBe('<div>Thanks!</div>');
  });

  // Regression: the tail is not always a sibling. A body whose last real line
  // sits inside a wrapper carries its dead space inside that wrapper too, and
  // a trim that only looked at the top level would leave all of it.
  it('follows the tail down into the last surviving element', () => {
    const shape = inspectBody('<div><p>Regards</p><p><br></p></div>', options);
    expect(shape.html).toBe('<div><p>Regards</p></div>');
  });

  // Regression: the trim must never eat content. An image-only div has no text
  // at all — treat it as blank and a signature logo, a receipt's barcode or a
  // one-image message disappears from the end of the thread.
  it('keeps a trailing element that holds media rather than nothing', () => {
    const shape = inspectBody('<p>See below</p><div><img src="cid:logo"></div>', options);
    expect(shape.html).toBe('<p>See below</p><div><img src="cid:logo"></div>');
  });

  it('leaves a body with no dead space exactly as it was', () => {
    const shape = inspectBody('<p>One</p><p>Two</p>', options);
    expect(shape.html).toBe('<p>One</p><p>Two</p>');
  });

  // Regression: a blank line the sender put BETWEEN two paragraphs is their
  // formatting, not dead space. Only the tail is trimmed — collapsing interior
  // gaps is a different, opinionated pass this one must not become.
  it('leaves blank space in the middle of a body alone', () => {
    const shape = inspectBody('<p>One</p><div><br></div><div><br></div><p>Two</p>', options);
    expect(shape.html).toBe('<p>One</p><div><br></div><div><br></div><p>Two</p>');
  });

  // Regression: the trim runs BEFORE the body is measured and classified, so a
  // message that is only just over the inline limit is not pushed into a frame
  // by whitespace the reader never sees.
  it('measures and classifies what is left, not what arrived', () => {
    const tail = '<div><br></div>'.repeat(40);
    const shape = inspectBody(`<p>0123456789</p>${tail}`, { parser, textLimit: 10 });
    expect(shape.kind).toBe('simple');
    expect(shape.text).toBe('0123456789');
  });

  // A body nested deeper than the recursion guard keeps whatever dead space is
  // below that point — a deliberate limitation, not an accident: no real
  // message buries its last line sixty-four wrappers down, and the guard is
  // what stops a pathological one recursing the stack away.
  it('stops descending at the depth guard', () => {
    const depth = 80;
    const html = `${'<div>'.repeat(depth)}Deep<br>${'</div>'.repeat(depth)}`;
    expect(inspectBody(html, options).html).toContain('Deep<br>');
  });
});
