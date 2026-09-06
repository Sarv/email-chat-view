/**
 * The shape predicates — the only rules in this package that INFER rather than
 * read a marker a client left behind.
 *
 * Every test here is really the same question asked five ways: does the
 * predicate still say no to somebody's actual message? A selector rule that
 * over-fires needs a wrong class to be present; a shape rule needs only a short
 * email with a phone number in it, which people send every day.
 */
import { describe, expect, it } from 'vitest';

import { bannerPattern } from '../../src/rules/banner.js';
import {
  containsQuote,
  distinctDomainCount,
  isBannerLineBlock,
  isContactCard,
  isLeafBlock,
  isLogoStrip,
  isPureBannerBlock,
} from '../../src/transform/block-shapes.js';
import { parseBody } from '../helpers/parser.js';

/** Parse a fragment and hand back its first element child. */
function firstElement(html: string): Element {
  const element = parseBody(html).firstElementChild;
  if (!element) throw new Error('fixture has no element');
  return element;
}

const PHONE = /\+?\d[\d ().-]{7,}\d/;
const WEB = /www\.[a-z0-9-]+\.[a-z]{2,}|https?:\/\/|[\w.%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

describe('containsQuote', () => {
  // Regression: the guard every shape predicate opens with. A quote is somebody
  // else's message; deleting a block because it "looks like a card" while it
  // holds a quote loses a whole turn of the conversation.
  it.each([
    ['blockquote', '<div><blockquote>older</blockquote></div>'],
    ['gmail class', '<div><div class="gmail_quote">older</div></div>'],
    ['gmail container', '<div><div class="gmail_quote_container">older</div></div>'],
  ])('sees a %s', (_shape, html) => {
    expect(containsQuote(firstElement(html))).toBe(true);
  });

  it('says no when there is no quote', () => {
    expect(containsQuote(firstElement('<div><p>just text</p></div>'))).toBe(false);
  });
});

describe('isLeafBlock', () => {
  // Regression: "judge this element by its whole text" is only safe when the
  // element IS one visual line. A paragraph mentioning "confidential" inside a
  // container of paragraphs must not be judged as the container's own text.
  it('accepts an element with no block-level children', () => {
    expect(isLeafBlock(firstElement('<p>External Email: use <b>caution</b></p>'))).toBe(true);
  });

  it.each(['p', 'div', 'table', 'ul', 'ol', 'blockquote'])(
    'rejects an element containing a <%s>',
    (tag) => {
      expect(isLeafBlock(firstElement(`<div><${tag}>x</${tag}></div>`))).toBe(false);
    },
  );
});

describe('distinctDomainCount', () => {
  // Regression: two distinct domains is a corporate links strip, which is one of
  // only two things that can prove a block is a signature card. Miscount it and
  // either every card survives or a one-link message is treated as one.
  it('counts each distinct domain once', () => {
    expect(distinctDomainCount('sarv.com | wave.sarv.com | sarv.com | enquiry.ai')).toBe(3);
  });

  it('finds a domain inside a URL and inside an address', () => {
    expect(distinctDomainCount('https://sarv.com and write to ankur.d@example.org')).toBe(2);
  });

  // Regression: a dial-in block's IP address and a version number in prose both
  // look like dotted labels. Requiring an alphabetic final label is what keeps
  // "upgrade to 2.10.1" from reading as a links strip.
  it('ignores numeric labels', () => {
    expect(distinctDomainCount('dial 192.168.1.1 or upgrade to 2.10.1')).toBe(0);
  });

  it('finds nothing in ordinary prose', () => {
    expect(distinctDomainCount('see you at four')).toBe(0);
  });
});

describe('isPureBannerBlock', () => {
  const isPureBanner = isPureBannerBlock(bannerPattern, 600);

  // Regression: the gateway box. Every leaf is warning text, so the whole styled
  // table is noise and repeats above every message in the thread.
  it('accepts a table whose every cell is banner text', () => {
    expect(
      isPureBanner(
        firstElement(
          '<table><tr><td>CAUTION: External sender</td></tr>' +
            '<tr><td>Do not click links unless you recognize the sender.</td></tr></table>',
        ),
      ),
    ).toBe(true);
  });

  // Regression: the shape with no leaf elements at all, which is how most
  // gateways actually write it. Walking for leaves finds none, so the block's
  // own text is the only thing there is to judge.
  it('accepts a bare div of banner text with no leaf children', () => {
    expect(isPureBanner(firstElement('<div>External Email: use caution</div>'))).toBe(true);
  });

  // Regression: THE reason "every leaf" is the test rather than "any leaf". A
  // message that merely mentions confidentiality has one real leaf, and one is
  // enough to spare the whole block.
  it('rejects a block with one real sentence among the banner lines', () => {
    expect(
      isPureBanner(
        firstElement(
          '<div><p>External sender</p><p>The pricing sheet is attached, let me know.</p></div>',
        ),
      ),
    ).toBe(false);
  });

  it('rejects a block holding quoted history', () => {
    expect(
      isPureBanner(firstElement('<div><p>External sender</p><blockquote>older</blockquote></div>')),
    ).toBe(false);
  });

  // Regression: a leaf that is only whitespace carries no signal either way.
  // Treating it as content would spare every banner box a mail client formatted
  // with an empty cell.
  it('ignores empty leaves', () => {
    expect(
      isPureBanner(firstElement('<div><p></p><p>Confidentiality notice</p><p>   </p></div>')),
    ).toBe(true);
  });

  // Regression: nested containers are skipped so their own leaves get judged
  // instead. Judging a container by its concatenated text would blow past the
  // length cap and spare a genuine multi-cell banner box.
  it('judges the leaves inside a nested container, not the container', () => {
    expect(
      isPureBanner(
        firstElement('<div><div><p>Disclaimer</p><p>Notify the sender.</p></div></div>'),
      ),
    ).toBe(true);
  });

  // Regression: an oversized "banner" is a legal wall of text, and the
  // disclaimer rules handle it with corroborating evidence. Taking it here on a
  // single phrase match would delete blocks nothing has proven are boilerplate.
  it('rejects a leaf past the length cap', () => {
    const long = `Caution: ${'x'.repeat(700)}`;
    expect(isPureBanner(firstElement(`<div><p>${long}</p></div>`))).toBe(false);
  });

  it('rejects an element with no text at all', () => {
    expect(isPureBanner(firstElement('<div></div>'))).toBe(false);
  });
});

describe('isBannerLineBlock', () => {
  const isBannerLine = isBannerLineBlock(bannerPattern, 80);

  it('accepts a short standalone warning line', () => {
    expect(isBannerLine(firstElement('<p>CAUTION: this email came from outside</p>'))).toBe(true);
  });

  // Regression: the length cap is the only thing between this rule and a real
  // paragraph. "The report is confidential until Friday, and here is why…" is
  // somebody's sentence, and it matches the pattern.
  it('rejects a long line that merely mentions confidentiality', () => {
    expect(
      isBannerLine(
        firstElement(
          '<p>The pricing is confidential until Friday, so please hold it until the board has seen it.</p>',
        ),
      ),
    ).toBe(false);
  });

  it('rejects a container even when its text matches', () => {
    expect(isBannerLine(firstElement('<div><p>External sender</p></div>'))).toBe(false);
  });
});

describe('isContactCard', () => {
  const isCard = isContactCard(PHONE, WEB, 400);

  // Regression: the classic rich-editor card. Name, title, phone, website, a
  // logo, and not one class to select on.
  it('accepts a table card with a phone and a website', () => {
    expect(
      isCard(
        firstElement(
          '<table><tr><td><img src="logo.png"></td>' +
            '<td>Ankur Dubey<br>+91 90000 00000<br>www.sarv.com</td></tr></table>',
        ),
      ),
    ).toBe(true);
  });

  // Regression: the phone-less corporate card. A row of product domains is a
  // signature on its own, and prose never lists two of them.
  it('accepts a links strip with two domains and no phone', () => {
    expect(
      isCard(firstElement('<table><tr><td>sarv.com | deepcall.com | enquiry.ai</td></tr></table>')),
    ).toBe(true);
  });

  // Regression: requiring BOTH halves is what keeps a short message that happens
  // to embed a picture and a link from being read as a signature.
  it('rejects a block with a website but no phone', () => {
    expect(isCard(firstElement('<div><img src="a.png">See www.sarv.com for the deck.</div>'))).toBe(
      false,
    );
  });

  // Regression: a plain text run is not a card however contact-like it reads —
  // the shape has to be there too, or every sign-off line qualifies.
  it('rejects a div with no image and no table layout', () => {
    expect(isCard(firstElement('<div>Ankur, +91 90000 00000, www.sarv.com</div>'))).toBe(false);
  });

  it('rejects a block past the length cap', () => {
    const long = 'x'.repeat(420);
    expect(
      isCard(firstElement(`<table><tr><td>${long} +91 90000 00000 www.sarv.com</td></tr></table>`)),
    ).toBe(false);
  });

  it('rejects a block holding quoted history', () => {
    expect(
      isCard(
        firstElement(
          '<table><tr><td><blockquote>older</blockquote>+91 90000 00000 www.sarv.com</td></tr></table>',
        ),
      ),
    ).toBe(false);
  });
});

describe('isLogoStrip', () => {
  const isStrip = isLogoStrip(2, 48);

  it('accepts a row of logos with almost no text', () => {
    expect(
      isStrip(firstElement('<div><img src="a.png"><img src="b.png"><img src="c.png"></div>')),
    ).toBe(true);
  });

  // Regression: two images, not one. A single image with little text around it
  // is just as likely to be the screenshot the message was sent to deliver.
  it('rejects a lone image', () => {
    expect(isStrip(firstElement('<div><img src="chart.png"></div>'))).toBe(false);
  });

  // Regression: images with real words beside them are content — an inline
  // screenshot in a short reply, not signature furniture.
  it('rejects images sitting next to a sentence', () => {
    expect(
      isStrip(
        firstElement(
          '<div><img src="a.png"><img src="b.png">Here are the two charts we went through this morning, ' +
            'the second one is the revised forecast.</div>',
        ),
      ),
    ).toBe(false);
  });

  it('rejects a strip holding quoted history', () => {
    expect(
      isStrip(
        firstElement('<div><blockquote>older</blockquote><img src="a.png"><img src="b.png"></div>'),
      ),
    ).toBe(false);
  });
});
