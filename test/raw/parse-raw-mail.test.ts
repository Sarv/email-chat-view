import { describe, expect, it } from 'vitest';

import { parseRawMail } from '../../src/raw/parse-raw-mail.js';
import { mailsToMessages } from '../../src/transform/mails-to-messages.js';
import { parser } from '../helpers/parser.js';

/** A raw message from header lines and a body, with the CRLFs the wire uses. */
const eml = (headers: string[], body: string): string =>
  `${headers.join('\r\n')}\r\n\r\n${body.replace(/\r?\n/g, '\r\n')}`;

/** One char per byte, the way a Latin-1 file reads. */
const latin1Bytes = (text: string): Uint8Array =>
  Uint8Array.from(text, (char) => char.charCodeAt(0));

const PLAIN = eml(
  [
    'From: "Lee, Ann" <ann@acme.example>',
    'To: me@acme.example, "Bob \\"B\\" Ray" <bob@acme.example>',
    'Subject: Lunch',
    'Date: Tue, 06 Oct 2026 10:00:00 +0000',
    'Message-ID: <lunch-1@acme.example>',
    'Content-Type: text/plain; charset=iso-8859-1',
  ],
  'Caf\xe9 at 1 & <bring> a pen\n\nOn Mon, Bob wrote:\n> earlier',
);

const PIXEL = 'iVBORw0KGgo='; // 8 bytes

const MULTIPART = eml(
  [
    'From: Ann <ann@acme.example>',
    'To: Team: me@acme.example, carl@acme.example;',
    'Cc: dee@acme.example',
    'Date: Wed, 07 Oct 2026 09:00:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="outer"',
  ],
  [
    '--outer',
    'Content-Type: multipart/related; boundary="inner"',
    '',
    '--inner',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>See <img src="cid:LOGO@acme"> and <img src="cid:missing@acme"></p>',
    '--inner',
    'Content-Type: image/png',
    'Content-ID: <logo@acme>',
    'Content-Disposition: inline',
    'Content-Transfer-Encoding: base64',
    '',
    PIXEL,
    '--inner--',
    '--outer',
    'Content-Type: application/pdf; name="report.pdf"',
    'Content-Disposition: attachment; filename="report.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    'AAEC', // 3 bytes, no padding
    '--outer',
    'Content-Type: application/octet-stream',
    'Content-Disposition: attachment',
    'Content-Transfer-Encoding: base64',
    '',
    'AAE=', // 2 bytes
    '--outer',
    'Content-Type: text/csv; name="one.csv"',
    'Content-Disposition: attachment; filename="one.csv"',
    'Content-Transfer-Encoding: base64',
    '',
    'AA==', // 1 byte
    '--outer--',
    '',
  ].join('\n'),
);

