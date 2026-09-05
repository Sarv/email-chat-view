/**
 * Disclaimer rules — trailing legal / confidentiality footers.
 *
 * Split out from the signature rules on purpose. They look similar (both are
 * trailing boilerplate nobody wants in a chat bubble) but they behave nothing
 * alike: a signature is an element a client marked for you, while a disclaimer
 * is prose a mail gateway appended with no marker at all. One is a selector,
 * the other is evidence.
 *
 * Evidence, not a single pattern, because "confidential" appears in sentences
 * people genuinely write. A block qualifies only when it sits at the trailing
 * edge, OPENS with boilerplate phrasing, and carries several distinct signals.
 * Corporate footers routinely run 600+ characters, which is why the older "cut
 * at the -- line" approach never caught them.
 *
 * This family is where non-English contributions matter most: a German
 * `Vertraulichkeitshinweis` or Japanese equivalent needs its own rule with a
 * `language` tag, not an extra branch in a shared pattern.
 */
import type { DisclaimerRule } from './types.js';

/**
 * English corporate confidentiality footer.
 *
 * `opens` is the load-bearing condition. It anchors to the START of the block's
 * text, so a paragraph that merely mentions confidentiality cannot match, and a
 * wrapper holding real content followed by a footer cannot either — the engine
 * descends into that wrapper instead of deleting the lot.
 */
export const englishDisclaimer: DisclaimerRule = {
  name: 'english-corporate',
  provider: 'Mail gateways / corporate appenders',
  language: 'en',
  opens:
    /^(?:this (?:e-?mail|email|message|communication)|disclaimer|email disclaimer|confidentiality notice|notice:|the (?:information|contents?) (?:of|contained|in))/i,
  signals: [
    /\bconfidential(?:ity)?\b/i,
    /intended (?:recipient|solely)/i,
    /hereby notified/i,
    /disseminat(?:e|ion)/i,
    /delete (?:the|this) (?:message|e-?mail)/i,
    /\bprivileged\b/i,
    /\bdisclaimer\b/i,
    /no liability|accepts? no (?:liability|responsibility)/i,
    /views (?:expressed|of the author)/i,
    /\bvirus(?:es)?\b/i,
  ],
  minSignals: 2,
  minTextLength: 120,
};

/**
 * Boilerplate following an explicit `<hr>` divider.
 *
 * No `opens` requirement, and only ONE signal needed, because the `<hr>` is
 * itself the boundary evidence — a sender who drew a horizontal rule and then
 * wrote about confidentiality has told us where their message ends. This rule
 * is therefore only ever used by the `<hr>` strategy, never to judge a trailing
 * block on its own.
 */
export const hrDelimitedDisclaimer: DisclaimerRule = {
  name: 'hr-delimited',
  provider: 'Mail gateways / corporate appenders',
  language: 'en',
  signals: [
    /\bconfidential\b/i,
    /\bprivileged\b/i,
    /\bdisclaimer\b/i,
    /intended recipient/i,
    /notify the sender/i,
    /delete it from/i,
    /\bvirus\b/i,
    /external (?:e-?mail|sender)/i,
  ],
  minSignals: 1,
};

/** Default disclaimer rule set. */
export const disclaimerRules: DisclaimerRule[] = [englishDisclaimer, hrDelimitedDisclaimer];
