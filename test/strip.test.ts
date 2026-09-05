import { describe, expect, it } from 'vitest';

import {
  cleanReplyBody,
  stripBanner,
  stripDisclaimer,
  stripLines,
  stripMarkers,
  stripQuote,
  stripSignature,
  stripSignOff,
} from '../src/transform/strip.js';

import {
  bodylessParser,
  parser,
  parserFailingAfter,
  squash,
  throwingParser,
} from './helpers/parser.js';

const options = { parser };

/**
 * The public strip API, exercised against the REAL default rule sets — so these
 * tests cover the shipped rules as data, not just the engines.
 */
describe('stripSignature', () => {
  // Regression: the four provider families sarvinbox had drifted into four
  // separate hand-maintained lists. Each one existed in only some code paths,
  // so mail arriving through the wrong path kept its signature. One registry,
  // one test — all four now hold everywhere.
  it.each([
    ['Gmail', '<div class="gmail_signature">Sent from Gmail</div>', 'gmail'],
    ['Gmail (smartmail)', '<div data-smartmail="gmail_signature">S</div>', 'gmail'],
    ['Gmail (dash prefix)', '<span class="gmail_signature_prefix">-- </span>', 'gmail'],
    ['Apple Mail', '<div class="AppleMailSignature">Sent from my iPhone</div>', 'apple-mail'],
    ['Thunderbird (div)', '<div class="moz-signature">-- <br>Me</div>', 'thunderbird'],
    ['Thunderbird (table)', '<table class="moz-signature"><tr><td>Me</td></tr></table>', 'thunderbird'],
    ['Outlook Mobile', '<div id="ms-outlook-mobile-signature">Get Outlook</div>', 'outlook-mobile'],
    ['Outlook desktop', '<div id="Signature">Regards, me</div>', 'outlook-desktop'],
    ['Generic', '<div class="email-signature">Regards</div>', 'generic'],
  ])('removes a %s signature', (_provider, signature, ruleName) => {
    const result = stripSignature(`<p>My reply.</p>${signature}`, options);

    expect(squash(result.html)).toBe('<p>My reply.</p>');
    expect(result.applied).toEqual([ruleName]);
  });

  // Regression: THE cross-path bug this package fixes. `div[id*="signature"]`
  // matched Outlook's entire reply wrapper and was guarded at 500 chars in one
  // sarvinbox code path but UNGUARDED in another — so that path deleted whole
  // reply bodies. The guard now lives on the rule, so it cannot be forgotten.
  it('leaves an oversized signature-ish container alone (the unguarded-selector bug)', () => {
    const long = 'This is the real body of a long Outlook reply. '.repeat(20);
    const result = stripSignature(`<div id="x_Signature_wrapper">${long}</div>`, options);

    expect(result.applied).toEqual([]);
    expect(result.html).toContain('the real body');
  });

  it('matches a signature id case-insensitively', () => {
    const result = stripSignature('<p>hi</p><div id="mySignatureBlock">Me</div>', options);
    expect(result.applied).toEqual(['outlook-desktop']);
  });

  it('reports nothing and changes nothing when there is no signature', () => {
    const result = stripSignature('<p>Just my reply.</p>', options);
    expect(result).toEqual({ html: '<p>Just my reply.</p>', applied: [] });
  });

  // Regression: a caller-supplied rule set must REPLACE the defaults, not merge
  // with them. Merging would make it impossible to opt out of a rule that
  // misfires on your corpus.
  it('replaces the default rules when given a rule set', () => {
    const html = '<div class="gmail_signature">S</div><div class="mine">M</div>';
    const result = stripSignature(html, {
      ...options,
      rules: [{ name: 'only-mine', provider: 'test', selectors: ['.mine'] }],
    });

    expect(result.applied).toEqual(['only-mine']);
    expect(result.html).toContain('gmail_signature');
  });

  it('short-circuits on an empty body', () => {
    expect(stripSignature('', options)).toEqual({ html: '', applied: [] });
  });

  // Regression: a body that will not parse must come back WHOLE. A signature
  // left on screen is cosmetic; a message that fails to render is a lost email.
  it('returns the input untouched when the parser throws', () => {
    const html = '<div class="gmail_signature">S</div>';
    expect(stripSignature(html, { parser: throwingParser })).toEqual({ html, applied: [] });
  });

  it('returns the input untouched when the document has no body', () => {
    const html = '<div class="gmail_signature">S</div>';
    expect(stripSignature(html, { parser: bodylessParser })).toEqual({ html, applied: [] });
  });
});

