import { describe, expect, it, vi } from 'vitest';

import type { DomRule } from '../src/rules/types.js';
import { applyDomRules } from '../src/transform/apply-dom-rules.js';

import { parseBody } from './helpers/parser.js';

const rule = (partial: Partial<DomRule> & Pick<DomRule, 'name' | 'selectors'>): DomRule => ({
  provider: 'test',
  ...partial,
});

/**
 * The engine every signature and quote rule runs through. Its contract is what
 * lets a contributor add a rule object without reading any other rule: rules
 * are independent, order-tolerant, and cannot crash the render.
 */
describe('applyDomRules', () => {
  // Regression: the basic job. If this breaks, every signature stays visible.
  it('removes matched elements and reports the rule name', () => {
    const body = parseBody('<p>hi</p><div class="sig">Bye, me</div>');
    const applied = applyDomRules(body, [rule({ name: 'sig', selectors: ['.sig'] })]);

    expect(applied).toEqual(['sig']);
    expect(body.innerHTML).toBe('<p>hi</p>');
  });

  // Regression: a rule that matches nothing must be silent. If it reported
  // anyway, `applied` would say a Gmail signature was stripped from an Outlook
  // mail, and the audit trail becomes worse than none.
  it('does not report a rule that matched nothing', () => {
    const body = parseBody('<p>hi</p>');
    expect(applyDomRules(body, [rule({ name: 'sig', selectors: ['.sig'] })])).toEqual([]);
    expect(body.innerHTML).toBe('<p>hi</p>');
  });

  // Regression: one rule may carry several selectors for the same provider
  // (Gmail alone has three), and every one has to be tried.
  it('tries every selector in a rule', () => {
    const body = parseBody('<div class="a">1</div><div class="b">2</div><p>keep</p>');
    expect(applyDomRules(body, [rule({ name: 'multi', selectors: ['.a', '.b'] })])).toEqual([
      'multi',
    ]);
    expect(body.innerHTML).toBe('<p>keep</p>');
  });

  // Regression: rules must not depend on each other's order. This is the
  // property that makes "add a rule" a safe contribution.
  it('applies independent rules in either order with the same result', () => {
    const html = '<div class="q">quoted</div><div class="s">sig</div><p>keep</p>';
    const quote = rule({ name: 'q', selectors: ['.q'] });
    const signature = rule({ name: 's', selectors: ['.s'] });

    const forward = parseBody(html);
    const backward = parseBody(html);
    applyDomRules(forward, [quote, signature]);
    applyDomRules(backward, [signature, quote]);

    expect(forward.innerHTML).toBe('<p>keep</p>');
    expect(backward.innerHTML).toBe(forward.innerHTML);
  });

  // Regression: an inner element removed with its outer container must not be
  // counted again. `querySelectorAll` hands back a STATIC list, so one selector
  // matching a nest yields both; removing the outer one leaves the inner one in
  // the list, detached but with its parent link intact. Credited twice, a rule
  // set reports removals it never made — and `applied` is what a consumer
  // debugs "why did my content vanish?" with, so it has to name the rule that
  // actually did it. (A `parentNode` check cannot see this; containment can.)
  it('counts a nested match removed with its container only once', () => {
    const body = parseBody('<div class="sig">outer<div class="sig">inner</div></div><p>keep</p>');
    const removals: string[] = [];
    const applied = applyDomRules(body, [
      rule({
        name: 'sig',
        selectors: ['.sig'],
        test: (element) => {
          removals.push(element.textContent ?? '');
          return true;
        },
      }),
    ]);

    expect(applied).toEqual(['sig']);
    expect(removals).toEqual(['outerinner']);
    expect(body.innerHTML).toBe('<p>keep</p>');
  });

  // Regression: a rule whose match was already taken by an EARLIER rule must
  // stay silent, so `applied` distinguishes "the Gmail rule stripped this" from
  // "the Outlook rule did".
  it('does not credit a rule whose only match an earlier rule removed', () => {
    const body = parseBody('<div class="outer"><div class="inner">x</div></div><p>keep</p>');
    const applied = applyDomRules(body, [
      rule({ name: 'outer', selectors: ['.outer'] }),
      rule({ name: 'inner', selectors: ['.inner'] }),
    ]);

    expect(applied).toEqual(['outer']);
    expect(body.innerHTML).toBe('<p>keep</p>');
  });

  // Regression: containment is asked of the ROOT WE WERE GIVEN, not of the
  // document. `applyDomRules` is exported to run against any already-parsed
  // subtree, and in a detached one every element is `isConnected === false` —
  // an `isConnected` check would make the engine silently strip nothing while
  // still reporting success.
  it('strips inside a root that is detached from its document', () => {
    const body = parseBody('<section><p>hi</p><div class="sig">Bye, me</div></section>');
    const section = body.querySelector('section') as Element;
    section.remove();

    expect(applyDomRules(section, [rule({ name: 'sig', selectors: ['.sig'] })])).toEqual(['sig']);
    expect(section.innerHTML).toBe('<p>hi</p>');
  });

  // Regression: the same element matching two selectors of the same rule must
  // not be removed twice, which on some DOMs throws.
  it('skips an element a previous selector of the same rule already removed', () => {
    const body = parseBody('<div class="a b">x</div><p>keep</p>');
    expect(applyDomRules(body, [rule({ name: 'dup', selectors: ['.a', '.b'] })])).toEqual(['dup']);
    expect(body.innerHTML).toBe('<p>keep</p>');
  });

  // Regression: THE bug this guard exists for. `div[id*="signature"]` matches
  // Outlook's whole reply wrapper on some mail, and unguarded it deletes the
  // entire message. Guarded, a long match is left alone.
  it('honours maxTextLength, leaving an oversized match in place', () => {
    const long = 'x'.repeat(600);
    const body = parseBody(`<div id="signature">${long}</div>`);
    const applied = applyDomRules(
      body,
      [rule({ name: 'guarded', selectors: ['#signature'], maxTextLength: 500 })],
    );

    expect(applied).toEqual([]);
    expect(body.innerHTML).toContain(long);
  });

  it('honours maxTextLength, removing a match under the limit', () => {
    const body = parseBody('<p>hi</p><div id="signature">Regards, me</div>');
    expect(
      applyDomRules(body, [
        rule({ name: 'guarded', selectors: ['#signature'], maxTextLength: 500 }),
      ]),
    ).toEqual(['guarded']);
    expect(body.innerHTML).toBe('<p>hi</p>');
  });

  // Regression: the limit is exclusive — a match exactly at the limit is kept.
  // Stated explicitly so a rule author can tune a threshold and know which side
  // of it they are on.
  it('treats maxTextLength as exclusive', () => {
    const body = parseBody(`<div id="signature">${'x'.repeat(10)}</div>`);
    expect(
      applyDomRules(body, [rule({ name: 'edge', selectors: ['#signature'], maxTextLength: 10 })]),
    ).toEqual([]);
  });

  // Regression: length is measured on NORMALIZED text, so the mountains of
  // whitespace in Word-generated HTML do not push a short signature over a
  // guard and keep it on screen.
  it('measures maxTextLength against whitespace-collapsed text', () => {
    const body = parseBody(`<div id="signature">Bye${' '.repeat(400)}me</div>`);
    expect(
      applyDomRules(body, [rule({ name: 'ws', selectors: ['#signature'], maxTextLength: 20 })]),
    ).toEqual(['ws']);
  });

  // Regression: `test` is the escape hatch for a condition a selector cannot
  // express. It must be able to veto, and it must receive the element.
  it('lets a rule test veto a match', () => {
    const body = parseBody('<div class="sig">keep me</div>');
    const test = vi.fn(() => false);
    expect(applyDomRules(body, [rule({ name: 'vetoed', selectors: ['.sig'], test })])).toEqual([]);
    expect(test).toHaveBeenCalledOnce();
    expect((test.mock.calls[0] as unknown as [Element])[0].className).toBe('sig');
    expect(body.innerHTML).toBe('<div class="sig">keep me</div>');
  });

  it('removes when the rule test approves', () => {
    const body = parseBody('<p>hi</p><div class="sig">bye</div>');
    expect(
      applyDomRules(body, [rule({ name: 'ok', selectors: ['.sig'], test: () => true })]),
    ).toEqual(['ok']);
    expect(body.innerHTML).toBe('<p>hi</p>');
  });

  // Regression: rule sets are contributed data. One bad selector must degrade
  // to "matched nothing" rather than throw and leave the message unrendered.
  it('survives a selector the DOM cannot parse', () => {
    const body = parseBody('<p>hi</p>');
    expect(applyDomRules(body, [rule({ name: 'bad', selectors: ['div[[broken'] })])).toEqual([]);
    expect(body.innerHTML).toBe('<p>hi</p>');
  });

  // Regression: some clients do not wrap quoted history at all — they leave an
  // empty marker div and let the history follow as siblings. Removing only the
  // marker leaves the whole thread on screen while `applied` claims a quote was
  // stripped, which is the most misleading failure the engine can produce.
  it('removes a boundary marker together with every following sibling', () => {
    const body = parseBody(
      '<p>My reply.</p><div id="appendonsend"></div><hr><div>quoted thread</div><p>more</p>',
    );
    const applied = applyDomRules(
      body,
      [rule({ name: 'boundary', selectors: ['#appendonsend'], boundary: true })],
    );

    expect(applied).toEqual(['boundary']);
    expect(body.innerHTML).toBe('<p>My reply.</p>');
  });

  // Regression: a boundary is scoped to its own parent, so content ABOVE it and
  // content outside its subtree survive. A boundary that escaped its parent
  // would truncate the message from an arbitrary point.
  it('scopes a boundary to its own parent’s siblings', () => {
    const body = parseBody(
      '<div><p>keep</p><span id="cut"></span><p>drop</p></div><p>keep after</p>',
    );
    applyDomRules(body, [rule({ name: 'boundary', selectors: ['#cut'], boundary: true })]);

    expect(body.innerHTML).toBe('<div><p>keep</p></div><p>keep after</p>');
  });

  // Regression: a boundary with nothing after it is a plain removal, not a
  // crash on a null sibling.
  it('handles a boundary that is already the last child', () => {
    const body = parseBody('<p>keep</p><span id="cut"></span>');
    expect(
      applyDomRules(body, [rule({ name: 'boundary', selectors: ['#cut'], boundary: true })]),
    ).toEqual(['boundary']);
    expect(body.innerHTML).toBe('<p>keep</p>');
  });

  it('returns an empty list for an empty rule set', () => {
    const body = parseBody('<p>hi</p>');
    expect(applyDomRules(body, [])).toEqual([]);
  });
});
