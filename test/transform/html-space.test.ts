import { describe, expect, it } from 'vitest';

import {
  collapseExcessBlankSpace,
  isEmptyElement,
  looksDesigned,
  trimEdgeEmpties,
  trimEmptyEdges,
  trimTrailingWindowed,
} from '../../src/transform/html-space.js';
import { parseBody, squash } from '../helpers/parser.js';

describe('trimTrailingWindowed', () => {
  it('applies the peel to a short input directly', () => {
    expect(trimTrailingWindowed('abc   ', (tail) => tail.replace(/\s+$/, ''))).toBe('abc');
  });

  // Regression: the whole reason this exists. `head + peel(tail)` must
  // reconstruct the input exactly, or a body longer than the window silently
  // loses or duplicates content around the split point.
  it('reconstructs the input exactly when it exceeds the window', () => {
    const body = `${'x'.repeat(100)}   `;
    expect(trimTrailingWindowed(body, (tail) => tail.replace(/\s+$/, ''), 16)).toBe(
      'x'.repeat(100),
    );
  });

  // Regression: a trailing empty-tag nest longer than one window. Stopping
  // after the first window would leave dead space behind and make the result
  // depend on the window size, which the contract says it must not.
  it('keeps peeling when a whole window is dead space', () => {
    expect(
      trimTrailingWindowed(`keep${' '.repeat(200)}`, (tail) => tail.replace(/\s+$/, ''), 16),
    ).toBe('keep');
  });

  it('leaves an input with nothing to peel unchanged', () => {
    const body = 'y'.repeat(100);
    expect(trimTrailingWindowed(body, (tail) => tail.replace(/\s+$/, ''), 16)).toBe(body);
  });
});

describe('trimEmptyEdges', () => {
  // Regression: leading and trailing dead space is what makes a bubble render
  // with a blank band above or below the message.
  it('drops dead space at both edges', () => {
    expect(trimEmptyEdges('<br><p>&nbsp;</p>hello<div>&nbsp;</div><br>')).toBe('hello');
  });

  it('collapses a long break run to two', () => {
    expect(trimEmptyEdges('a<br><br><br><br>b')).toBe('a<br><br>b');
  });

  it('leaves a body with no dead space alone', () => {
    expect(trimEmptyEdges('<p>hello</p>')).toBe('<p>hello</p>');
  });
});

describe('isEmptyElement', () => {
  it('is true for whitespace-only and nbsp-only elements', () => {
    expect(isEmptyElement(parseBody('<p>   </p>').querySelector('p')!)).toBe(true);
    expect(isEmptyElement(parseBody('<p>&nbsp;</p>').querySelector('p')!)).toBe(true);
  });

  // Regression: an image-only block has no text at all and is absolutely
  // content. Treating it as empty deletes the picture somebody sent.
  it('is false for a block whose only content is media or a control', () => {
    expect(isEmptyElement(parseBody('<div><img src="x.png"></div>').querySelector('div')!)).toBe(
      false,
    );
    expect(isEmptyElement(parseBody('<div><hr></div>').querySelector('div')!)).toBe(false);
    expect(isEmptyElement(parseBody('<div><button></button></div>').querySelector('div')!)).toBe(
      false,
    );
  });

  it('is false for an element with text', () => {
    expect(isEmptyElement(parseBody('<p>hi</p>').querySelector('p')!)).toBe(false);
  });
});

describe('trimEdgeEmpties', () => {
  // Regression: the case no string regex can reach — a trailing <br> INSIDE the
  // last paragraph. It is not at the end of the serialized string, so
  // trimEmptyEdges cannot see it, and the bubble shows a blank line under the
  // message.
  it('recurses into the last element to remove a nested trailing break', () => {
    const body = parseBody('<p style="margin:0">text<br></p>');
    trimEdgeEmpties(body);
    expect(squash(body.innerHTML)).toBe('<p style="margin:0">text</p>');
  });

  it('recurses into the first element to remove a nested leading break', () => {
    const body = parseBody('<p><br>text</p>');
    trimEdgeEmpties(body);
    expect(squash(body.innerHTML)).toBe('<p>text</p>');
  });

  it('removes empty blocks, breaks and whitespace at both edges', () => {
    const body = parseBody('  <br><div></div><p>real</p><div>&nbsp;</div><br>  ');
    trimEdgeEmpties(body);
    expect(squash(body.innerHTML)).toBe('<p>real</p>');
  });

  // Regression: a trailing image block is content, not padding. Trimming it
  // would delete the picture at the end of the message.
  it('stops at a trailing element that holds media', () => {
    const body = parseBody('<p>see</p><div><img src="x.png"></div>');
    trimEdgeEmpties(body);
    expect(squash(body.innerHTML)).toBe('<p>see</p><div><img src="x.png"></div>');
  });

  it('leaves a comment node at the edge alone', () => {
    const body = parseBody('<!--note--><p>real</p><!--tail-->');
    trimEdgeEmpties(body);
    expect(body.innerHTML).toContain('<p>real</p>');
  });

  it('does nothing to an empty root', () => {
    const body = parseBody('');
    trimEdgeEmpties(body);
    expect(squash(body.innerHTML)).toBe('');
  });
});