describe('stripQuote', () => {
  it.each([
    ['Gmail blockquote', '<blockquote class="gmail_quote">old</blockquote>', 'gmail'],
    ['Gmail div', '<div class="gmail_quote">old</div>', 'gmail'],
    ['Gmail container', '<div class="gmail_quote_container">old</div>', 'gmail'],
    ['Gmail attribution', '<div class="gmail_attr">On Mon, Bob wrote:</div>', 'gmail'],
    ['Gmail extra', '<div class="gmail_extra">old</div>', 'gmail'],
    ['cite blockquote', '<blockquote type="cite">old</blockquote>', 'cite-attribute'],
    ['Thunderbird', '<div class="moz-cite-prefix">Bob wrote:</div>', 'thunderbird'],
    ['Outlook classic', '<div class="OutlookMessageHeader">From: Bob</div>', 'outlook-classic'],
    ['Outlook OLK body', '<div id="OLK_SRC_BODY_SECTION">old</div>', 'outlook-classic'],
    ['Outlook modern reply', '<div id="divRplyFwdMsg">From: Bob</div>', 'outlook-modern'],
    ['Outlook modern prefixed', '<div id="x_divRplyFwdMsg_1">From: Bob</div>', 'outlook-modern'],
    ['Outlook appendonsend', '<div id="appendonsend"></div><div>old</div>', 'outlook-modern'],
    ['webmail reference', '<div id="mail-editor-reference-message-container">old</div>', 'webmail-reference-container'],
    ['bare blockquote', '<blockquote>old</blockquote>', 'bare-blockquote'],
  ])('removes a %s quote container', (_provider, quote, ruleName) => {
    const result = stripQuote(`<p>My reply.</p>${quote}`, options);
    expect(result.applied).toContain(ruleName);
    expect(squash(result.html)).toContain('<p>My reply.</p>');
    expect(result.html).not.toContain('>old<');
  });

  // Regression: `divRplyFwdMsg` and `appendonsend` were present in one
  // sarvinbox selector list and MISSING from the other, so Standard-view
  // bubbles kept the reply scaffolding the AI path stripped. Named explicitly
  // because it is the drift this registry exists to prevent.
  it('handles new-Outlook markers that one legacy code path lacked', () => {
    const result = stripQuote(
      '<p>Reply.</p><div id="appendonsend"></div><div id="divRplyFwdMsg">From: Bob</div>',
      options,
    );
    expect(result.applied).toEqual(['outlook-modern']);
    expect(squash(result.html)).toBe('<p>Reply.</p>');
  });

  // Regression: the full shape new Outlook actually emits. Neither marker div
  // CONTAINS the quoted thread — the header is a sibling of the body it
  // introduces and `appendonsend` is empty — so a container-only rule strips
  // the "From:" header and leaves the entire conversation visible, which looks
  // like it worked. This is why the rule is declared `boundary: true`.
  it('strips the whole quoted thread from a real new-Outlook reply', () => {
    const html = [
      '<div id="divtagdefaultwrapper"><p>Tuesday works for me.</p></div>',
      '<div id="appendonsend"></div>',
      '<hr style="display:inline-block;width:98%">',
      '<div id="divRplyFwdMsg"><b>From:</b> Alice &lt;a@x.com&gt;<br>',
      '<b>Sent:</b> Monday, 3 March 2025 10:00<br><b>Subject:</b> Meeting</div>',
      '<div><p>Can we meet Tuesday?</p></div>',
    ].join('');

    const result = stripQuote(html, options);

    expect(result.applied).toEqual(['outlook-modern']);
    expect(squash(result.html)).toBe(
      '<div id="divtagdefaultwrapper"><p>Tuesday works for me.</p></div>',
    );
  });

  it('reports nothing when there is no quoted history', () => {
    expect(stripQuote('<p>Reply.</p>', options)).toEqual({ html: '<p>Reply.</p>', applied: [] });
  });

  it('short-circuits on an empty body', () => {
    expect(stripQuote('', options)).toEqual({ html: '', applied: [] });
  });
});

