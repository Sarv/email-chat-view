import { describe, expect, it } from 'vitest';

import { domToText, isBlockElement } from '../../src/transform/dom-text.js';
import { distinctDomainCount } from '../../src/transform/block-shapes.js';
import {
  cutSignOff,
  hasStrongSignatureEvidence,
  signOffBlock,
} from '../../src/transform/sign-off.js';

import { signOffPatterns } from '../../src/rules/sign-off.js';

import { parseBody, squash } from '../helpers/parser.js';

describe('domToText', () => {
  // Regression: `textContent` glues <div>a</div><div>b</div> into "ab". Every
  // line rule and the sign-off search read this text, so a lost line boundary
  // makes "Thanks" appear mid-sentence and the cut lands in the wrong place.
  it('turns block boundaries and breaks into newlines', () => {
    expect(domToText(parseBody('<div>a</div><div>b</div>'))).toBe('a\nb\n');
    expect(domToText(parseBody('a<br>b'))).toBe('a\nb');
  });

  // Regression: a block OPENING after loose inline text has to start a new line
  // too. Without it "Thanks<div>Ankur</div>" flattens to "ThanksAnkur", the
  // sign-off line stops looking like a sign-off, and the block survives.
  it('opens a new line when a block follows inline text', () => {
    expect(domToText(parseBody('Thanks<div>Ankur</div>'))).toBe('Thanks\nAnkur\n');
  });

  // Regression: inline markup must NOT break the line. A name wrapped in <b>
  // inside a sign-off would otherwise be judged as its own line.
  it('keeps inline markup on the same line', () => {
    expect(domToText(parseBody('<p>Thanks, <b>Ankur</b></p>'))).toBe('Thanks, Ankur\n');
  });

  // Regression: clients disagree about emitting &nbsp; or a space. A rule that
  // matched only one of them would fire on Gmail and not on Outlook.
  it('folds non-breaking spaces to ordinary ones', () => {
    expect(domToText(parseBody('<p>Thanks&nbsp;again</p>'))).toBe('Thanks again\n');
  });

  it('ignores comments and other non-element nodes', () => {
    expect(domToText(parseBody('<!--x--><p>a</p>'))).toBe('a\n');
  });

  it('classifies block and inline elements', () => {
    expect(isBlockElement(parseBody('<div></div>').firstChild!)).toBe(true);
    expect(isBlockElement(parseBody('<span></span>').firstChild!)).toBe(false);
    expect(isBlockElement(parseBody('text').firstChild!)).toBe(false);
  });
});

describe('signOffBlock', () => {
  // Regression: THE reason the search runs backwards. "Thanks for the quick
  // turnaround" opens a lot of real messages, and anchoring on the first match
  // would cut the entire body away.
  it('takes the LAST sign-off, not the first', () => {
    const text = 'Thanks for the quick turnaround.\nHere are the numbers.\nThanks\nAnkur';
    expect(signOffBlock(text)).toBe('Thanks\nAnkur');
  });

  it('matches combined and punctuated sign-offs', () => {
    expect(signOffBlock('Body here\nThanks & Regards\nAnkur')).toBe('Thanks & Regards\nAnkur');
    expect(signOffBlock('Body here\nRegards!\nAnkur')).toBe('Regards!\nAnkur');
    expect(signOffBlock('Body here\nYours sincerely\nAnkur')).toBe('Yours sincerely\nAnkur');
  });

  // Regression: HTML-to-text conversion indents the "-- " separator. Anchoring
  // at column 0 misses the one standardized signature marker on exactly the
  // mail that needs it most.
  it('matches an indented RFC 3676 delimiter', () => {
    expect(signOffBlock('Body\n    --\nAnkur')).toBe('--\nAnkur');
  });

  it('returns null when there is no sign-off', () => {
    expect(signOffBlock('Just a message with no closing at all')).toBeNull();
  });

  // Regression: the patterns are module-level constants, so a global copy has
  // to be built per call. A leaked lastIndex makes whichever body runs second
  // skip matches — a bug that only appears once more than one message is
  // processed.
  it('gives the same answer on a repeated call', () => {
    const text = 'Body here\nThanks\nAnkur';
    expect(signOffBlock(text)).toBe(signOffBlock(text));
    expect(signOffBlock(text)).toBe('Thanks\nAnkur');
  });

  // Regression: `signOffPatterns` is exported so a consumer can add their own
  // language, which puts patterns nobody here reviewed into the loop. A
  // contributed pattern that already carries `g` must be used as-is rather than
  // having a second `g` appended (an invalid-flags TypeError), and one that can
  // match zero-width must terminate the scan instead of spinning on a
  // `lastIndex` that never advances — a hang, not a wrong answer.
  it('survives a contributed pattern that is global or zero-width', () => {
    const original = [...signOffPatterns];
    try {
      signOffPatterns.push(/^Ciao$/gm);
      expect(signOffBlock('Body here\nCiao\nAnkur')).toBe('Ciao\nAnkur');
      expect(signOffBlock('Body here\nCiao\nAnkur')).toBe('Ciao\nAnkur');

      signOffPatterns.push(/[ ]*$/m);
      expect(signOffBlock('no closing here')).toBeNull();
    } finally {
      signOffPatterns.length = 0;
      signOffPatterns.push(...original);
    }
  });
});

