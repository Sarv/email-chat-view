import { describe, expect, it } from 'vitest';

import type { MarkerRule } from '../src/rules/types.js';
import { applyMarkerRules } from '../src/transform/apply-marker-rules.js';

const rule = (name: string, patterns: RegExp[]): MarkerRule => ({
  name,
  provider: 'test',
  patterns,
});

/**
 * Marker rules cut a body at a prose boundary a client injected ("On ... wrote:").
 * They operate on the string because those boundaries frequently sit BETWEEN
 * elements, where no container marks them.
 *
 * The critical property is EARLIEST-MATCH-WINS across the whole set. That is
 * what makes marker rules order-independent, and therefore safe to contribute:
 * adding a rule can never move an existing cut later, only earlier.
 */
describe('applyMarkerRules', () => {
  // Regression: the basic cut. If this breaks, every reply shows the whole
  // thread history inside one bubble.
  it('truncates at the marker and reports the rule', () => {
    const result = applyMarkerRules('<p>my reply</p>On Mon, Bob wrote:<p>old</p>', [
      rule('wrote', [/On\s+[^\n<]{4,200}\s+wrote\s*:/i]),
    ]);

    expect(result.html).toBe('<p>my reply</p>');
    expect(result.applied).toEqual(['wrote']);
  });

  // Regression: with several markers present, the cut must be the FIRST one, or
  // quoted history between the two boundaries leaks into the bubble.
  it('cuts at the earliest match across all rules', () => {
    const html = 'reply -----Original Message----- mid ---- Forwarded message ---- tail';
    const result = applyMarkerRules(html, [
      rule('forwarded', [/-{4,}\s*Forwarded message\s*-{4,}/i]),
      rule('original', [/-----\s*Original Message\s*-----/i]),
    ]);

    expect(result.html).toBe('reply ');
    expect(result.applied).toEqual(['original']);
  });

  // Regression: same input, rules reversed, same answer. Order-independence is
  // the whole contribution story — a new rule must not be able to change where
  // an existing one already cut.
  it('gives the same result whatever order the rules are in', () => {
    const html = 'reply -----Original Message----- mid ---- Forwarded message ---- tail';
    const forwarded = rule('forwarded', [/-{4,}\s*Forwarded message\s*-{4,}/i]);
    const original = rule('original', [/-----\s*Original Message\s*-----/i]);

    expect(applyMarkerRules(html, [forwarded, original])).toEqual(
      applyMarkerRules(html, [original, forwarded]),
    );
  });

  // Regression: a tie goes to the earlier rule, deterministically. A
  // non-deterministic winner would make `applied` unreliable in exactly the
  // ambiguous cases a consumer is trying to debug.
  it('breaks a positional tie in favour of the earlier rule', () => {
    const html = 'reply MARKER tail';
    const first = rule('first', [/MARKER/]);
    const second = rule('second', [/MARKER/]);

    expect(applyMarkerRules(html, [first, second]).applied).toEqual(['first']);
    expect(applyMarkerRules(html, [second, first]).applied).toEqual(['second']);
  });

  // Regression: one rule holds several spellings of the same boundary, and the
  // earliest of THOSE must win too.
  it('takes the earliest match among a rule’s own patterns', () => {
    const result = applyMarkerRules('a BBB b AAA c', [rule('multi', [/AAA/, /BBB/])]);
    expect(result.html).toBe('a ');
    expect(result.applied).toEqual(['multi']);
  });

  // Regression: `search()` is used rather than `exec()` precisely so a pattern
  // carrying a `g` flag cannot keep `lastIndex` between calls and start
  // matching from the middle of the next body. Running twice must be identical.
  it('is stateless across calls even with a global-flag pattern', () => {
    const globalRule = rule('sticky', [/wrote:/g]);
    const html = 'reply wrote: old';

    expect(applyMarkerRules(html, [globalRule])).toEqual({ html: 'reply ', applied: ['sticky'] });
    expect(applyMarkerRules(html, [globalRule])).toEqual({ html: 'reply ', applied: ['sticky'] });
  });

  // Regression: no marker means no change. A body must never be truncated on a
  // rule that did not fire.
  it('returns the input untouched when nothing matches', () => {
    const html = '<p>just my reply</p>';
    expect(applyMarkerRules(html, [rule('wrote', [/never-here/])])).toEqual({
      html,
      applied: [],
    });
  });

  it('returns the input untouched for an empty rule set', () => {
    expect(applyMarkerRules('<p>x</p>', [])).toEqual({ html: '<p>x</p>', applied: [] });
  });

  // Regression: a marker at position 0 is a real cut, not a "no match". The -1
  // sentinel must be distinguished from index 0 — conflating them leaves a body
  // that is entirely quoted history rendered in full.
  it('cuts to empty when the body starts with the marker', () => {
    const result = applyMarkerRules('wrote: everything is quoted', [rule('wrote', [/wrote:/])]);
    expect(result.html).toBe('');
    expect(result.applied).toEqual(['wrote']);
  });
});