describe('stripBanner', () => {
  // Regression: the gateway box, in the two element shapes it arrives in. It
  // repeats above EVERY message in a thread, so leaving it in turns a chat view
  // into a wall of the same warning.
  it.each([
    [
      'styled table',
      '<table><tr><td>CAUTION: This email originated from outside the organisation.</td></tr></table>',
      'warning-banner-box',
    ],
    ['bare div', '<div>External Email: use caution</div>', 'warning-banner-box'],
    ['single line', '<p>You don’t often get email from bob@x.example</p>', 'warning-banner-line'],
  ])('removes a %s banner', (_shape, banner, ruleName) => {
    const result = stripBanner(`<p>My reply.</p>${banner}`, options);

    expect(squash(result.html)).toBe('<p>My reply.</p>');
    expect(result.applied).toEqual([ruleName]);
  });

  // Regression: the box rule judges up to 600 characters at once, so its
  // pattern must never match a phrase a person would write. This is the fixture
  // that catches a contributor loosening it.
  it('leaves a message that merely mentions caution alone', () => {
    const html = '<div>Proceed with care on the migration, the rollback plan is attached.</div>';
    expect(stripBanner(html, options)).toEqual({ html, applied: [] });
  });

  // Regression: a banner inside a quote is part of somebody else's message and
  // belongs to their bubble, not to this pass.
  it('leaves a banner that sits inside quoted history', () => {
    const html = '<div><blockquote>External sender</blockquote></div>';
    expect(stripBanner(html, options).applied).toEqual([]);
  });

  it('short-circuits on an empty body', () => {
    expect(stripBanner('', options)).toEqual({ html: '', applied: [] });
  });
});

describe('stripLines', () => {
  // Regression: each of these is a whole visual line with no element and no
  // class of its own, so neither a selector nor a string match on the markup
  // can reach it. If this pass regresses they all reappear in the bubble.
  // The `'line'` rows keep their `<br>`: removing the line means removing the
  // TEXT that matched, and the break beside it belongs to the document, not to
  // the convention. `trimEdgeEmpties` is what clears the leftover, one pass
  // later — asserting the real output here rather than the tidy one keeps this
  // test about the rule instead of about a pass it does not run.
  it.each([
    ['delimiter', '<p>My reply.</p>-- <br>Bob', 'rfc3676-delimiter', '<p>My reply.</p>'],
    ['mobile footer', '<p>My reply.</p>Sent from my iPhone', 'mobile-footer', '<p>My reply.</p>'],
    [
      'meeting block',
      '<p>My reply.</p>Microsoft Teams meeting<br>Meeting ID: 1',
      'meeting-boilerplate',
      '<p>My reply.</p>',
    ],
    [
      'forward marker',
      '-----Original Message-----<br><p>My reply.</p>',
      'forward-marker',
      '<br><p>My reply.</p>',
    ],
    [
      'banner line',
      'CAUTION: external sender<br><p>My reply.</p>',
      'warning-banner',
      '<br><p>My reply.</p>',
    ],
  ])('applies the %s rule', (_convention, html, ruleName, expected) => {
    const result = stripLines(html, options);

    expect(squash(result.html)).toBe(expected);
    expect(result.applied).toEqual([ruleName]);
  });

  // Regression: the length cap is the only thing between the mobile-footer rule
  // and the paragraph it will otherwise eat, and `action: 'cut'` means eating
  // it takes the rest of the message too.
  it('leaves a long line that opens like a mobile footer', () => {
    const html =
      '<p>Sent from my desk this time, and I have finally read the whole contract.</p>';
    expect(stripLines(html, options)).toEqual({ html, applied: [] });
  });

  it('short-circuits on an empty body', () => {
    expect(stripLines('', options)).toEqual({ html: '', applied: [] });
  });

  it('returns the input untouched when the parser throws', () => {
    const html = '<p>hi</p>Sent from my iPhone';
    expect(stripLines(html, { parser: throwingParser })).toEqual({ html, applied: [] });
  });

  it('returns the input untouched when the document has no body', () => {
    const html = '<p>hi</p>Sent from my iPhone';
    expect(stripLines(html, { parser: bodylessParser })).toEqual({ html, applied: [] });
  });
});

