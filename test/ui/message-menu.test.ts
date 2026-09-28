// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  frameViewportOrigin,
  isEditableTarget,
  messageMenuRequest,
  selectionTextWithin,
} from '../../src/ui/message-menu.js';

// jsdom, for a real `Selection` and real `Range`s: what is under test is the
// question "does this selection belong to this message?", and a hand-rolled
// selection would only answer the question the test author already had in mind.

afterEach(() => {
  window.getSelection()?.removeAllRanges();
});

/** Two messages side by side, and the reader's selection object. */
function twoMessages() {
  document.body.innerHTML =
    '<div id="one"><p id="a">  Tuesday <b>works</b>  </p></div><div id="two"><p id="b">Fine</p></div>';
  return {
    one: document.getElementById('one') as HTMLElement,
    two: document.getElementById('two') as HTMLElement,
    selection: window.getSelection() as Selection,
  };
}

describe('selectionTextWithin', () => {
  // Regression: "Copy" offered on a message must copy that message's words.
  // Trimmed, because a triple-click selection carries the paragraph's
  // surrounding whitespace, and a host that pastes it gets stray blanks.
  it('reports a selection that lies inside the message, trimmed', () => {
    const { one, selection } = twoMessages();
    selection.selectAllChildren(document.getElementById('a') as HTMLElement);
    expect(selectionTextWithin(selection, one)).toBe('Tuesday works');
  });

  // Regression: a selection left in one bubble while the reader right-clicks
  // another is not what they right-clicked on; offering it would copy words
  // from a different message.
  it('reports nothing for a selection in another message', () => {
    const { two, selection } = twoMessages();
    selection.selectAllChildren(document.getElementById('a') as HTMLElement);
    expect(selectionTextWithin(selection, two)).toBe('');
  });

  // Regression: checking only where the selection STARTS would hand over a
  // selection that runs on into the next message — half of it someone else's.
  it('reports nothing for a selection that runs out of the message', () => {
    const { one, selection } = twoMessages();
    const range = document.createRange();
    range.setStart(document.getElementById('a')?.firstChild as Node, 3);
    range.setEnd(document.getElementById('b')?.firstChild as Node, 2);
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selectionTextWithin(selection, one)).toBe('');
  });

  // Regression: a right-click with no selection must report `''`, never
  // throw — a document with no browsing context has no selection object.
  it('reports nothing when nothing is selected', () => {
    const { one, selection } = twoMessages();
    selection.removeAllRanges();
    expect(selectionTextWithin(selection, one)).toBe('');
    // A document with no browsing context has no selection object at all.
    expect(selectionTextWithin(null, one)).toBe('');
    expect(selectionTextWithin(undefined, one)).toBe('');
  });

  // Regression: Firefox keeps several ranges on a Ctrl-selection, and every
  // one of them has to be inside the message — the check cannot stop at the
  // first. jsdom keeps one range only, so this one is a stand-in.
  it('checks every range of a multi-range selection', () => {
    const { one } = twoMessages();
    const inside = document.createRange();
    inside.selectNodeContents(document.getElementById('a') as HTMLElement);
    const outside = document.createRange();
    outside.selectNodeContents(document.getElementById('b') as HTMLElement);
    const selectionOf = (ranges: Range[]) =>
      ({
        rangeCount: ranges.length,
        getRangeAt: (index: number) => ranges[index],
        toString: () => ' both ',
      }) as unknown as Selection;
    expect(selectionTextWithin(selectionOf([inside, outside]), one)).toBe('');
    expect(selectionTextWithin(selectionOf([inside, inside]), one)).toBe('both');
  });
});

describe('frameViewportOrigin', () => {
  // Regression: a right-click inside the frame reports its point from the
  // FRAME's top-left. Without the frame's own position the host's menu opens
  // at the page's top-left instead; without its border it opens off by the
  // border's width on a host that draws one.
  it('is the frame’s box plus its border, in the page’s viewport', () => {
    const frame = {
      getBoundingClientRect: () => ({ left: 100, top: 200 }),
      clientLeft: 2,
      clientTop: 3,
    } as unknown as Element;
    expect(frameViewportOrigin(frame)).toEqual({ left: 102, top: 203 });
  });
});

describe('messageMenuRequest', () => {
  // Regression: the inline body's event is already in the page's viewport,
  // so its point must reach the host unchanged.
  it('passes an inline point through untouched, with the link under the pointer', () => {
    const { one } = twoMessages();
    const target = document.createElement('b');
    const anchor = document.createElement('a');
    anchor.setAttribute('href', 'https://x.example/a');
    anchor.append(target);
    expect(messageMenuRequest({ target, clientX: 12, clientY: 34 }, null, one)).toEqual({
      clientX: 12,
      clientY: 34,
      href: 'https://x.example/a',
      selectionText: '',
    });
  });

  // Regression: a framed body's point is translated by the frame's origin.
  it('translates a point by the origin it is given', () => {
    const { one, selection } = twoMessages();
    selection.selectAllChildren(document.getElementById('a') as HTMLElement);
    const target = document.getElementById('a');
    expect(
      messageMenuRequest({ target, clientX: 10, clientY: 20 }, selection, one, {
        left: 102,
        top: 203,
      }),
    ).toEqual({ clientX: 112, clientY: 223, href: null, selectionText: 'Tuesday works' });
  });

  // Regression: the menu must never offer "Copy link" for a link a left-click
  // would refuse to follow — the same scheme test as `clickedHref`.
  it('reports no link for a scheme a click would not open', () => {
    const { one } = twoMessages();
    const anchor = document.createElement('a');
    anchor.setAttribute('href', 'javascript:alert(1)');
    expect(messageMenuRequest({ target: anchor, clientX: 0, clientY: 0 }, null, one).href).toBe(
      null,
    );
  });
});

describe('isEditableTarget', () => {
  /** `markup` in the page, and the element with id `target` inside it. */
  const targetIn = (markup: string) => {
    document.body.innerHTML = markup;
    return document.getElementById('target');
  };

  // Regression: a right-click in a text field is for the field's own menu —
  // paste, spelling — and the message menu must stay out of it.
  it.each([
    ['a text input', '<input id="target">'],
    ['a textarea', '<textarea id="target"></textarea>'],
    ['an editor', '<div contenteditable="true" id="target"></div>'],
    ['an editor with a bare attribute', '<div contenteditable id="target"></div>'],
    ['plain-text editing', '<div contenteditable="plaintext-only" id="target"></div>'],
    ['something typed inside an editor', '<div contenteditable><p><b id="target">x</b></p></div>'],
    // A non-editable island (a chip, a mention) is still inside the editor.
    [
      'a read-only island inside an editor',
      '<div contenteditable><span contenteditable="false" id="target">@bob</span></div>',
    ],
  ])('recognises %s', (_name, markup) => {
    expect(isEditableTarget(targetIn(markup))).toBe(true);
  });

  // Regression: ordinary message content — text, a link — is the message,
  // and a right-click on it must still open the message menu.
  it.each([
    ['text', '<p id="target">hello</p>'],
    ['a link', '<a href="https://x.example" id="target">x</a>'],
    ['an element marked not editable', '<div contenteditable="false" id="target"></div>'],
  ])('does not mistake %s for a field', (_name, markup) => {
    expect(isEditableTarget(targetIn(markup))).toBe(false);
  });

  // Regression: an event's target is not always an element, and a check that
  // assumed `closest` would throw on the right-click it was meant to judge.
  it('is false for a target that is not an element', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
    expect(isEditableTarget(document.createTextNode('x'))).toBe(false);
  });
});
