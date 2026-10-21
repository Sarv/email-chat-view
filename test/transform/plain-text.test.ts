import { describe, expect, it } from 'vitest';

import type { HtmlParser } from '../../src/dom.js';
import {
  createBodyCache,
  mailsToMessages,
  mailToMessage,
} from '../../src/transform/mails-to-messages.js';
import { htmlToPlainText } from '../../src/transform/plain-text.js';
import type { Mail } from '../../src/types.js';
import { bodylessParser, parser } from '../helpers/parser.js';

const MARCH_3 = Date.UTC(2025, 2, 3, 10, 0, 0);

const mail = (partial: Partial<Mail> & Pick<Mail, 'id'>): Mail => ({
  fromAddress: 'alice@example.com',
  date: MARCH_3,
  ...partial,
});

describe('htmlToPlainText', () => {
  it('is empty for an empty body, and for a parser that yields no body', () => {
    expect(htmlToPlainText('', parser)).toBe('');
    expect(htmlToPlainText('<p>x</p>', bodylessParser)).toBe('');
  });

  // Regression: source indentation is whitespace a browser collapses. Kept
  // verbatim, every indented Outlook <div> becomes a line of leading spaces.
  it('collapses whitespace the way a browser does and breaks lines on blocks', () => {
    const html = '<div>\n   Hello   <b>world</b>\n</div><div>Second&nbsp;line</div>';
    expect(htmlToPlainText(html, parser)).toBe('Hello world\nSecond line');
  });

  it('keeps one space between inline runs that each carry one', () => {
    expect(htmlToPlainText('<span>a </span><span> b</span>', parser)).toBe('a b');
  });

  it('turns <br> into a line break and drops the space before it', () => {
    expect(htmlToPlainText('a <br>b', parser)).toBe('a\nb');
  });

  // Regression: a designed mail's <style> block is text nodes too. Flattened
  // naively, the first line a native bubble shows is CSS.
  it('contributes nothing for styles, scripts, comments and images', () => {
    const html =
      '<style>.a{color:red}</style><p>Hi</p><!-- note --><script>x()</script><img alt="logo">';
    expect(htmlToPlainText(html, parser)).toBe('Hi');
  });

  it('bullets unordered items and numbers ordered ones', () => {
    const html = '<ul><li>a</li><li>b</li></ul><ol><li>x</li><!-- gap --><li>y</li></ol>';
    expect(htmlToPlainText(html, parser)).toBe('• a\n• b\n1. x\n2. y');
  });

  it('keeps a <pre> block exactly as written', () => {
    expect(htmlToPlainText('<pre>a\n  b</pre><div>c</div>', parser)).toBe('a\n  b\nc');
  });

  it('breaks lines on headings and sectioning elements too', () => {
    expect(htmlToPlainText('<h1>Title</h1>body<footer>end</footer>', parser)).toBe(
      'Title\nbody\nend',
    );
  });

  // Regression: Gmail writes a blank line as <div><br></div>. A run of them is
  // a signature gap, not something a chat bubble should reproduce.
  it('caps a run of blank lines at one', () => {
    const html = '<div>a</div><div><br></div><div><br></div><div><br></div><div>b</div>';
    expect(htmlToPlainText(html, parser)).toBe('a\n\nb');
  });
});

describe("mailsToMessages with bodyFormat: 'text'", () => {
  const thread = [
    mail({ id: '1', body: '<div>First <b>message</b></div>' }),
    mail({
      id: '2',
      date: MARCH_3 + 1000,
      body: '<div>Sure</div><div class="gmail_quote">On Mon, Alice wrote:<blockquote>First message</blockquote></div>',
    }),
  ];

  it('defaults to rich text', () => {
    const [first] = mailsToMessages(thread, { parser });
    expect(first?.body).toBe('<div>First <b>message</b></div>');
  });

  // Regression: text is derived from the CLEANED html. Flattening the raw body
  // instead would put the quoted history right back into a native bubble.
  it('returns plain text cleaned exactly as the HTML is', () => {
    const [first, second] = mailsToMessages(thread, { parser, bodyFormat: 'text' });
    expect(first?.body).toBe('First message');
    expect(second?.body).toBe('Sure');
    expect(second?.applied).toEqual(mailsToMessages(thread, { parser })[1]?.applied);
  });

  it('reports a pending body as empty in either format', () => {
    const [message] = mailsToMessages([mail({ id: '1', bodyPending: true })], {
      parser,
      bodyFormat: 'text',
    });
    expect(message).toMatchObject({ body: '', bodyPending: true });
  });

  // Regression: a native host re-sends the whole thread on every change. The
  // flattening has to be memoized like the clean, or it costs a parse per
  // message per update.
  it('flattens each body once, memoized beside the HTML', () => {
    let parses = 0;
    const counting: HtmlParser = (html) => {
      parses += 1;
      return parser(html);
    };
    const cache = createBodyCache();
    const single = [mail({ id: '1', body: '<div>Hi</div>' })];

    mailsToMessages(single, { parser: counting, cache });
    const afterHtml = parses;
    mailsToMessages(single, { parser: counting, cache, bodyFormat: 'text' });
    const afterFirstText = parses;
    const [again] = mailsToMessages(single, { parser: counting, cache, bodyFormat: 'text' });

    expect(afterFirstText).toBe(afterHtml + 1);
    expect(parses).toBe(afterFirstText);
    expect(again?.body).toBe('Hi');
    expect(cache.get('1', '<div>Hi</div>')).toMatchObject({ html: '<div>Hi</div>', text: 'Hi' });
  });

  it('is available on the single-message form too', () => {
    const message = mailToMessage(mail({ id: '1', body: '<p>One</p><p>Two</p>' }), {
      isOldest: true,
      bodyFormat: 'text',
      stripOptions: { parser },
    });
    expect(message.body).toBe('One\nTwo');
  });
});
