/**
 * Attachment chips: what they say, and which of them offer a preview.
 */
import prettyBytes from 'pretty-bytes';

import type { Attachment } from '../types.js';

/**
 * Human-readable size, or an empty string when the store did not record one.
 *
 * `pretty-bytes` rather than a hand-rolled divide-by-1024 loop, because the
 * boring part is the part that goes wrong: which unit prefix at which
 * threshold, how many decimals at each magnitude, and the reader's own decimal
 * separator. It also refuses a non-finite number by throwing, so the guard
 * below is load-bearing — a mail store that reports `size: null` must not take
 * the bubble down with it.
 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
  return prettyBytes(bytes);
}

/** Lowercased extension without the dot; empty when the name has none. */
export function extensionOf(filename: string | null | undefined): string {
  const name = (filename || '').trim();
  const dot = name.lastIndexOf('.');
  // A leading dot is a UNIX hidden file, not an extension — `.gitignore` has
  // no type, and reporting `gitignore` as one would offer a preview for it.
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

/** Extensions the host is expected to be able to show inline. */
export const PREVIEWABLE_EXTENSIONS = new Set([
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'avif',
  'txt',
  'csv',
]);

/** MIME prefixes that are previewable whatever the filename says. */
const PREVIEWABLE_MIME_PREFIXES = ['image/', 'text/'];

/** Exact MIME types that are previewable. */
const PREVIEWABLE_MIME_TYPES = new Set(['application/pdf']);

/**
 * Whether to offer a preview affordance for this attachment.
 *
 * MIME type first, filename second. The type is what the sender declared and
 * the filename is a hint that is frequently missing or wrong (`document`,
 * `ATT00001`), so trusting the extension first is how a PDF ends up with no
 * preview button.
 */
export function isPreviewable(attachment: Attachment): boolean {
  const mimeType = (attachment.mimeType || '').trim().toLowerCase();
  if (mimeType) {
    if (PREVIEWABLE_MIME_TYPES.has(mimeType)) return true;
    if (PREVIEWABLE_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) return true;
  }
  return PREVIEWABLE_EXTENSIONS.has(extensionOf(attachment.filename));
}