describe('collapseExcessBlankSpace', () => {
  // Regression: Word and Outlook round-trips stack empty paragraphs. Rendered
  // faithfully in a bubble that draws a border, ten of them is a screenful of
  // nothing.
  it('collapses a run of empty blocks to one blank line', () => {
    expect(collapseExcessBlankSpace('<p>a</p><p></p><p>&nbsp;</p><p></p><p>b</p>')).toBe(
      '<p>a</p><br><p>b</p>',
    );
  });

  // Regression: a global replace only reaches the INNERMOST level in one pass,
  // and the placeholder it leaves has to count as blank for the next pass to
  // see the enclosing block. Miss either half and the retry loop is dead code:
  // the wrappers survive however many passes run.
  it('peels nested empty blocks', () => {
    expect(collapseExcessBlankSpace('<div><div><p></p></div></div>')).toBe('<br>');
  });

  // A nest deeper than the pass limit degrades to fewer levels peeled, never to
  // wrong output or an unbounded loop.
  it('bounds the peel on a pathologically deep nest', () => {
    const deep = `${'<div>'.repeat(40)}${'</div>'.repeat(40)}`;
    expect(collapseExcessBlankSpace(deep).length).toBeLessThan(deep.length);
  });

  // Regression: a styled block is a template's SPACER with an explicit height,
  // not stray blankness. Collapsing it breaks the layout of a designed email.
  it('never touches a block carrying a style attribute', () => {
    const spacer = '<div style="height:24px"></div>';
    expect(collapseExcessBlankSpace(spacer)).toBe(spacer);
  });

  it('collapses a long break run to two and leaves a short one', () => {
    expect(collapseExcessBlankSpace('a<br><br><br>b')).toBe('a<br><br>b');
    expect(collapseExcessBlankSpace('a<br><br>b')).toBe('a<br><br>b');
  });

  it('returns falsy input unchanged', () => {
    expect(collapseExcessBlankSpace('')).toBe('');
  });
});

describe('looksDesigned', () => {
  // Regression: every one of these means "this body owns its own layout".
  // Treating a designed email as hand-written and stripping it turns a
  // newsletter into a wireframe.
  it.each([
    ['a style block', '<style>p{color:red}</style><p>hi</p>'],
    ['a presentation role', '<table role="presentation"><tr><td>hi</td></tr></table>'],
    ['a bgcolor attribute', '<td bgcolor="#fff">hi</td>'],
    ['two or more tables', '<table><tr><td>a</td></tr></table><table><tr><td>b</td></tr></table>'],
    ['an embedded image', '<p>hi <img src="logo.png"></p>'],
    ['a styled call-to-action', '<a href="#" style="background:#000;padding:8px">Go</a>'],
    [
      'four or more inline styles',
      '<p style="a"></p><p style="b"></p><p style="c"></p><p style="d"></p>',
    ],
  ])('is true for %s', (_label, html) => {
    expect(looksDesigned(html)).toBe(true);
  });

  // Regression: the other direction. A plain reply misread as designed skips
  // every strip pass, and its signature stays in the bubble.
  it('is false for a hand-written reply and for nothing at all', () => {
    expect(looksDesigned('<p>Sounds good, thanks.</p><p>Ankur</p>')).toBe(false);
    expect(looksDesigned('<table><tr><td>one table only</td></tr></table>')).toBe(false);
    expect(looksDesigned('')).toBe(false);
    expect(looksDesigned(null)).toBe(false);
    expect(looksDesigned(undefined)).toBe(false);
  });
});
