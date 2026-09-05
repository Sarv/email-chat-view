/**
 * The sandboxed frame a rich body renders in.
 *
 * Everything here is a pure string or number function over an already-parsed
 * document, so the interesting decisions — what the frame is allowed to load,
 * how tall it is, where a click goes — are testable without a browser. The
 * component is left with nothing but wiring.
 *
 * Two independent locks hold the frame shut, because each covers what the other
 * misses:
 *
 *   `sandbox="allow-same-origin allow-popups"`   no `allow-scripts`, so no
 *       script in the message can run at all. `allow-same-origin` is what lets
 *       the parent measure the content and intercept clicks; it is only safe
 *       BECAUSE scripts are off, and the two must be changed together or not
 *       at all.
 *   `default-src 'none'` via a CSP meta   nothing loads — no fonts, no frames,
 *       no beacons — and remote images load only when the reader has asked for
 *       them. This is what makes tracking-pixel blocking a policy rather than a
 *       rewriting exercise over `src` attributes.
 */

/** Colours and type for the frame, sourced from the host's own tokens. */
export interface FrameTheme {
  ink: string;
  muted: string;
  border: string;
  link: string;
  font: string;
  fontSize: string;
  lineHeight: string;
}

/**
 * Used when the host has not loaded this package's stylesheet, so the
 * `--sec-*` tokens resolve to nothing.
 *
 * CSS SYSTEM colours rather than literals: `CanvasText` and friends are
 * whatever the reader's platform and colour scheme say they are, so a frame
 * still reads correctly in dark mode. Hard-coding `#0b1530` here would also
 * duplicate a value that `styles/index.css` already owns, and the two copies
 * would drift.
 */
export const FALLBACK_FRAME_THEME: FrameTheme = {
  ink: 'CanvasText',
  muted: 'GrayText',
  border: 'ButtonBorder',
  link: 'LinkText',
  font: 'system-ui, sans-serif',
  fontSize: 'medium',
  lineHeight: 'normal',
};

/** The `--sec-*` token backing each theme slot. */
const THEME_TOKENS: Record<keyof FrameTheme, string> = {
  ink: '--sec-ink',
  muted: '--sec-muted',
  border: '--sec-border',
  link: '--sec-brand',
  font: '--sec-font',
  fontSize: '--sec-fs-body',
  lineHeight: '--sec-lh-body',
};

/**
 * Read the frame's theme out of the host's cascade.
 *
 * The frame is a separate document, so it inherits nothing — every value has to
 * be copied in. Copying them from the computed `--sec-*` variables keeps the
 * stylesheet the single source of truth: a consumer who overrides
 * `--sec-ink` restyles the frames too, without this file knowing.
 */
export function readFrameTheme(element: Element | null | undefined): FrameTheme {
  const view = element?.ownerDocument?.defaultView;
  if (!element || !view) return FALLBACK_FRAME_THEME;
  const computed = view.getComputedStyle(element);
  const entries = Object.entries(THEME_TOKENS) as [keyof FrameTheme, string][];
  const theme = { ...FALLBACK_FRAME_THEME };
  for (const [slot, token] of entries) {
    const value = computed.getPropertyValue(token).trim();
    if (value) theme[slot] = value;
  }
  return theme;
}

/** Base stylesheet injected into the frame, ahead of the message's own CSS. */
export function buildFrameCss(theme: FrameTheme): string {
  // Low specificity and no `!important` anywhere: these are DEFAULTS the
  // sender's own CSS is meant to override. A designed newsletter that sets its
  // own font must win, or the frame stops being a faithful rendering of the
  // mail and starts being an opinion about it.
  return [
    'html,body{margin:0;padding:0;background:transparent;}',
    `body{color:${theme.ink};font-family:${theme.font};font-size:${theme.fontSize};`,
    `line-height:${theme.lineHeight};overflow-wrap:anywhere;}`,
    `a{color:${theme.link};}`,
    'img{max-width:100%;height:auto;}',
    // A wide table scrolls WITHIN ITSELF rather than being cut off.
    //
    // `max-width:100%` alone cannot save a table whose cells carry fixed
    // widths — a `<td width="300">` six times over has a min-content width of
    // 1800px, and the table overflows the body no matter what its own
    // max-width says. The frame is `scrolling="no"` (it auto-sizes to its
    // content, so a scrollbar of its own would be wrong), which means that
    // overflow is not scrolled but LOST: the reader sees a table sliced off at
    // the bubble's edge with no indication there is more.
    //
    // `display:block` turns the table into a scroll container while its rows
    // and cells keep generating anonymous table boxes, so it still lays out as
    // a table — the long-standing fix, and the one the view this library was
    // extracted from shipped. `width:max-content` restores the shrink-to-fit
    // that `display:block` would otherwise cost a narrow table.
    'table{display:block;width:max-content;max-width:100%;overflow-x:auto;}',
    `blockquote{margin:0 0 0 .5em;padding-left:.75em;border-left:2px solid ${theme.border};color:${theme.muted};}`,
    'p{margin:0 0 .5em;}',
    'p:last-child{margin-bottom:0;}',
  ].join('');
}

