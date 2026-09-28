/**
 * The shipped stylesheet, parsed the way a browser parses it.
 *
 * Some layout is carried entirely by the stylesheet — the component only puts
 * a class on an element — so no component test can see whether it is right.
 * These read `src/styles/index.css` through jsdom's CSSOM into real `CSSRule`s,
 * which is as close to "what the browser was told" as a suite without a layout
 * engine gets. Callers must opt into the jsdom environment.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// `import.meta.url` is an http URL under the jsdom environment, so the path is
// taken from the package root Vitest runs in.
const STYLESHEET = join(process.cwd(), 'src/styles/index.css');

/** Every top-level rule of the shipped stylesheet, in source order. */
export function stylesheetRules(): CSSRule[] {
  const style = document.createElement('style');
  style.textContent = readFileSync(STYLESHEET, 'utf8');
  document.head.appendChild(style);
  const rules = Array.from(style.sheet?.cssRules ?? []);
  style.remove();
  return rules;
}

function isStyleRule(rule: CSSRule): rule is CSSStyleRule {
  return 'selectorText' in rule;
}

/** The declarations of a top-level rule, by exact selector text. */
export function declarationsFor(selector: string): CSSStyleDeclaration {
  const match = stylesheetRules().find(
    (rule): rule is CSSStyleRule => isStyleRule(rule) && rule.selectorText === selector,
  );
  if (!match) throw new Error(`no rule for ${selector}`);
  return match.style;
}

/**
 * The value `property` ends up with for `selector`, across EVERY rule whose
 * selector list names it — grouped `.a, .b { }` rules included — with the last
 * declaration winning, as the cascade decides between equally specific rules.
 * `''` when nothing declares it.
 *
 * With `media`, the rules looked at are the ones inside the `@media` block
 * whose condition contains that text, instead of the top-level ones.
 */
export function cascadedValue(selector: string, property: string, media?: string): string {
  const top = stylesheetRules();
  const scope = media
    ? top.flatMap((rule) =>
        rule instanceof CSSMediaRule && rule.media.mediaText.includes(media)
          ? Array.from(rule.cssRules)
          : [],
      )
    : top;
  let value = '';
  for (const rule of scope) {
    if (!isStyleRule(rule)) continue;
    const selectors = rule.selectorText.split(',').map((part) => part.trim());
    if (!selectors.includes(selector)) continue;
    const declared = rule.style.getPropertyValue(property);
    if (declared) value = declared;
  }
  return value;
}
