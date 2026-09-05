import { describe, expect, it } from 'vitest';

import type { DisclaimerRule } from '../src/rules/types.js';
import { applyDisclaimerRules } from '../src/transform/apply-disclaimer-rules.js';

import { parseBody, squash } from './helpers/parser.js';

/** A realistic corporate footer, long enough to clear the default length floor. */
const DISCLAIMER =
  'This email and any attachments are confidential and intended solely for the ' +
  'addressee. If you are not the intended recipient you are hereby notified that ' +
  'any dissemination is prohibited. Please delete this message and notify the sender.';

const strict: DisclaimerRule = {
  name: 'strict',
  opens: /^this email/i,
  signals: [/confidential/i, /intended recipient/i, /hereby notified/i],
  minSignals: 2,
  minTextLength: 120,
};

const lenient: DisclaimerRule = {
  name: 'lenient',
  signals: [/confidential/i],
  minSignals: 1,
  minTextLength: 0,
};

/**
 * Disclaimer removal is the riskiest pass in the package: it deletes a trailing
 * block on EVIDENCE rather than on a provider marker, so a loose rule silently
 * eats the end of real messages. Every test below is either "removes the
 * boilerplate" or "refuses to remove content", and the second kind matters more.
 */
describe('applyDisclaimerRules', () => {
  describe('strategy 1 — after an <hr>', () => {
    // Regression: the common gateway-appended shape. The <hr> IS the boundary,
    // so a single corroborating signal in the tail is enough.
    it('removes the divider and everything after it', () => {
      const body = parseBody(`<p>My reply.</p><hr><p>${DISCLAIMER}</p>`);
      expect(applyDisclaimerRules(body, [lenient])).toEqual(['lenient']);
      expect(squash(body.innerHTML)).toBe('<p>My reply.</p>');
    });

    // Regression: `opens` is NOT required under this strategy — the divider
    // supplies the boundary. If it were required, most gateway footers (which
    // start with a company name, not "This email") would survive.
    it('does not require `opens` when an <hr> supplies the boundary', () => {
      const body = parseBody(
        `<p>Reply.</p><hr><p>Acme Ltd. ${DISCLAIMER}</p>`,
      );
      expect(applyDisclaimerRules(body, [strict])).toEqual(['strict']);
      expect(squash(body.innerHTML)).toBe('<p>Reply.</p>');
    });

    // Regression: an <hr> is also plain punctuation. Removing everything after
    // every horizontal rule would truncate ordinary formatted mail.
    it('leaves an <hr> alone when the tail is not boilerplate', () => {
      const html = '<p>Reply.</p><hr><p>And one more thought.</p>';
      const body = parseBody(html);
      expect(applyDisclaimerRules(body, [lenient])).toEqual([]);
      expect(squash(body.innerHTML)).toBe(html);
    });

    // Regression: a trailing <hr> with nothing after it must be a no-op, not a
    // crash or a spurious hit.
    it('skips a divider with an empty tail', () => {
      const body = parseBody('<p>Reply.</p><hr>');
      expect(applyDisclaimerRules(body, [lenient])).toEqual([]);
    });

    // Regression: the reason dividers are scanned BACKWARDS. A divider's tail
    // is everything after it, so an early decorative <hr> has the real footer
    // in its tail — scanned front-to-back, the rule fires on the early divider
    // and deletes every genuine paragraph between the two. Found by this test.
    it('cuts at the latest boilerplate divider, not an earlier decorative one', () => {
      const body = parseBody(
        `<p>Reply.</p><hr><p>More content.</p><hr><p>${DISCLAIMER}</p>`,
      );
      expect(applyDisclaimerRules(body, [lenient])).toEqual(['lenient']);
      expect(squash(body.innerHTML)).toBe('<p>Reply.</p><hr><p>More content.</p>');
    });

    // Regression: the safe-degradation half of that decision. When the final
    // divider's tail is too short to judge, the walk steps back and takes more
    // rather than giving up — a disclaimer with an internal <hr> still goes.
    it('steps back to an earlier divider when the last tail is too short to judge', () => {
      const body = parseBody(
        `<p>Reply.</p><hr><p>${DISCLAIMER}</p><hr><p>Ref 41</p>`,
      );
      expect(applyDisclaimerRules(body, [strict])).toEqual(['strict']);
      expect(squash(body.innerHTML)).toBe('<p>Reply.</p>');
    });

    // Regression: the length floor applies here too, so a one-line "Confidential"
    // caption under a divider is not treated as a legal footer.
    it('respects minTextLength under a divider', () => {
      const html = '<p>Reply.</p><hr><p>Confidential.</p>';
      const body = parseBody(html);
      expect(applyDisclaimerRules(body, [strict])).toEqual([]);
      expect(squash(body.innerHTML)).toBe(html);
    });
  });

  describe('strategy 2 — trailing block', () => {
    // Regression: the no-divider shape. The bar is higher because there is no
    // structural evidence: the block must OPEN with boilerplate phrasing.
    it('removes a trailing block that opens with boilerplate', () => {
      const body = parseBody(`<p>My reply.</p><div>${DISCLAIMER}</div>`);
      expect(applyDisclaimerRules(body, [strict])).toEqual(['strict']);
      expect(squash(body.innerHTML)).toBe('<p>My reply.</p>');
    });

    // Regression: THE guard that makes descending safe. A block containing real
    // content followed by a footer does not START with boilerplate, so it fails
    // the `opens` test and the walk goes inside it — instead of deleting the
    // message along with the footer.
    it('descends into a wrapper rather than deleting content plus footer', () => {
      const body = parseBody(
        `<div><p>Here is the actual answer.</p><div>${DISCLAIMER}</div></div>`,
      );
      expect(applyDisclaimerRules(body, [strict])).toEqual(['strict']);
      expect(squash(body.innerHTML)).toBe('<div><p>Here is the actual answer.</p></div>');
    });

    // Regression: a rule with no `opens` must be inert under this strategy. It
    // exists only for the <hr> case; letting it judge a bare trailing block on
    // signals alone would delete any paragraph mentioning "confidential".
    it('ignores a rule with no `opens` when there is no divider', () => {
      const html = `<p>Reply.</p><div>${DISCLAIMER}</div>`;
      const body = parseBody(html);
      expect(applyDisclaimerRules(body, [lenient])).toEqual([]);
      expect(squash(body.innerHTML)).toBe(html);
    });

    // Regression: enough signals or nothing happens. One keyword is a sentence
    // about confidentiality; several is a legal footer.
    it('requires minSignals distinct signals', () => {
      const html =
        '<p>Reply.</p><div>This email is being sent to you as a courtesy because you ' +
        'asked me to follow up, and I wanted to make sure it reached you today.</div>';
      const body = parseBody(html);
      expect(applyDisclaimerRules(body, [strict])).toEqual([]);
      expect(squash(body.innerHTML)).toBe(html);
    });

    // Regression: the length floor. Short trailing lines ("This email is
    // confidential.") are frequently part of what the sender wrote.
    it('requires minTextLength', () => {
      const html = '<p>Reply.</p><div>This email is confidential, intended recipient only.</div>';
      const body = parseBody(html);
      expect(applyDisclaimerRules(body, [strict])).toEqual([]);
      expect(squash(body.innerHTML)).toBe(html);
    });

    // Regression: the walk must terminate. Each level here holds real content
    // followed by the next wrapper, so every level fails `opens` and the walk
    // keeps descending — exactly the shape that would spin without a cap.
    // Under the cap the footer is found; beyond it the walk gives up and leaves
    // the message intact, which is the safe direction to fail in.
    const nest = (depth: number) =>
      `${'<div><span>alpha</span>'.repeat(depth)}<div>${DISCLAIMER}</div>${'</div>'.repeat(depth)}`;

    it('descends through wrappers up to the depth cap', () => {
      const body = parseBody(`<p>Reply.</p>${nest(10)}`);
      expect(applyDisclaimerRules(body, [strict])).toEqual(['strict']);
      expect(body.textContent).not.toContain('hereby notified');
    });

    it('stops at the depth cap instead of walking forever', () => {
      const body = parseBody(`<p>Reply.</p>${nest(40)}`);
      expect(applyDisclaimerRules(body, [strict])).toEqual([]);
      expect(body.textContent).toContain('hereby notified');
    });

    // Regression: reaching a text node (not an element) ends the walk. Without
    // this the engine would try to `.remove()` something it cannot.
    it('stops when the last meaningful child is a text node', () => {
      const body = parseBody('<p>Reply.</p>trailing bare text');
      expect(applyDisclaimerRules(body, [strict])).toEqual([]);
    });

    it('stops on an empty body', () => {
      expect(applyDisclaimerRules(parseBody('   '), [strict])).toEqual([]);
    });
  });

  // Regression: both strategies run, in that order, and both can fire on one
  // message — a gateway footer under an <hr> plus the sender's own corporate
  // block above it is an ordinary combination.
  it('applies both strategies and reports both rules', () => {
    const body = parseBody(
      `<p>Reply.</p><div>${DISCLAIMER}</div><hr><p>Scanned by Acme. ${DISCLAIMER}</p>`,
    );
    const applied = applyDisclaimerRules(body, [lenient, strict]);

    expect(applied).toEqual(['lenient', 'strict']);
    expect(squash(body.innerHTML)).toBe('<p>Reply.</p>');
  });

  it('does nothing with an empty rule set', () => {
    const html = `<p>Reply.</p><div>${DISCLAIMER}</div>`;
    const body = parseBody(html);
    expect(applyDisclaimerRules(body, [])).toEqual([]);
    expect(squash(body.innerHTML)).toBe(html);
  });

  // Regression: defaults are part of the contract. A rule that omits
  // `minSignals`/`minTextLength` must get the conservative values, not 0 —
  // omitting a field must never make a rule MORE aggressive than declaring one.
  it('defaults an omitted minSignals to 2 and minTextLength to 120', () => {
    const defaulted: DisclaimerRule = {
      name: 'defaulted',
      opens: /^this email/i,
      signals: [/confidential/i, /intended recipient/i],
    };

    // One signal, over the length floor -> kept, because the default is 2.
    const oneSignal = parseBody(
      `<p>R.</p><div>This email was sent from my desk on a Tuesday and is confidential ` +
        `only in the sense that I would rather you did not forward it to anybody at all.</div>`,
    );
    expect(applyDisclaimerRules(oneSignal, [defaulted])).toEqual([]);

    // Two signals but under 120 chars -> kept, because the default floor is 120.
    const tooShort = parseBody(
      '<p>R.</p><div>This email is confidential, intended recipient only.</div>',
    );
    expect(applyDisclaimerRules(tooShort, [defaulted])).toEqual([]);

    // Two signals and long enough -> removed.
    const both = parseBody(`<p>R.</p><div>${DISCLAIMER}</div>`);
    expect(applyDisclaimerRules(both, [defaulted])).toEqual(['defaulted']);
  });
});