describe('stripSignOff', () => {
  // Regression: the sign-off cut, end to end. Its marker is a word people also
  // use in sentences, so it is guarded by size and evidence rather than by a
  // pattern — and those guards only work on the whole parsed body.
  it('cuts a sign-off and the signature under it', () => {
    const result = stripSignOff(
      '<p>The revised deck is attached, let me know what you think before Friday.</p>' +
        '<p>Thanks,<br>Ankur<br>+91 90000 00000<br>www.sarv.com</p>',
      options,
    );

    expect(squash(result.html)).toBe(
      '<p>The revised deck is attached, let me know what you think before Friday.</p><p></p>',
    );
    expect(result.applied).toEqual(['sign-off']);
  });

  // Regression: "Thanks" as the whole message must survive. Cutting there
  // leaves an empty bubble, which reads as a delivery failure.
  it('leaves a body that is nothing but a sign-off', () => {
    const html = '<p>Thanks,<br>Ankur</p>';
    expect(stripSignOff(html, options)).toEqual({ html, applied: [] });
  });

  it('short-circuits on an empty body', () => {
    expect(stripSignOff('', options)).toEqual({ html: '', applied: [] });
  });

  it('returns the input untouched when the parser throws', () => {
    const html = '<p>hi</p>';
    expect(stripSignOff(html, { parser: throwingParser })).toEqual({ html, applied: [] });
  });

  it('returns the input untouched when the document has no body', () => {
    const html = '<p>hi</p>';
    expect(stripSignOff(html, { parser: bodylessParser })).toEqual({ html, applied: [] });
  });
});

describe('stripDisclaimer', () => {
  const FOOTER =
    'This email and any files transmitted with it are confidential and intended ' +
    'solely for the use of the individual to whom they are addressed. If you have ' +
    'received this email in error please notify the sender and delete this message.';

  it('removes an English corporate footer', () => {
    const result = stripDisclaimer(`<p>Reply.</p><div>${FOOTER}</div>`, options);
    expect(result.applied).toEqual(['english-corporate']);
    expect(squash(result.html)).toBe('<p>Reply.</p>');
  });

  // Regression: under an <hr> the `opens` requirement is waived, so a footer
  // that starts with the company name — the majority of gateway-appended ones
  // — is still caught. Without the waiver almost none of them would be.
  it('removes boilerplate after an <hr> even when it opens with a company name', () => {
    const result = stripDisclaimer(
      `<p>Reply.</p><hr><p>Acme Corp. ${FOOTER}</p>`,
      options,
    );
    expect(result.applied).toEqual(['english-corporate']);
    expect(squash(result.html)).toBe('<p>Reply.</p>');
  });

  // Regression: the hr-delimited rule is the looser fallback for footers whose
  // wording the strict rule does not recognise ("notify the sender", "delete it
  // from your system" are not in the strict signal list). Without it, the
  // second-most-common English footer phrasing survives into the bubble.
  it('falls back to the hr-delimited rule for wording the strict rule misses', () => {
    const other =
      'If you have received this transmission in error, please notify the sender ' +
      'immediately and then delete it from your system without reading, copying ' +
      'or forwarding it on to anybody else.';
    const result = stripDisclaimer(`<p>Reply.</p><hr><p>${other}</p>`, options);

    expect(result.applied).toEqual(['hr-delimited']);
    expect(squash(result.html)).toBe('<p>Reply.</p>');
  });

  // Regression: the false-positive direction, which is the one that loses mail.
  // A closing paragraph that merely sounds formal must survive.
  it('leaves an ordinary closing paragraph alone', () => {
    const html =
      '<p>Reply.</p><div>Let me know if you would like me to send the confidential ' +
      'figures over as well, and I will get them across to you first thing tomorrow.</div>';
    expect(stripDisclaimer(html, options)).toEqual({ html, applied: [] });
  });

  it('short-circuits on an empty body', () => {
    expect(stripDisclaimer('', options)).toEqual({ html: '', applied: [] });
  });

  it('returns the input untouched when the parser throws', () => {
    const html = `<div>${FOOTER}</div>`;
    expect(stripDisclaimer(html, { parser: throwingParser })).toEqual({ html, applied: [] });
  });

  it('returns the input untouched when the document has no body', () => {
    const html = `<div>${FOOTER}</div>`;
    expect(stripDisclaimer(html, { parser: bodylessParser })).toEqual({ html, applied: [] });
  });

  it('replaces the default rules when given a rule set', () => {
    const result = stripDisclaimer(`<p>R.</p><div>${FOOTER}</div>`, {
      ...options,
      rules: [{ name: 'never', signals: [/nothing-here/] }],
    });
    expect(result.applied).toEqual([]);
  });
});

