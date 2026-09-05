import { describe, expect, it } from 'vitest';

import {
  bannerLine,
  forwardMarkerLine,
  gibberishBlobLine,
  lineRules,
  meetingBoilerplateLine,
  mobileFooterLine,
  signatureDelimiterLine,
} from '../../src/rules/line.js';
import type { LineRule } from '../../src/rules/types.js';
import { applyLineRules } from '../../src/transform/apply-line-rules.js';

import { parseBody, squash } from '../helpers/parser.js';

/** Run the default rule set over a body and report what survived. */
function run(html: string, rules: readonly LineRule[] = lineRules) {
  const body = parseBody(html);
  const applied = applyLineRules(body, rules);
  return { html: squash(body.innerHTML), applied };
}

describe('applyLineRules — cut rules', () => {
  // Regression: the RFC 3676 delimiter is the one signature marker that is
  // actually standardized. Missing it leaves the whole signature in the bubble.
  it('cuts at a "--" delimiter and takes everything after it', () => {
    const { html, applied } = run('Hello there<br>-- <br>Ankur Dubey<br>Sarv');
    expect(html).toBe('Hello there<br>');
    expect(applied).toEqual(['rfc3676-delimiter']);
  });

  it('cuts at a long underscore rule', () => {
    expect(run('Body<br>__________<br>signature').html).toBe('Body<br>');
  });

  // Regression: the whole line must BE the delimiter. A message containing a
  // dash mid-sentence must survive — this is the pattern most likely to eat a
  // real message if it ever loosens.
  it('leaves a dash inside a sentence alone', () => {
    const body = 'We shipped it -- finally<br>and it works';
    expect(run(body).html).toBe(body);
  });

  it('cuts at a mobile footer', () => {
    const { html, applied } = run('On it.<br>Sent from my iPhone<br>junk');
    expect(html).toBe('On it.<br>');
    expect(applied).toEqual(['mobile-footer']);
  });

  // Regression: the length cap is the only thing separating a footer from a
  // sentence that opens with the same words.
  it('leaves a long line that merely starts like a mobile footer', () => {
    const body = 'Sent from my phone, sorry for the typos, I could not reach you earlier today at all';
    expect(run(body).html).toBe(body);
  });

  it('cuts at Teams join boilerplate', () => {
    const { html, applied } = run('See you then.<br>Microsoft Teams meeting<br>Join the meeting now');
    expect(html).toBe('See you then.<br>');
    expect(applied).toEqual(['meeting-boilerplate']);
  });

  // Regression: the earliest cut wins regardless of which rule found it. If
  // each rule ran as its own top-to-bottom pass, adding a rule could move where
  // an existing rule cuts — and the rule set would stop being order-independent.
  it('takes the earliest cut when two cut rules both match', () => {
    const { html, applied } = run('Body<br>Sent from my iPhone<br>-- <br>sig');
    expect(html).toBe('Body<br>');
    expect(applied).toEqual(['mobile-footer']);
  });

  // Regression: a cut ends the pass. Continuing would let a later rule report
  // itself as applied against content that is already gone.
  it('reports only the rule that cut', () => {
    const { applied } = run('Body<br>-- <br>Sent from my iPhone');
    expect(applied).toEqual(['rfc3676-delimiter']);
  });
});