describe('distinctDomainCount / hasStrongSignatureEvidence', () => {
  it('counts distinct domains and ignores addresses', () => {
    expect(distinctDomainCount('sarv.com | wave.sarv.com | enquiry.ai')).toBe(3);
    expect(distinctDomainCount('write to ankur.d@sarv.com')).toBe(1);
    expect(distinctDomainCount('no domains here')).toBe(0);
  });

  // Regression: a dial-in IP or a version number is not a links strip. Counting
  // them as domains would hand a meeting invite the strong evidence that lets
  // the sign-off pass cut past its share guard.
  it('does not count numeric dotted runs as domains', () => {
    expect(distinctDomainCount('dial 192.168.1.1 or build 2.10.1')).toBe(0);
  });

  it('accepts a job title or a multi-domain links strip as strong evidence', () => {
    expect(hasStrongSignatureEvidence('Ankur Dubey\nEngineer')).toBe(true);
    expect(hasStrongSignatureEvidence('sarv.com | enquiry.ai')).toBe(true);
    expect(hasStrongSignatureEvidence('Thanks\nAnkur')).toBe(false);
  });
});

describe('cutSignOff', () => {
  /** Cut a body and report the HTML left behind. */
  function cut(html: string) {
    const body = parseBody(html);
    const applied = cutSignOff(body);
    return { html: squash(body.innerHTML), applied };
  }

  // Regression: the ordinary hand-typed sign-off no other pass can see. This is
  // the one that left contact cards sitting in the bubbles.
  //
  // The emptied `<div></div>` wrapper is expected: the cut removes the anchor
  // TEXT node and everything after it, and cannot remove the wrapper itself
  // because content before the anchor could still live in it. Dropping now-empty
  // wrappers is `trimEdgeEmpties`' job in the same pipeline, and restating it
  // here would be a second implementation of it.
  it('cuts an ordinary sign-off block', () => {
    const { html, applied } = cut(
      '<div>Here are the numbers you asked for, all reconciled.</div><div>Thanks</div><div>Ankur Dubey</div>',
    );
    expect(applied).toBe(true);
    expect(html).toBe('<div>Here are the numbers you asked for, all reconciled.</div><div></div>');
  });

  // Regression: a one-line "Thanks, Alice" reply is ENTIRELY sign-off. Cutting
  // it leaves an empty bubble, which reads as a message that failed to load.
  it('refuses to cut when nothing at all would remain', () => {
    const body = '<div>Thanks</div><div>Alice</div>';
    expect(cut(body)).toEqual({ html: body, applied: false });
  });

  // Regression: the same guard where the SHARE test cannot reach it. A brief
  // note with a two-word closing is a small enough share to pass every ratio
  // check, and only the absolute floor on what remains keeps the bubble from
  // being emptied down to nothing.
  it('refuses to cut when too little would remain', () => {
    const body = '<div>Hi Bob, could you check this today?</div><div>Thanks</div><div>Al</div>';
    expect(cut(body)).toEqual({ html: body, applied: false });
  });

  // Regression: the absolute size guard, which the share guard cannot stand in
  // for. In a very long mail a 700-character "block" is a small share of the
  // text and would slip through on ratio alone — but nobody's sign-off is 700
  // characters, so a match that big means the anchor was found in prose.
  it('refuses a block over the absolute size limit', () => {
    const body =
      `<div>${'sentence of ordinary body text. '.repeat(80)}</div>` +
      `<div>Thanks</div><div>${'word '.repeat(140)}</div>`;
    expect(cut(body).applied).toBe(false);
  });

  // Regression: the share guard. Without it a short note whose closing runs a
  // few lines loses half its content.
  it('refuses when the block is too large a share of a weak-evidence message', () => {
    const body =
      '<div>Could you take a look at this when you get a chance today please</div>' +
      `<div>Thanks</div><div>${'word '.repeat(60)}</div>`;
    expect(cut(body).applied).toBe(false);
  });

  // Regression: the relaxed guards. A short note whose second half is a full
  // contact card is common, and the card is never the message. This block is
  // 44% of the text — over the ordinary 0.4 share limit — and only the job
  // title in it makes the cut legal.
  it('cuts past the share guard when the block proves it is a card', () => {
    const { applied, html } = cut(
      '<div>Numbers attached, let me know what you think about the totals.</div>' +
        '<div>Thanks</div><div>Ankur Dubey</div><div>Engineer, Sarv</div><div>+91 98765 43210</div>',
    );
    expect(applied).toBe(true);
    expect(html).toBe(
      '<div>Numbers attached, let me know what you think about the totals.</div><div></div>',
    );
  });

  // Regression: the anchor-length guard, which exists because not every
  // sign-off pattern is anchored at both ends — the mobile-footer one matches a
  // line PREFIX, so "Sent from my iPhone, and to answer your question…" is a
  // match and is also the message. A real sign-off line is short.
  it('refuses to anchor on a long line', () => {
    const body =
      `<div>${'A sentence of ordinary body text. '.repeat(8)}</div>` +
      `<div>Sent from my iPhone ${'x'.repeat(110)}</div>`;
    expect(cut(body).applied).toBe(false);
  });

  it('does nothing to an empty body or one with no sign-off', () => {
    expect(cut('').applied).toBe(false);
    expect(cut('<p>   </p>').applied).toBe(false);
    expect(cut('<p>An ordinary message that simply ends here without a closing.</p>').applied).toBe(
      false,
    );
  });

  // Regression: the anchor is found in the flattened text but has to be located
  // again as a NODE. When the flattening and the node text disagree — the line
  // is split across inline elements — no node matches and nothing must be cut,
  // rather than a wrong node being cut.
  it('makes no cut when the anchor line has no single text node', () => {
    const body = '<div>Some genuinely long body text that is well over the minimum kept size</div>' +
      '<div>Th<b>anks</b></div><div>Ankur Dubey</div>';
    expect(cut(body).applied).toBe(false);
  });

  // Regression: the walk needs `ownerDocument.createTreeWalker`, and a root that
  // has passed every guard but has no document must report "nothing cut" rather
  // than throw on the caller. The text has to be real, or the empty-body guard
  // returns first and this never reaches the walk it is testing.
  it('does nothing for a root with no owner document', () => {
    const detached = {
      ownerDocument: null,
      nodeType: 1,
      nodeName: 'DIV',
      childNodes: [
        {
          nodeType: 3,
          textContent:
            'Long enough body text to clear the minimum kept size guard easily\nThanks\nAnkur',
        },
      ],
    } as unknown as Element;
    expect(cutSignOff(detached)).toBe(false);
  });
});