describe('parseRawMail', () => {
  it('maps headers onto a Mail and decodes the declared charset', async () => {
    const mail = await parseRawMail(latin1Bytes(PLAIN));

    expect(mail).toMatchObject({
      id: '<lunch-1@acme.example>',
      messageId: '<lunch-1@acme.example>',
      fromAddress: 'ann@acme.example',
      fromName: 'Lee, Ann',
      ccAddress: null,
      date: Date.UTC(2026, 9, 6, 10, 0, 0),
      attachments: [],
    });
    expect(mail.body).toContain('Café');
  });

  // Regression: "Lee, Ann" is how a whole Outlook directory writes names. A
  // comma-separated name column cannot carry it; the header form can, and the
  // view's address grammar reads it back.
  it('writes recipients in header form, quoting names safely', async () => {
    const mail = await parseRawMail(PLAIN);
    expect(mail.toAddress).toBe('me@acme.example, "Bob \\"B\\" Ray" <bob@acme.example>');
  });

  // Regression: a text-only mail handed over as text would have its line
  // breaks collapsed by the HTML parse, and a "<bring>" would become a tag.
  it('turns a plain-text-only body into escaped HTML with its line breaks', async () => {
    const mail = await parseRawMail(latin1Bytes(PLAIN));
    expect(mail.body).toBe(
      '<div>Café at 1 &amp; &lt;bring&gt; a pen<br><br>On Mon, Bob wrote:<br>&gt; earlier</div>',
    );
  });

  it('feeds the transform like any other mail', async () => {
    const mail = await parseRawMail(latin1Bytes(PLAIN));
    const [message] = mailsToMessages([mail], {
      parser,
      bodyFormat: 'text',
      containsThreadStart: false,
    });
    expect(message?.body).toBe('Café at 1 & <bring> a pen');
  });

  it('flattens address groups and reads Cc', async () => {
    const mail = await parseRawMail(MULTIPART);
    expect(mail.toAddress).toBe('me@acme.example, carl@acme.example');
    expect(mail.ccAddress).toBe('dee@acme.example');
  });

  // Regression: a signature logo is a `cid:` reference. Left as one, a WebView
  // or a native HTML renderer shows a broken image for every such mail.
  it('points cid: references at the attached image, case-insensitively', async () => {
    const mail = await parseRawMail(MULTIPART);
    expect(mail.body).toContain(`src="data:image/png;base64,${PIXEL}"`);
    expect(mail.body).toContain('src="cid:missing@acme"');
  });

  it('leaves cid: references alone when asked to', async () => {
    const mail = await parseRawMail(MULTIPART, { inlineImages: false });
    expect(mail.body).toContain('src="cid:LOGO@acme"');
  });

  it('lists attachments with their decoded sizes and marks body images inline', async () => {
    const mail = await parseRawMail(MULTIPART);
    expect(mail.attachments).toEqual([
      { filename: 'attachment', sizeBytes: 8, mimeType: 'image/png', inline: true },
      { filename: 'report.pdf', sizeBytes: 3, mimeType: 'application/pdf', inline: false },
      { filename: 'attachment', sizeBytes: 2, mimeType: 'application/octet-stream', inline: false },
      { filename: 'one.csv', sizeBytes: 1, mimeType: 'text/csv', inline: false },
    ]);
  });

  it('dates a mail with no Date header by when it was received', async () => {
    const mail = await parseRawMail(
      eml(
        [
          'Received: from mx.acme.example by mx.me.example; Thu, 08 Oct 2026 12:00:00 +0000',
          'From: ann@acme.example',
        ],
        'hi',
      ),
    );
    expect(mail.date).toBe(Date.UTC(2026, 9, 8, 12, 0, 0));
    expect(mail.fromName).toBeNull();
  });

  // Regression: an undated mail must say so. Epoch 0 would file it under 1970
  // and nobody would notice the separator was wrong.
  it('leaves an undated mail NaN and keys it by sender and subject', async () => {
    const mail = await parseRawMail(eml(['From: ann@acme.example', 'Subject: Hey'], 'hi'));
    expect(mail.date).toBeNaN();
    expect(mail.id).toBe('ann@acme.example||Hey');
    expect(mail.messageId).toBeNull();
  });

  it('keys a dated mail with no Message-ID by sender, date and subject', async () => {
    const mail = await parseRawMail(
      eml(['From: ann@acme.example', 'Date: Tue, 06 Oct 2026 10:00:00 +0000'], 'hi'),
    );
    expect(mail.id).toBe(`ann@acme.example|${Date.UTC(2026, 9, 6, 10, 0, 0)}|`);
  });

  it('takes the id it is given, and copes with no sender and no body', async () => {
    const mail = await parseRawMail(eml(['Subject: empty'], ''), { id: 'given' });
    expect(mail).toMatchObject({ id: 'given', fromAddress: '', fromName: null, body: '' });
  });

  it('keys a mail with nothing to go on by empty parts, not by "undefined"', async () => {
    const mail = await parseRawMail(eml(['X-Note: bare'], 'hi'));
    expect(mail.id).toBe('||');
  });

  it('reads a Blob, as a browser File input hands it over', async () => {
    const mail = await parseRawMail(new Blob([PLAIN]));
    expect(mail.fromAddress).toBe('ann@acme.example');
  });
});
