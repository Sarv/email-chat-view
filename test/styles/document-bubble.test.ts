// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The document bubble is the one place where the layout is carried entirely by
// the stylesheet — `ChatBubble` only inlines the sender's two colours, so no
// component test can see whether the document ends up flush against the spine
// or the tint ends up behind the sender's own body text. These read the shipped
// stylesheet the way a browser does (jsdom parses it into real `CSSRule`s) and
// pin the two declarations that carry that layout.

// `import.meta.url` is an http URL under the jsdom environment, so the path is
// taken from the package root Vitest runs in.
const STYLESHEET = join(process.cwd(), 'src/styles/index.css');

/** The declarations of a top-level rule, by exact selector text. */
function declarationsFor(selector: string): CSSStyleDeclaration {
  const style = document.createElement('style');
  style.textContent = readFileSync(STYLESHEET, 'utf8');
  document.head.appendChild(style);
  const rules = Array.from(style.sheet?.cssRules ?? []);
  style.remove();
  const match = rules.find(
    (rule): rule is CSSStyleRule =>
      'selectorText' in rule && (rule as CSSStyleRule).selectorText === selector,
  );
  if (!match) throw new Error(`no rule for ${selector}`);
  return match.style;
}

describe('.sec-bubble--doc', () => {
  // Regression: the bubble carried `padding: 0` so a designed mail could sit
  // edge to edge in its card. Once the sender's colour went onto the bubble and
  // the leading edge became a 3px spine, zero padding put the sender's first
  // line of text directly against that spine — the document needs a mat for the
  // colour to read as a mat rather than as a stripe glued to the words.
  it('keeps a mat of the sender’s colour around the document', () => {
    expect(declarationsFor('.sec-bubble--doc').padding).toBe('var(--sec-gap)');
  });

  // Regression: the frame's own `html,body` is transparent (see ui/frame.ts), so
  // with nothing opaque between the document and the bubble the sender's tint
  // came up THROUGH the mail — every paragraph and every table cell that
  // declared no background sat on the tint, while the cells that declared white
  // stayed white, which is the patchwork the tint was never meant to produce.
  // The host has to paint an OPAQUE page. `--sec-doc-page` is that page in the
  // sender's own colour (set inline by `ChatBubble`); the fallback is what a
  // message carrying no sender colour gets, and dropping it would leave a
  // document from the reader themselves with no page at all.
  //
  // CHANGED BEHAVIOUR: the page was `var(--sec-surface)` — a white slab inside
  // a coloured mat. It now takes the sender's colour, so the mail reads as
  // printed ON that colour rather than framed by it.
  it('prints the document on an opaque page in the sender’s own colour', () => {
    const host = declarationsFor('.sec-bubble--doc .sec-frame-host');
    expect(host.background).toBe('var(--sec-doc-page, var(--sec-surface))');
    // The images banner is flush to the top of the page, so the page clips it —
    // without this the banner squares off over the page's radius.
    expect(host.overflow).toBe('hidden');
  });

  // Regression: the cell wash has to be mixed from the PAGE. Leave it mixed
  // from `--sec-surface` (the global default) and every table cell the sender
  // declared white stays stark white on a coloured page — the exact patchwork
  // the opaque page was introduced to remove, just inverted.
  it('softens the sender’s cell colours against the page, not the app surface', () => {
    const wash = declarationsFor('.sec-bubble--doc').getPropertyValue('--sec-frame-wash');
    expect(wash).toContain('var(--sec-doc-page');
    // Still translucent, or the sender's own cell colours are erased rather
    // than softened. See ui/frame.ts.
    expect(wash).toContain('transparent');
  });

  // Regression: the attachments strip used to be inset by `--sec-pad` and ruled
  // off with a top border, both of which existed ONLY to compensate for the
  // bubble having no padding. Left in place over a mat they draw a border that
  // stops short of the card's edges.
  it('lets the attachments sit on the mat instead of being ruled off inside the page', () => {
    const attachments = declarationsFor('.sec-bubble--doc .sec-attachments');
    expect(attachments.padding).toBeFalsy();
    expect(attachments.getPropertyValue('border-block-start')).toBeFalsy();
  });
});
