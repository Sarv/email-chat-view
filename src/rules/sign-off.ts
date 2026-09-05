/**
 * Sign-off patterns — where a person's own closing begins.
 *
 * "Thanks", "Best regards", "Yours sincerely". These are not a client
 * convention like the rest of the rules in this directory: nothing emits them,
 * people type them. That makes them the only signature marker present in the
 * majority of hand-written mail, and the reason signature cards kept surviving
 * every other pass.
 *
 * Kept apart from {@link lineRules} because the pass that uses them is not a
 * line rule. A line rule cuts as soon as its pattern matches; cutting at the
 * first "Thanks" would truncate "Thanks for the quick turnaround, here is
 * what…" at the top of the message. The sign-off pass takes the LAST match and
 * then applies size, share and evidence guards before it cuts anything — see
 * `src/transform/sign-off.ts`.
 *
 * Multiline (`m`) throughout: these are matched against flattened body text, so
 * `^` and `$` mean the start and end of a visual line.
 */

/**
 * Lines that open a sign-off block.
 *
 * ADDING A LANGUAGE: append a pattern. Each must be anchored at both ends of
 * the line, because the guard that keeps this safe is "the whole line is the
 * sign-off and nothing else" — an unanchored "regards" matches the middle of a
 * sentence, and the block that follows would take the rest of the message.
 */
export const signOffPatterns: RegExp[] = [
  // Leading whitespace is ALLOWED. HTML-to-text conversion indents the `-- `
  // separator, and anchoring to column 0 means the one standardized signature
  // marker goes unrecognised on exactly the HTML mail that needs it most.
  /^\s*--+\s*$/m, // RFC 3676 `-- `
  /^\s*—+\s*$/m, // em dash
  /^\s*___+\s*$/m, // underscores
  /^Sent from my (iPhone|iPad|Android)/im, // mobile footer

  // Trailing punctuation is OPTIONAL and unrestricted: real mail is full of
  // "Regards!", "Thanks :)" and "Best -", and a comma-only pattern matches none
  // of them. When nothing matches there is no signature block at all, and the
  // card stays in the bubble.
  /^(Best|Kind|Warm)\s+regards?\b[!.,:;)\s-]*$/im,
  // Combined sign-offs: "Thanks & Regards", "Thank you and Regards",
  // "Thanks, Regards" — extremely common, and none of them match the patterns
  // above or below.
  /^(Thanks?|Thank you|Best|Kind|Warm)\s*(&|and|n|,)\s*regards?\b[!.,:;)\s-]*$/im,
  /^(Thanks|Thank you|Regards|Sincerely|Cheers|Best|Br|Rgds)\b[!.,:;)\s-]*$/im,
  /^(Yours (sincerely|faithfully|truly))\b[!.,:;)\s-]*$/im,
];

/**
 * A job title or role — the kind of line a signature carries and a message
 * body does not. One of the two pieces of STRONG evidence that let the sign-off
 * pass relax its size guards.
 */
export const signatureTitlePattern =
  /\b(engineer|developer|manager|director|founder|co-?founder|ceo|cto|coo|cfo|vp|consultant|analyst|architect|officer|executive|president|head\s+of|specialist|coordinator|administrator|lead|associate|designer|marketer|advocate|evangelist)\b/i;
