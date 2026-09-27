/**
 * Tell a framed body when the page's theme may have changed.
 *
 * The frame is a separate document: its colours are COPIED in from the host's
 * `--sec-*` tokens, so a theme switch on the page reaches it only if someone
 * reads the tokens again. Reading them once, on mount, left every frame already
 * on screen in the theme it was opened in — dark table rows inside a page that
 * had just turned light.
 *
 * Deliberately coarse. A host switches theme by changing an attribute on
 * `<html>` or `<body>` (a class, a `data-theme`, an inline style) or by the
 * platform flipping `prefers-color-scheme`, so those are what is watched — not
 * every attribute in the page, which in a chat UI changes constantly. A host
 * that themes some other way can remount the view instead.
 */

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Call `onChange` whenever the theme around `element` may have changed.
 * Returns the unsubscribe. Anything the environment lacks (no
 * `MutationObserver`, no `matchMedia`) is simply not watched.
 */
export function watchHostTheme(
  element: Element | null | undefined,
  onChange: () => void,
): () => void {
  const doc = element?.ownerDocument;
  const view = doc?.defaultView;
  if (!doc || !view) return () => undefined;

  const stops: (() => void)[] = [];

  if (typeof view.MutationObserver === 'function') {
    const observer = new view.MutationObserver(onChange);
    const roots = [doc.documentElement, doc.body].filter((node): node is HTMLElement => !!node);
    roots.forEach((node) => observer.observe(node, { attributes: true }));
    stops.push(() => observer.disconnect());
  }

  const media = typeof view.matchMedia === 'function' ? view.matchMedia(DARK_QUERY) : null;
  if (media && typeof media.addEventListener === 'function') {
    media.addEventListener('change', onChange);
    stops.push(() => media.removeEventListener('change', onChange));
  }

  return () => stops.forEach((stop) => stop());
}