/** Options for {@link buildFrameDocument}. */
export interface FrameDocumentOptions {
  /** Already-sanitized body HTML. */
  html: string;
  /** Theme copied in from the host. */
  theme?: FrameTheme;
  /** Keep the message from fetching images off the network. Default true. */
  blockRemoteImages?: boolean;
}

/**
 * Build the frame's `srcdoc`.
 *
 * `html` must already be sanitized — see `sanitizeFrameHtml`. This function
 * assembles a document and its policy; it is not a second sanitizer, and
 * calling it with raw message HTML would rely on the sandbox alone.
 */
export function buildFrameDocument({
  html,
  theme = FALLBACK_FRAME_THEME,
  blockRemoteImages = true,
}: FrameDocumentOptions): string {
  // `cid:` covers the message's own inline parts, `data:` the ones already
  // embedded. Neither touches the network, so both are allowed even while
  // remote images are blocked — a signature logo is not a tracking pixel.
  const localSources = "data: cid:";
  const imageSources = blockRemoteImages ? localSources : `${localSources} https: http:`;
  const policy = [
    "default-src 'none'",
    `img-src ${imageSources}`,
    `media-src ${imageSources}`,
    "style-src 'unsafe-inline'",
    "font-src data:",
  ].join('; ');

  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
    `<style>${buildFrameCss(theme)}</style>`,
    '</head><body>',
    html,
    '</body></html>',
  ].join('');
}

/** Bounds for the pre-measurement height guess. */
const MIN_ESTIMATED_HEIGHT = 40;
const MAX_ESTIMATED_HEIGHT = 480;
/** Rough characters of markup per rendered line. */
const CHARS_PER_LINE = 90;
/** Rough rendered line height, in px. */
const LINE_HEIGHT = 20;

/**
 * A height to use before the frame has been measured.
 *
 * Only there to stop the thread jumping: the frame is invisible until the real
 * measurement lands, and a wildly wrong guess would make the scroll position
 * lurch at that moment. Capped, so one enormous newsletter cannot reserve a
 * screenful of blank space per bubble.
 */
export function estimateFrameHeight(html: string): number {
  const lines = Math.ceil((html?.length ?? 0) / CHARS_PER_LINE) || 1;
  return Math.min(MAX_ESTIMATED_HEIGHT, Math.max(MIN_ESTIMATED_HEIGHT, lines * LINE_HEIGHT));
}

/**
 * Measure the true height of a frame's content.
 *
 * A `Range` over the body, then the maximum of that and the document's own
 * scroll heights. Each covers a failure of the others:
 *
 *   - the Range's box includes trailing TEXT nodes (which `lastChild.bottom`
 *     misses, under-measuring and clipping the last line) but EXCLUDES the
 *     trailing margin of the last paragraph (which `scrollHeight` includes,
 *     leaving dead space at the bottom of every bubble);
 *   - `scrollHeight` catches absolutely-positioned and floated content that
 *     sits outside the Range's box.
 *
 * The frame is sized to this and its own scrollbar is off, so an
 * under-measurement clips the message — hence the max, never the min.
 */
export function measureFrameHeight(doc: Document | null | undefined): number {
  const body = doc?.body;
  if (!doc || !body) return 0;

  let height = 0;
  try {
    const range = doc.createRange();
    range.selectNodeContents(body);
    height = Math.ceil(range.getBoundingClientRect().bottom - body.getBoundingClientRect().top);
  } catch {
    // No Range support (or a document that refuses one). The scroll heights
    // below are enough on their own; they just include trailing margins.
  }

  const scrollHeights = [body.scrollHeight, doc.documentElement?.scrollHeight ?? 0];
  return Math.max(height, ...scrollHeights.map((value) => (Number.isFinite(value) ? value : 0)));
}

/** Schemes a click inside a message may be routed to. */
const CLICKABLE_SCHEMES = ['http://', 'https://', 'mailto:'];

/**
 * The href of the anchor a click landed in, if it is one worth following.
 *
 * Walks up from the event target, because the click almost always lands on
 * something INSIDE the link — the text node's element, an image, a `<span>` a
 * sender wrapped it in.
 */
export function clickedHref(target: unknown): string | null {
  const element = target as { closest?: (selector: string) => Element | null } | null;
  const anchor = element?.closest?.('a');
  const href = anchor?.getAttribute('href')?.trim() ?? '';
  if (!href) return null;
  const lowered = href.toLowerCase();
  return CLICKABLE_SCHEMES.some((scheme) => lowered.startsWith(scheme)) ? href : null;
}