describe('stripMarkers', () => {
  // These are the real shapes each client emits, entity-escaped the way the
  // client escapes them — not hand-simplified. A marker rule tested against
  // prettier input than the wild produces is a rule that does not fire.
  it.each([
    [
      'Gmail attribution div',
      '<div class="gmail_attr">On Mon, 3 Mar 2025 at 10:00, Alice &lt;a@x.com&gt; wrote:<br></div>',
      'wrote-attribution',
    ],
    ['bare attribution line', 'On Mon, 3 Mar 2025, Bob wrote:', 'wrote-attribution'],
    ['attribution paragraph', '<p>On Mon, 3 Mar 2025, Bob wrote:</p>', 'wrote-attribution'],
    ['forwarded', '---------- Forwarded message ----------', 'forwarded-message'],
    ['original message', '-----Original Message-----', 'original-message'],
    [
      'Outlook header block (br-separated)',
      'From: Bob Smith &lt;b@x.com&gt;<br>Sent: Monday, 3 March 2025 10:00<br>To: Alice<br>Subject: Hi',
      'outlook-header-block',
    ],
    [
      'Outlook header block (div-separated)',
      '<div>From: Bob Smith</div><div>Sent: Monday</div><div>Subject: Hi</div>',
      'outlook-header-block',
    ],
    ['Outlook header (single line)', 'From: Bob Smith  Sent: Monday', 'outlook-header-block'],
    ['underscore rule', `${'_'.repeat(32)}\nFrom: Bob`, 'outlook-underscore-separator'],
  ])('cuts at a %s marker', (_kind, marker, ruleName) => {
    const result = stripMarkers(`<p>My reply.</p>${marker} the rest`, options);
    expect(result.applied).toEqual([ruleName]);
    expect(result.html).toBe('<p>My reply.</p>');
  });

  // Regression: the original of this rule used an UNBOUNDED `[\s\S]*?Subject:`,
  // which is superlinear on a large body — a real stall on a long thread. The
  // bounded version must still match a normal header block, and must give up
  // rather than scan megabytes when "Subject:" is far away.
  it('bounds the Outlook header scan instead of searching the whole body', () => {
    const near = stripMarkers(`<p>R.</p><div>From: Bob</div>Subject: Hi`, options);
    expect(near.applied).toEqual(['outlook-header-block']);

    const far = `<p>R.</p><div>From: Bob</div>${'x'.repeat(5000)}Subject: Hi`;
    const start = performance.now();
    const result = stripMarkers(far, options);
    expect(performance.now() - start).toBeLessThan(500);
    expect(result.applied).not.toContain('outlook-header-block');
  });

  it('leaves a body with no marker alone', () => {
    expect(stripMarkers('<p>Reply.</p>', options)).toEqual({
      html: '<p>Reply.</p>',
      applied: [],
    });
  });

  it('short-circuits on an empty body', () => {
    expect(stripMarkers('', options)).toEqual({ html: '', applied: [] });
  });

  it('replaces the default rules when given a rule set', () => {
    const result = stripMarkers('<p>R.</p>CUT here', {
      ...options,
      rules: [{ name: 'mine', provider: 'test', patterns: [/CUT/] }],
    });
    expect(result).toEqual({ html: '<p>R.</p>', applied: ['mine'] });
  });
});

