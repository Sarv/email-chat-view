/**
 * A stable colour per participant.
 *
 * Two requirements pull against each other. A person's colour should be the
 * SAME everywhere, so you learn it — which means deriving it from the address,
 * i.e. a hash. But a hash has collisions, and two participants landing on
 * near-identical hues inside one conversation is worse than either of them
 * having a "wrong" colour, because the whole point is telling them apart.
 *
 * So: identity hue from the address, and if it lands too close to a hue already
 * taken in THIS thread, rotate it away. Identity colours when there is no
 * clash, guaranteed-distinct colours when there would be.
 */

/** A participant's colours, as CSS colour strings applied inline. */
export interface SenderColor {
  /** Solid fill for the avatar circle; dark enough for white initials. */
  avatar: string;
  /** Faint wash behind the bubble, same hue. */
  bubble: string;
  /**
   * `bubble`, flattened against the app's surface so it is OPAQUE.
   *
   * A designed mail is rendered in a frame whose own page is transparent, so a
   * translucent tint behind it comes up THROUGH the message — the sender's
   * colour appears behind some paragraphs and not others, depending on what the
   * mail happens to paint. The document needs one solid page, and this is it:
   * the same colour as the bubble by construction, so the mail reads as being
   * printed on the sender's colour rather than as a white slab inside it.
   */
  page: string;
  /**
   * The bubble's rim, same hue, strong enough to read on its own.
   *
   * A chat line shows its sender's colour as the fill behind the text, so a
   * faint wash is plenty. A DESIGNED mail does not: it is rendered verbatim
   * edge to edge and paints its own surface over the wash, so the only part of
   * the bubble the sender's colour can still reach is its border — which at
   * `bubble`'s alpha is invisible. This is that border, and it is what makes a
   * document identifiable at a glance in a column of them.
   */
  edge: string;
}

/** Fallback identity for a message with no usable sender address. */
const UNKNOWN_SENDER = 'unknown';

/* FNV-1a 32-bit offset basis and prime. */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * Deterministic hue (0–359) for an address.
 *
 * FNV-1a, hand-written and eight lines long, rather than a colour-hash
 * dependency: the only thing wanted from such a package is one number, and
 * every one of them returns a formatted CSS string that then has to be parsed
 * back apart to recover the hue. `Math.imul` keeps the multiply in 32-bit
 * integer space, so the result is identical on every platform and across
 * versions — which is what "stable across threads" actually requires.
 */
export function senderHue(address: string): number {
  const key = (address || '').trim().toLowerCase() || UNKNOWN_SENDER;
  let hash = FNV_OFFSET;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash % 360;
}

/**
 * How much of the hue the bubble carries.
 *
 * Shared by `bubble` and `page` so the translucent tint and the opaque page can
 * never drift: `color-mix(A p%, B)` is exactly `A` at alpha `p` composited over
 * `B`, so at one alpha the two are the same colour by construction rather than
 * by two numbers someone has to remember to keep in step.
 */
const TINT_ALPHA = 0.12;

/** Avatar fill, the matching faint bubble wash, its opaque twin, and the rim. */
export function colorForHue(hue: number): SenderColor {
  const normalized = (((hue % 360) + 360) % 360).toFixed(1);
  const tint = `hsl(${normalized} 60% 50%)`;
  return {
    avatar: `hsl(${normalized} 58% 43%)`,
    bubble: `hsl(${normalized} 60% 50% / ${TINT_ALPHA})`,
    // `var(--sec-surface)` rather than a literal: the page has to follow the
    // reader's theme, so the same hue flattens against white in light mode and
    // against the dark surface in dark mode. Resolved by the host stylesheet,
    // which is the only context this string is ever used in.
    page: `color-mix(in srgb, ${tint} ${TINT_ALPHA * 100}%, var(--sec-surface))`,
    // Held back from the avatar's full strength: a rim this colour outlines
    // every bubble in the thread, and at the avatar's saturation a column of
    // them reads as a set of warning boxes rather than a conversation.
    edge: `hsl(${normalized} 55% 48% / 0.5)`,
  };
}

/** Hues closer than this read as the same colour side by side. */
export const MIN_HUE_SEP = 28;

/**
 * The golden angle. Rotating by it repeatedly visits the circle about as
 * evenly as any sequence can, so successive retries keep landing in the widest
 * remaining gap instead of marching through neighbouring hues.
 */
const GOLDEN_ANGLE = 137.508;

/** Give up rotating after this many tries — a full pass of the circle. */
const MAX_ROTATIONS = 24;

/** Shortest distance between two hues on the colour wheel. */
function hueDistance(left: number, right: number): number {
  const delta = Math.abs(left - right) % 360;
  return Math.min(delta, 360 - delta);
}

/**
 * Build the thread's address → colour map, assigning in order of appearance.
 *
 * `ownAddresses` are skipped: the reader's own bubbles use the brand tint, and
 * burning a hue on them would push a real participant's colour away for nothing.
 */
export function buildSenderColorMap(
  addresses: Iterable<string | null | undefined>,
  ownAddresses: Iterable<string | null | undefined> = [],
): Map<string, SenderColor> {
  const own = new Set<string>();
  for (const address of ownAddresses) {
    const normalized = (address || '').trim().toLowerCase();
    if (normalized) own.add(normalized);
  }

  const colors = new Map<string, SenderColor>();
  const taken: number[] = [];

  for (const address of addresses) {
    const normalized = (address || '').trim().toLowerCase();
    if (!normalized || own.has(normalized) || colors.has(normalized)) continue;

    let hue = senderHue(normalized);
    for (
      let attempt = 0;
      attempt < MAX_ROTATIONS && taken.some((used) => hueDistance(hue, used) < MIN_HUE_SEP);
      attempt += 1
    ) {
      hue = (hue + GOLDEN_ANGLE) % 360;
    }
    taken.push(hue);
    colors.set(normalized, colorForHue(hue));
  }

  return colors;
}

/**
 * Look a sender's colour up, falling back to their identity hue.
 *
 * The fallback is not defensive padding — a bubble whose sender never made it
 * into the map (a message appended after the map was built, an address that
 * only appears in a Cc list) must still render a colour rather than a hole.
 */
export function resolveSenderColor(
  colors: ReadonlyMap<string, SenderColor>,
  address: string | null | undefined,
): SenderColor {
  const normalized = (address || '').trim().toLowerCase();
  return colors.get(normalized) ?? colorForHue(senderHue(normalized));
}