describe('applyLineRules — line rules', () => {
  // Regression: this separator sits ABOVE content that is already its own
  // bubble by the time this runs. Cutting here would delete somebody's message.
  it('removes a forward marker without touching what follows', () => {
    const { html, applied } = run('-----Original Message-----<br>the forwarded body');
    expect(html).toBe('<br>the forwarded body');
    expect(applied).toEqual(['forward-marker']);
  });

  it('removes a leading external-sender banner', () => {
    const { html, applied } = run('External Email: use caution<br>Real message here');
    expect(html).toBe('<br>Real message here');
    expect(applied).toEqual(['warning-banner']);
  });

  // Regression: the banner cap. A real paragraph discussing confidentiality is
  // the message, and dropping it is silent data loss the reader cannot detect.
  it('leaves a long sentence that merely mentions confidentiality', () => {
    const body =
      'I checked with legal and they confirmed the report is confidential until the board signs off on it next week.';
    expect(run(body).html).toBe(body);
  });

  it('removes an encoded blob wall', () => {
    const blob = 'A1b2C3d4E5f6'.repeat(10);
    const { html, applied } = run(`Real text<br>${blob}<br>more real text`);
    expect(html).toBe('Real text<br><br>more real text');
    expect(applied).toEqual(['encoded-blob']);
  });

  // Regression: `/` is a base64 character, so an unanchored run matches the
  // middle of a long URL path and deletes the one thing the message was sent to
  // deliver. Only the token boundary — which the scheme's `:` breaks — stops it.
  it('leaves a long URL alone', () => {
    const body = 'https://example.com/some/very/long/path/that/goes/on/and/on/forever/and/ever/still';
    expect(run(body).html).toBe(body);
  });

  it('leaves a JWT alone', () => {
    const jwt = `Bearer ${'a'.repeat(40)}.${'b'.repeat(40)}.${'c'.repeat(40)}`;
    expect(run(jwt).html).toBe(jwt);
  });

  // Regression: the blob still has to be caught when it sits on a line with
  // ordinary words, which is how a leaked MIME part usually arrives.
  it('still catches a blob token surrounded by words', () => {
    const blob = 'A1b2C3d4E5f6'.repeat(10);
    expect(run(`prefix ${blob} suffix`).applied).toEqual(['encoded-blob']);
  });

  it('removes several banner lines in one pass', () => {
    const { applied } = run('CAUTION: external sender<br>Body<br>TCS Confidential');
    expect(applied).toEqual(['warning-banner', 'warning-banner']);
  });
});

describe('applyLineRules — engine', () => {
  it('reports nothing and changes nothing when no rule matches', () => {
    const { html, applied } = run('<p>Just an ordinary message.</p>');
    expect(html).toBe('<p>Just an ordinary message.</p>');
    expect(applied).toEqual([]);
  });

  it('ignores whitespace-only text nodes', () => {
    expect(run('<p>a</p>   <p>b</p>').applied).toEqual([]);
  });

  // Regression: both actions mutate the tree, and a live TreeWalker sitting on
  // a node that has just been removed stops early in linkedom — leaving the
  // rest of the body unexamined, which looks exactly like "no rule matched".
  it('keeps examining the body after removing a line', () => {
    const { applied } = run('External sender<br>Body<br>-- <br>sig');
    expect(applied).toEqual(['warning-banner', 'rfc3676-delimiter']);
  });

  // Regression: the invariant that lets the engine skip an "is this node still
  // attached?" check. `'line'` must detach ONLY the node it just tested —
  // reaching a sibling would mean the rest of the collected list describes
  // content nobody can see, and every later match would be credited for
  // removing something already gone.
  it('detaches only the line it matched, leaving its siblings in place', () => {
    const nested = parseBody('<div>External sender<br>keep<br>keep too</div>');
    const applied = applyLineRules(nested, [bannerLine]);
    expect(applied).toEqual(['warning-banner']);
    expect(squash(nested.innerHTML)).toBe('<div><br>keep<br>keep too</div>');
  });

  it('does nothing for a root with no owner document', () => {
    const detached = { ownerDocument: null } as unknown as Element;
    expect(applyLineRules(detached, lineRules)).toEqual([]);
  });

  it('accepts a caller-composed subset of the rules', () => {
    const { html, applied } = run('Body<br>Sent from my iPhone<br>tail', [signatureDelimiterLine]);
    expect(html).toBe('Body<br>Sent from my iPhone<br>tail');
    expect(applied).toEqual([]);
  });
});

describe('lineRules', () => {
  // Regression: a rule that is exported but left out of the default set is
  // dead code that looks alive — the failure is invisible until someone asks
  // why their Teams boilerplate is still showing.
  it('contains every exported rule exactly once', () => {
    expect(lineRules).toEqual([
      signatureDelimiterLine,
      mobileFooterLine,
      meetingBoilerplateLine,
      forwardMarkerLine,
      bannerLine,
      gibberishBlobLine,
    ]);
  });

  // Regression: 'cut' deletes everything after the match. A rule that declares
  // it must genuinely mean "the message ends here", and the review that catches
  // a wrong one starts with knowing which rules claim it.
  it('reserves the destructive action for genuine terminators', () => {
    const cutting = lineRules.filter((rule) => rule.action === 'cut').map((rule) => rule.name);
    expect(cutting).toEqual(['rfc3676-delimiter', 'mobile-footer', 'meeting-boilerplate']);
  });
});