describe('cleanReplyBody', () => {
  // Regression: the whole pipeline on a realistic Gmail reply. If this breaks,
  // every bubble in the view shows the thread history again.
  it('reduces a Gmail reply to what its sender wrote', () => {
    const html = [
      '<div dir="ltr">Sounds good, Tuesday works.</div>',
      '<div class="gmail_signature">Bob Smith | Acme</div>',
      '<div class="gmail_quote">',
      '<div class="gmail_attr">On Mon, 3 Mar 2025, Alice wrote:</div>',
      '<blockquote class="gmail_quote">Can we meet Tuesday?</blockquote>',
      '</div>',
    ].join('');

    const result = cleanReplyBody(html, options);

    expect(squash(result.html)).toBe('<div dir="ltr">Sounds good, Tuesday works.</div>');
    expect(result.applied).toEqual(['signature:gmail', 'quote:gmail']);
  });

  // Regression: pass order, and this test is what established it. The
  // disclaimer here is followed by UNMARKED plain-text quoted history, so it is
  // not at the trailing edge until the marker pass has cut. Run DISCLAIMER
  // before MARKERS — as this originally did — and the footer is buried
  // mid-document where the trailing-block walk never looks, and it survives
  // into the bubble. `applied` is asserted in full because it is the record of
  // that ordering decision.
  //
  // The footer runs past 600 characters on purpose. A legal notice SHORTER than
  // that is a banner box and the banner pass takes it first — correctly, and
  // with the same result — which would leave this test asserting the banner
  // rule's ordering instead of the disclaimer rule's. The long form is the one
  // only the evidence-based pass can reach, so it is the one that pins the
  // ordering this test exists for.
  it('runs the passes in order and records each', () => {
    const html = [
      '<p>My reply.</p>',
      '<div class="gmail_signature">Bob</div>',
      '<blockquote>quoted</blockquote>',
      '<div>This email is confidential and intended solely for the addressee. If you ',
      'are not the intended recipient you are hereby notified that dissemination is ',
      'prohibited. Please delete the message. Any views expressed are those of the ',
      'sender and do not necessarily represent those of the company or its affiliates. ',
      'The company accepts no liability for any loss or damage arising from the use of ',
      'this transmission or its attachments, and gives no warranty that this message ',
      'or any file transmitted with it is free from computer viruses or other defects. ',
      'Recipients are advised to carry out their own virus checks before opening any ',
      'attachment, and to satisfy themselves that this message has not been altered in ',
      'transit.</div>',
      '<div>On Mon, Alice wrote:</div>',
      '<p>older</p>',
    ].join('');

    const result = cleanReplyBody(html, options);

    expect(result.applied).toEqual([
      'signature:gmail',
      'quote:bare-blockquote',
      'marker:wrote-attribution',
      'disclaimer:english-corporate',
    ]);
    expect(squash(result.html)).toBe('<p>My reply.</p>');
  });

  // Regression: the safety hole a bare `\bconfidential\b` in `bannerPattern`
  // opened. "The pricing is confidential until Friday" is under every length cap
  // in the package and sits in its own div like any other line, so the banner
  // pass deleted the message. Corroborated confidentiality is still caught by
  // the disclaimer rules; a single word in a sentence is not evidence.
  it('keeps a sentence that merely calls something confidential', () => {
    const result = cleanReplyBody(
      '<p>Numbers attached.</p><div>The pricing is confidential until Friday.</div>',
      options,
    );

    expect(squash(result.html)).toBe(
      '<p>Numbers attached.</p><div>The pricing is confidential until Friday.</div>',
    );
    expect(result.applied).toEqual([]);
  });

  // Regression: THE oldest-message policy. The first message in a thread has no
  // history behind it, so a quote pass over it can only misfire on content the
  // sender genuinely blockquoted — a pasted excerpt, a citation. Its signature
  // still goes; its quotes stay.
  it('keeps quoted content on the thread’s oldest message but still strips the signature', () => {
    const html =
      '<p>As the spec says:</p><blockquote>a genuine quotation</blockquote>' +
      '<div class="gmail_signature">Bob</div>';

    const result = cleanReplyBody(html, { ...options, keepQuotedHistory: true });

    expect(result.html).toContain('a genuine quotation');
    expect(result.html).not.toContain('gmail_signature');
    expect(result.applied).toEqual(['signature:gmail']);
  });

  // Regression: with keepQuotedHistory the MARKER pass must be skipped too. An
  // "On ... wrote:" line inside a quotation the sender pasted would otherwise
  // truncate the oldest message mid-sentence.
  it('skips the marker pass too when keeping quoted history', () => {
    const html = '<p>They said:</p><p>On Monday, Bob wrote: something important</p>';
    const result = cleanReplyBody(html, { ...options, keepQuotedHistory: true });

    expect(result.html).toContain('something important');
    expect(result.applied).toEqual([]);
  });

  // Regression: an unparseable body still gets its plain-text boundary trimmed,
  // rather than the whole failure being abandoned. Degrade, don't give up.
  it('falls back to the string-only marker pass when parsing fails', () => {
    const result = cleanReplyBody('My reply. On Mon, Bob wrote: old stuff', {
      parser: throwingParser,
    });

    expect(result.html).toBe('My reply. ');
    expect(result.applied).toEqual(['marker:wrote-attribution']);
  });

  it('returns the input untouched when the document has no body', () => {
    const html = '<div class="gmail_signature">S</div>';
    expect(cleanReplyBody(html, { parser: bodylessParser })).toEqual({ html, applied: [] });
  });

  it('short-circuits on an empty body', () => {
    expect(cleanReplyBody('', options)).toEqual({ html: '', applied: [] });
  });

  // Regression: a marker cut forces a SECOND parse, and it is handed HTML the
  // first parse never saw — a string sliced at a text boundary, so an unclosed
  // tag is entirely possible. If the second parse fails, the marker-stripped
  // HTML must still be returned: losing it would throw away a cut that already
  // succeeded and put the quoted thread back on screen. The disclaimer pass is
  // the only casualty, and it is the least destructive one to skip.
  it.each([
    ['throws', 'throw' as const],
    ['yields a document with no body', 'bodyless' as const],
  ])('keeps the marker-stripped HTML when the second parse %s', (_label, mode) => {
    const html = '<p>My reply.</p><p>On Mon, Bob wrote: old stuff</p>';
    const result = cleanReplyBody(html, { parser: parserFailingAfter(1, mode) });

    expect(result.html).toContain('My reply.');
    expect(result.html).not.toContain('old stuff');
    expect(result.applied).toEqual(['marker:wrote-attribution']);
  });

  // Regression: each family must be independently overridable. A consumer whose
  // corpus breaks one rule set has to be able to replace just that one.
  it('accepts a custom rule set per family', () => {
    const result = cleanReplyBody('<p>R.</p><div class="mine">x</div>', {
      ...options,
      signatureRules: [{ name: 'mine', provider: 'test', selectors: ['.mine'] }],
      bannerRules: [],
      lineRules: [],
      quoteRules: [],
      disclaimerRules: [],
      markerRules: [],
      keepSignOff: true,
    });

    expect(result.applied).toEqual(['signature:mine']);
    expect(squash(result.html)).toBe('<p>R.</p>');
  });

  // Regression: the gateway banner is a DOM pass inside the pipeline, not only a
  // standalone entry point. It repeats above every message in a thread, so
  // missing it here is the difference between a chat view and a warning wall.
  it('removes a gateway banner as part of the pipeline', () => {
    const result = cleanReplyBody(
      '<table><tr><td>CAUTION: This email originated from outside the organisation.</td></tr></table>' +
        '<p>My reply.</p>',
      options,
    );

    expect(squash(result.html)).toBe('<p>My reply.</p>');
    expect(result.applied).toEqual(['banner:warning-banner-box']);
  });

  // Regression: the LINE pass has to run inside the pipeline too — a mobile
  // footer has no element and no class, so no DOM rule can reach it and it
  // survives into the bubble if this step is dropped.
  it('cuts a mobile footer as part of the pipeline', () => {
    const result = cleanReplyBody('<p>My reply.</p>Sent from my iPhone', options);

    expect(squash(result.html)).toBe('<p>My reply.</p>');
    expect(result.applied).toEqual(['line:mobile-footer']);
  });

  // Regression: the sign-off pass runs by default and is reported under its own
  // name, so a consumer who loses content to it can find it in `applied` and
  // turn it off — which is the whole reason `keepSignOff` exists.
  const SIGNED =
    '<p>The revised deck is attached, let me know what you think before Friday.</p>' +
    '<p>Thanks,<br>Ankur<br>+91 90000 00000<br>www.sarv.com</p>';

  it('cuts a trailing sign-off by default', () => {
    const result = cleanReplyBody(SIGNED, options);

    expect(result.applied).toEqual(['sign-off']);
    expect(result.html).not.toContain('90000');
  });

  it('leaves the sign-off in place when keepSignOff is set', () => {
    const result = cleanReplyBody(SIGNED, { ...options, keepSignOff: true });

    expect(result.applied).toEqual([]);
    expect(result.html).toContain('90000');
  });

  // Regression: the transform is pure. Called twice on the same input it must
  // give the same answer — the memo in mails-to-messages depends on it, and so
  // does anyone diffing a re-render.
  it('is idempotent and free of shared state', () => {
    const html = '<p>R.</p><div class="gmail_signature">Bob</div><blockquote>old</blockquote>';
    const first = cleanReplyBody(html, options);
    const second = cleanReplyBody(html, options);

    expect(second).toEqual(first);
    expect(cleanReplyBody(first.html, options).html).toBe(first.html);
  });
});
