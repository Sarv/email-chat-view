/**
 * Composing your own rule set.
 *
 * Two things every consumer eventually needs: teaching the stripper a client it
 * has never seen, and dropping a shipped rule that is too aggressive for their
 * corpus. Both are array literals — there is no plugin API to learn.
 *
 * Run it from a checkout:
 *
 *     pnpm build && node examples/custom-rules/acme-signature.mjs
 *
 * In your app the import is `@sarv-in/email-chat-view/transform`.
 */
import { parseHTML } from 'linkedom';

import {
  bareBlockquote,
  cleanReplyBody,
  quoteRules,
  signatureRules,
} from '../../dist/transform.js';

const parser = (html) => parseHTML(`<html><body>${html}</body></html>`).document;

/**
 * A signature container this package does not know about.
 *
 * `name` is what shows up in `applied` (as `signature:acme`) when someone is
 * working out what ate their text, so name it after the provider rather than
 * after the markup. `maxTextLength` is the guard: if the selector could ever
 * match a wrapper instead of the signature itself, a match longer than this is
 * refused rather than deleting half the message.
 */
const acmeSignature = {
  name: 'acme',
  provider: 'Acme Mail 4.x',
  selectors: ['div.acme-sig'],
  maxTextLength: 500,
};

/** A marker rule for a language the shipped English-only set does not cover. */
const germanWroteAttribution = {
  name: 'wrote-attribution-de',
  provider: 'Gmail / Outlook (de)',
  language: 'de',
  patterns: [
    // Bounded quantifiers, never `[\s\S]*?`: an unbounded one on a 5 MB
    // marketing email is a ReDoS, and mail is the most hostile input you get.
    /<div[^>]*>\s*Am\s+[^<]{4,200}\s+schrieb\s+[^<]{2,120}:/i,
    /Am\s+[^\n<]{4,200}\s+schrieb\s+[^\n<]{2,120}:/i,
  ],
};

const body = `
  <div>Sieht gut aus, Donnerstag passt.</div>
  <div class="acme-sig">Alice Chen | Acme Corp</div>
  <div>Am 3. M&auml;rz 2025 um 09:14 schrieb Bob Meyer:</div>
  <blockquote>Passt Donnerstag bei dir?</blockquote>
`;

const result = cleanReplyBody(body, {
  parser,
  // Extend rather than replace: keep everything shipped, add yours.
  signatureRules: [...signatureRules, acmeSignature],
  markerRules: [germanWroteAttribution],
  // Drop one shipped rule — the bare `<blockquote>` catch-all is the loosest,
  // and a corpus full of genuine pull-quotes is exactly where it misfires.
  quoteRules: quoteRules.filter((rule) => rule !== bareBlockquote),
});

console.log(result.html.trim());
console.log('\napplied:', result.applied);
