import { describe, expect, it } from 'vitest';

import {
  isElement,
  isIgnorableNode,
  lastMeaningfulChild,
  meaningfulChildren,
  normalizedText,
  safeMatches,
  safeQueryAll,
} from '../src/transform/node-utils.js';

import { parseBody } from './helpers/parser.js';

/**
 * These decide what counts as "content". Every trailing-block rule descends
 * through the tree using them, so a wrong answer here means either a footer
 * that never gets removed or a message body that does.
 */
describe('isIgnorableNode', () => {
  // Regression: mail HTML is full of whitespace-only text nodes between tags.
  // Counting them as content makes every wrapper look like it has a real last
  // child, and the trailing-block walk stops one level too early.
  it('ignores whitespace-only text nodes', () => {
    const body = parseBody('<p>a</p>\n   \n<p>b</p>');
    expect(meaningfulChildren(body).map((node) => node.nodeName)).toEqual(['P', 'P']);
  });

  // Regression: Outlook and Word emit &nbsp;-only cells and paragraphs by the
  // dozen. A non-breaking space is invisible but is NOT matched by \s in older
  // engines, so it has to be folded explicitly or these count as content.
  it('ignores a text node holding only a non-breaking space', () => {
    const body = parseBody('<p>real</p><p>&nbsp;</p>');
    expect(meaningfulChildren(body)).toHaveLength(1);
  });

  // Regression: a trailing <br> or spacer <hr> is layout, not content.
  it('ignores BR and HR elements', () => {
    const body = parseBody('<p>real</p><br><hr>');
    expect(meaningfulChildren(body).map((node) => node.nodeName)).toEqual(['P']);
  });

  // Regression: an empty <div> wrapping a logo or a layout table is meaningful
  // even with zero text. Treating it as ignorable deletes the image.
  it('keeps a textless element that contains an image, table or iframe', () => {
    for (const markup of ['<img src="x">', '<table><tr><td></td></tr></table>', '<iframe></iframe>']) {
      const body = parseBody(`<p>real</p><div>${markup}</div>`);
      expect(meaningfulChildren(body)).toHaveLength(2);
    }
  });

  // Regression: the media check looks at DESCENDANTS, so asked about a bare
  // `<img>` — no text, and no image inside an image — it used to answer
  // "ignorable", and a trailing picture was dropped. For a one-image message
  // that is the whole message; nothing is left to render.
  it('keeps a media element that is itself the content', () => {
    for (const markup of ['<img src="x">', '<svg></svg>', '<video></video>', '<canvas></canvas>']) {
      const body = parseBody(`<p>real</p>${markup}`);
      expect(meaningfulChildren(body)).toHaveLength(2);
    }
  });

  // Regression: a genuinely empty wrapper must be skipped, or the trailing-block
  // walk lands on it, finds no disclaimer text, and gives up without descending.
  it('ignores a textless element with no embedded media', () => {
    const body = parseBody('<p>real</p><div><span></span></div>');
    expect(meaningfulChildren(body)).toHaveLength(1);
  });

  // Regression: comment nodes (Word conditionals wrap half of Outlook mail in
  // them) are neither text nor element, and must not be mistaken for content.
  it('ignores comment nodes', () => {
    const body = parseBody('<p>real</p><!-- [if mso] -->');
    const comment = Array.from(body.childNodes).find((node) => node.nodeType === 8);
    expect(comment).toBeDefined();
    expect(isIgnorableNode(comment as Node)).toBe(true);
  });

  // Regression: `textContent` is typed `string | null`, and a minimal or
  // partially-implemented DOM really does return null. This runs on every node
  // of every body, so a throw here loses the whole message rather than
  // mis-stripping one signature.
  it('treats a text node whose textContent is null as ignorable', () => {
    expect(isIgnorableNode({ nodeType: 3, textContent: null } as unknown as Node)).toBe(true);
  });
});

describe('lastMeaningfulChild', () => {
  // Regression: the disclaimer walk needs the last node that is actually
  // content. Returning a trailing whitespace text node stalls the descent.
  it('returns the final content node, skipping trailing noise', () => {
    const body = parseBody('<p>a</p><div>footer</div>\n<br>  ');
    expect((lastMeaningfulChild(body) as Element).textContent).toBe('footer');
  });

  // Regression: an element with nothing in it must report undefined so the walk
  // terminates instead of dereferencing it.
  it('returns undefined when there are no meaningful children', () => {
    expect(lastMeaningfulChild(parseBody('   '))).toBeUndefined();
  });
});

describe('isElement', () => {
  it('narrows elements and rejects text, null and undefined', () => {
    const body = parseBody('<p>a</p>text');
    expect(isElement(body.firstChild)).toBe(true);
    expect(isElement(body.lastChild)).toBe(false);
    expect(isElement(null)).toBe(false);
    expect(isElement(undefined)).toBe(false);
  });
});

describe('normalizedText', () => {
  // Regression: every length guard in every rule (`maxTextLength`,
  // `minTextLength`) measures against this. Two functions counting text two
  // ways is how the original hand-rolled copies drifted apart.
  it('collapses whitespace, folds nbsp and trims', () => {
    const body = parseBody('<p>  hello\n\n&nbsp;  world  </p>');
    expect(normalizedText(body)).toBe('hello world');
  });

  it('treats null, undefined and empty content as the empty string', () => {
    expect(normalizedText(null)).toBe('');
    expect(normalizedText(undefined)).toBe('');
    expect(normalizedText({ textContent: null })).toBe('');
  });
});

describe('safeMatches / safeQueryAll', () => {
  it('matches and queries normally when the selector is supported', () => {
    const body = parseBody('<div class="a">1</div><div class="a">2</div>');
    expect(safeMatches(body.firstElementChild as Element, '.a')).toBe(true);
    expect(safeMatches(body.firstElementChild as Element, '.b')).toBe(false);
    expect(safeQueryAll(body, '.a')).toHaveLength(2);
  });

  // Regression: selector support genuinely varies between browsers and
  // server-side DOMs, and a rule set is contributed data — one exotic selector
  // must degrade to "no match", never take down the whole render.
  it('degrades to no-match on a selector the engine cannot parse', () => {
    const body = parseBody('<div>x</div>');
    expect(() => body.querySelectorAll('div[[broken')).toThrow();
    expect(safeQueryAll(body, 'div[[broken')).toEqual([]);
    expect(safeMatches(body.firstElementChild as Element, 'div[[broken')).toBe(false);
  });
});
