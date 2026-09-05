/**
 * The handful of glyphs the view needs, traced as inline SVG.
 *
 * No icon-library dependency: a component library that imports one forces its
 * choice on every consumer, doubles the icon set in any app that already has
 * one, and adds a peer that can go unmaintained. Six paths are cheaper than
 * that, and drawing them with `currentColor` means they inherit whatever colour
 * the surrounding text has, so they theme themselves.
 */
import type { SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>;

/** Shared geometry so every glyph lines up on the same grid and weight. */
function Glyph({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative by default: every one of these sits next to a text label or
      // inside a button that carries its own accessible name, so announcing the
      // glyph too would just repeat it.
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/** Indeterminate progress. Spun by CSS (`.sec-spin`), not by JS. */
export function SpinnerIcon(props: IconProps) {
  return (
    <Glyph className="sec-spin" {...props}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </Glyph>
  );
}

/** Attachment. */
export function PaperclipIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </Glyph>
  );
}

/** Preview. */
export function EyeIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </Glyph>
  );
}

/** Download. */
export function DownloadIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </Glyph>
  );
}

/** Something went wrong but the reader can still act. */
export function AlertTriangleIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Glyph>
  );
}

/** Remote images are being withheld. */
export function ImageOffIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M3 3l18 18" />
      <path d="M21 15V5a2 2 0 0 0-2-2H9" />
      <path d="M3 7v12a2 2 0 0 0 2 2h12" />
      <path d="M6 18l5-5 3 3" />
    </Glyph>
  );
}

/** Older history lies upward. */
export function ChevronUpIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="m6 15 6-6 6 6" />
    </Glyph>
  );
}
