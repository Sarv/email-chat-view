// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Avatar } from '../../src/components/Avatar.js';
import { ChatSkeleton } from '../../src/components/ChatSkeleton.js';
import { DateSeparator } from '../../src/components/DateSeparator.js';
import {
  AlertTriangleIcon,
  ChevronUpIcon,
  DownloadIcon,
  EyeIcon,
  ImageOffIcon,
  PaperclipIcon,
  SpinnerIcon,
} from '../../src/components/icons.js';

describe('icons', () => {
  // Regression: every glyph in this set sits next to a text label or inside a
  // button that carries its own accessible name. Without `aria-hidden` a screen
  // reader announces the decoration too, so "Download: report.pdf" is read as
  // an image and then as a button.
  it('are decorative and inherit their colour', () => {
    for (const Icon of [
      SpinnerIcon,
      PaperclipIcon,
      EyeIcon,
      DownloadIcon,
      AlertTriangleIcon,
      ImageOffIcon,
      ChevronUpIcon,
    ]) {
      const { container, unmount } = render(<Icon />);
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.getAttribute('focusable')).toBe('false');
      // `currentColor` is what lets one glyph work on a light bubble, a dark
      // bubble and a danger note without a variant per surface.
      expect(svg?.getAttribute('stroke')).toBe('currentColor');
      expect(svg?.querySelector('path, circle')).not.toBeNull();
      unmount();
    }
  });

  // Regression: the spinner turns in CSS. A JS animation in a mail client's
  // message list runs on the same thread as the sync, so it visibly stutters
  // exactly when something is loading — which is the only time it is on screen.
  it('spins the spinner with a class, not a script', () => {
    const { container } = render(<SpinnerIcon />);
    expect(container.querySelector('svg')?.getAttribute('class')).toBe('sec-spin');
  });

  it('lets the caller’s own props through', () => {
    const { container } = render(<PaperclipIcon className="sec-chip__clip" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toBe('sec-chip__clip');
  });
});

describe('Avatar', () => {
  it('shows the sender’s initials on their identity colour', () => {
    const { container } = render(
      <Avatar address="alice@acme.example" name="Alice Chen" color="hsl(200 58% 43%)" />,
    );
    const avatar = container.querySelector('.sec-avatar') as HTMLElement;
    expect(avatar.textContent).toBe('AC');
    // The library emits `hsl()`; jsdom's CSSOM normalizes it to `rgb()` on the
    // way into the style property, so this is the same colour written back.
    expect(avatar.style.backgroundColor).toBe('rgb(46, 131, 173)');
    // The name is already in the bubble header beside this; announcing it again
    // makes a screen reader read every sender twice.
    expect(avatar.getAttribute('aria-hidden')).toBe('true');
  });

  it('takes the surface colour when no identity colour is given', () => {
    const { container } = render(<Avatar address="me@acme.example" />);
    expect((container.querySelector('.sec-avatar') as HTMLElement).getAttribute('style')).toBeNull();
  });

  // Regression: THE reason the spacer exists. A follow-up bubble in a sender run
  // does not repeat the circle, but if the space goes too, every bubble after
  // the first in a run steps left and the run stops looking like one column.
  it('holds the circle’s space open without drawing it', () => {
    const { container } = render(<Avatar address="alice@acme.example" spacer />);
    const spacer = container.querySelector('.sec-avatar') as HTMLElement;
    expect(spacer.className).toBe('sec-avatar sec-avatar--spacer');
    expect(spacer.textContent).toBe('');
  });
});

describe('DateSeparator', () => {
  // Regression: without an accessible name a screen reader steps from one day
  // into the next in silence, and a thread spanning a fortnight reads as one
  // continuous conversation.
  it('announces the day change', () => {
    const { container } = render(<DateSeparator label="Yesterday" />);
    const separator = container.querySelector('[role="separator"]') as HTMLElement;
    expect(separator.getAttribute('aria-label')).toBe('Yesterday');
    expect(container.querySelector('.sec-date-sep__label')?.textContent).toBe('Yesterday');
    expect(container.querySelectorAll('.sec-date-sep__line')).toHaveLength(2);
  });
});

describe('ChatSkeleton', () => {
  it('lays out ghost bubbles on alternating sides', () => {
    const { container } = render(<ChatSkeleton />);
    const ghosts = [...container.querySelectorAll('.sec-ghost')];
    expect(ghosts).toHaveLength(3);
    expect(ghosts.map((ghost) => ghost.className)).toEqual([
      'sec-ghost',
      'sec-ghost sec-ghost--mine',
      'sec-ghost',
    ]);
    // Uneven widths, so it reads as a conversation rather than a loading bar.
    expect(ghosts.map((ghost) => (ghost as HTMLElement).style.width)).toEqual([
      '62%',
      '78%',
      '46%',
    ]);
  });

  // Regression: the widths are a fixed list of three. A host asking for more
  // rows than that must wrap around, not render zero-width ghosts.
  it('cycles its widths when asked for more rows than it has', () => {
    const { container } = render(<ChatSkeleton rows={5} />);
    const widths = [...container.querySelectorAll('.sec-ghost')].map(
      (ghost) => (ghost as HTMLElement).style.width,
    );
    expect(widths).toEqual(['62%', '78%', '46%', '62%', '78%']);
  });

  it('renders nothing when asked for no rows', () => {
    const { container } = render(<ChatSkeleton rows={0} />);
    expect(container.querySelectorAll('.sec-ghost')).toHaveLength(0);
    // The skeleton is decoration; it must never be announced as content.
    expect(container.querySelector('.sec-skeleton')?.getAttribute('aria-hidden')).toBe('true');
  });
});
