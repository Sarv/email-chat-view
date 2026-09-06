/**
 * Generates the README picture of the two render slots.
 *
 *     pnpm build && node scripts/media/actions.mjs
 *
 * The question it answers is the one every host asks first: "where does my
 * three-dots menu GO?" Prose cannot answer it — the slot is positioned outside
 * the bubble's own box and mirrors with the row, so the only honest answer is a
 * picture of the real component with real controls in it.
 *
 * Nothing here is a mockup. `MailChatView` comes from `dist/`, styled by the
 * shipped `dist/style.css`, and the star and kebab are passed in through
 * `renderActions` exactly as a consumer would pass them — deliberately drawn
 * here rather than imported, because a host brings its own icons.
 *
 * The callouts are placed by MEASURING the rendered elements in the page, not
 * by hard-coded coordinates. So if the slot ever moves, the arrows move with it
 * and the picture cannot quietly start lying.
 *
 * Requires: a built `dist/` and Google Chrome.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createShooter } from './chrome.mjs';
// Side-effecting, and it MUST stay above any `dist/` import. See the file.
import './dom-globals.mjs';
import { mails, ME, NOW } from './thread.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT_DIR = join(ROOT, 'docs', 'media');
const SIZE = { width: 1180, height: 620 };

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const { MailChatView, mailsToMessages } = await import('../../dist/index.js');

const STYLESHEET = readFileSync(join(ROOT, 'dist', 'style.css'), 'utf8');
const LOGO = readFileSync(join(OUT_DIR, 'sarv-logo.svg'), 'utf8')
  .replace(/<\?xml[^>]*\?>/, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\s(?:width|height)="[^"]*"/, '')
  .replace('<svg', '<svg class="brand__logo"');

// Three messages: theirs, mine, theirs-with-an-attachment. Enough to show the
// slot on both sides of the thread without a wall of bubbles competing with
// the callouts for attention.
const messages = mailsToMessages(mails.slice(0, 3), { currentUserAddress: ME, dateUnit: 's' });

/** The host's own glyphs, on the same 24-grid the library draws on. */
const glyph = (children, props = {}) =>
  React.createElement(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: '1em',
      height: '1em',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      ...props,
    },
    children,
  );

const STAR_PATH =
  'M12 3.2l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.7l6.1-.9L12 3.2Z';

const starIcon = (filled) =>
  glyph(React.createElement('path', { key: 'star', d: STAR_PATH }), {
    fill: filled ? 'currentColor' : 'none',
  });

const kebabIcon = () =>
  glyph(
    [5, 12, 19].map((cy) =>
      React.createElement('circle', {
        key: cy,
        cx: 12,
        cy,
        r: 1.7,
        fill: 'currentColor',
        stroke: 'none',
      }),
    ),
  );

/**
 * The slot itself: whatever the host returns, rendered at the row's outer edge.
 *
 * A real host would use its own button component; the point of the picture is
 * WHERE the two buttons land, not what they look like.
 */
const renderActions = (message) =>
  React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'button',
      {
        key: 'star',
        type: 'button',
        className: `demo-act${message.id === '1' ? ' demo-act--on' : ''}`,
        'aria-label': 'Star this message',
      },
      starIcon(message.id === '1'),
    ),
    React.createElement(
      'button',
      { key: 'menu', type: 'button', className: 'demo-act', 'aria-label': 'More actions' },
      kebabIcon(),
    ),
  );

/** The other slot: inside the column, below the body. */
const renderFooter = (message) =>
  message.id === '3'
    ? React.createElement('div', { className: 'demo-reply' }, 'Replying to this message…')
    : null;

const chatMarkup = renderToStaticMarkup(
  React.createElement(MailChatView, {
    messages,
    currentUserAddress: ME,
    now: NOW,
    locale: 'en-GB',
    onDownloadAttachment: () => {},
    renderActions,
    renderFooter,
  }),
);

const page = `
<!doctype html>
<meta charset="utf-8">
<style>
${STYLESHEET}

:root {
  --demo-ink: #0b1530;
  --demo-muted: #6b7691;
  --demo-line: #e6e9f1;
  --demo-brand: #3069b0;
  --demo-accent: #b5651d;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  width: ${SIZE.width}px;
  height: ${SIZE.height}px;
  overflow: hidden;
  background: #eef1f7;
  color: var(--demo-ink);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
  -webkit-font-smoothing: antialiased;
}

.shell { display: flex; flex-direction: column; height: 100%; padding: 18px 20px 12px; }
.bar { display: flex; align-items: center; gap: 12px; padding-bottom: 10px; }
.bar__name { font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
.bar__tag { color: var(--demo-muted); font-size: 13px; }
.brand { margin-left: auto; display: flex; align-items: center; gap: 7px; opacity: 0.85; }
.brand__logo { height: 24px; width: auto; display: block; }

.caption {
  display: inline-flex; align-items: center; gap: 8px; align-self: flex-start;
  margin-bottom: 12px; padding: 5px 11px; border-radius: 999px;
  background: #fff; border: 1px solid var(--demo-line);
  font-size: 12.5px; font-weight: 600; color: var(--demo-muted);
}
.caption__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--demo-brand); }
.caption code { font-size: 12px; color: var(--demo-ink); }

/* The measuring frame for every callout. */
.stage { position: relative; flex: 1; min-height: 0; }

.panel {
  position: absolute; inset: 0 262px;
  background: #fff; border: 1px solid var(--demo-line);
  border-radius: 14px; overflow: hidden;
  box-shadow: 0 8px 24px rgba(11, 21, 48, 0.07);
}
.panel__scroll { height: 100%; overflow: hidden; padding: 14px 16px; }
.sec-thread { height: 100%; }

/* ---- the host's controls, passed through renderActions ---- */
.demo-act {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; padding: 0;
  border: 1px solid var(--demo-line); border-radius: 999px;
  background: #fff; color: var(--demo-muted); font-size: 14px;
  box-shadow: 0 1px 3px rgba(11, 21, 48, 0.10);
  cursor: pointer;
}
.demo-act--on { color: #e0a12b; border-color: #f0d7a4; background: #fffaf0; }

.demo-reply {
  margin-top: 8px; padding: 6px 10px;
  border: 1px dashed #b9c6de; border-radius: 8px;
  background: #f6f9ff; color: var(--demo-brand);
  font-size: 12px; font-weight: 600;
}

/*
 * The slot is opacity:0 until the row is hovered or focused — which is the
 * right behaviour and unphotographable. Forced on for the capture, and the
 * footnote says so.
 */
.sec-actions { opacity: 1 !important; }

/* ---- callouts, positioned by measurement ---- */
.ring {
  position: absolute; border: 1.5px dashed var(--demo-accent);
  border-radius: 999px; pointer-events: none;
}
.ring--box { border-radius: 10px; }
.wire {
  position: absolute; height: 0;
  border-top: 1.5px dashed var(--demo-accent); pointer-events: none;
}
.note {
  position: absolute; width: 214px;
  padding: 9px 11px; border-radius: 10px;
  background: #fff; border: 1px solid #ecdcc7;
  box-shadow: 0 4px 14px rgba(11, 21, 48, 0.08);
}
.note b {
  display: block; font-size: 12px; font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--demo-accent); margin-bottom: 2px;
}
.note span { display: block; font-size: 12px; line-height: 1.45; color: #3d485f; }

.foot {
  display: flex; align-items: center; gap: 8px;
  padding-top: 10px; font-size: 11.5px; color: var(--demo-muted);
}
.foot__spacer { margin-left: auto; }
</style>

<div class="shell">
  <div class="bar">
    <span class="bar__name">email-chat-view</span>
    <span class="bar__tag">your controls, in the view's two render slots</span>
    <span class="brand">${LOGO}</span>
  </div>

  <span class="caption"><i class="caption__dot"></i>Pass <code>renderActions</code> and <code>renderFooter</code>&nbsp;— pass neither and you get the thread alone</span>

  <div class="stage">
    <div class="panel"><div class="panel__scroll">${chatMarkup}</div></div>
  </div>

  <div class="foot">
    <span>The controls are the host's own — the view only positions them, and mirrors the side with the row.</span>
    <span class="foot__spacer">Hidden until hover or keyboard focus; shown here for the picture.</span>
  </div>
</div>

<script>
  /*
   * Callouts, measured rather than hard-coded.
   *
   * Every arrow starts from a getBoundingClientRect() of the element it points
   * at, so a change to where the slot sits moves the arrow instead of leaving a
   * picture that claims the old position.
   */
  const stage = document.querySelector('.stage');
  const stageRect = stage.getBoundingClientRect();

  const annotate = ({ target, side, title, text, box }) => {
    if (!target) throw new Error('nothing to annotate: ' + title);
    const rect = target.getBoundingClientRect();
    const top = rect.top - stageRect.top;
    const left = rect.left - stageRect.left;
    const midY = top + rect.height / 2;

    const ring = document.createElement('div');
    ring.className = box ? 'ring ring--box' : 'ring';
    ring.style.cssText =
      'top:' + (top - 5) + 'px;left:' + (left - 5) + 'px;' +
      'width:' + (rect.width + 10) + 'px;height:' + (rect.height + 10) + 'px;';
    stage.appendChild(ring);

    const note = document.createElement('div');
    note.className = 'note';
    note.innerHTML = '<b>' + title + '</b><span>' + text + '</span>';
    stage.appendChild(note);

    /*
     * Notes live in the gutters beside the panel, never over it. The slot on a
     * "mine" row sits well inside the panel, so a note placed a fixed distance
     * from it would land on somebody's bubble — the one thing a picture
     * explaining the layout must not do. The wire takes up the varying
     * distance instead.
     */
    const noteRect = note.getBoundingClientRect();
    const margin = 4;
    const noteLeft = side === 'right' ? stageRect.width - noteRect.width - margin : margin;
    note.style.top = Math.max(0, midY - noteRect.height / 2) + 'px';
    note.style.left = noteLeft + 'px';

    const wire = document.createElement('div');
    wire.className = 'wire';
    const from = side === 'right' ? left + rect.width + 6 : noteLeft + noteRect.width + 6;
    const to = side === 'right' ? noteLeft - 6 : left - 6;
    wire.style.cssText = 'top:' + midY + 'px;left:' + from + 'px;width:' + (to - from) + 'px;';
    stage.appendChild(wire);
  };

  const rows = [...document.querySelectorAll('.sec-row')];
  const theirs = rows.find((row) => row.classList.contains('sec-row--theirs'));
  const mine = rows.find((row) => row.classList.contains('sec-row--mine'));

  annotate({
    target: theirs.querySelector('.sec-actions'),
    side: 'right',
    title: 'renderActions(message)',
    text: 'Outside the bubble, at the row’s outer edge. Return anything — a star, a menu, an AI re-run.',
  });

  annotate({
    target: mine.querySelector('.sec-actions'),
    side: 'left',
    title: '…mirrored on your own',
    text: 'The slot follows the row, so it is never over the text on either side.',
  });

  annotate({
    target: document.querySelector('.demo-reply'),
    side: 'right',
    box: true,
    title: 'renderFooter(message)',
    text: 'Inside the column, under the body: an inline reply, a translation notice.',
  });
</script>
`;

mkdirSync(OUT_DIR, { recursive: true });
const { shoot, cleanup } = createShooter();

console.log('rendering render-slots.png…');
await shoot(page, { ...SIZE, out: join(OUT_DIR, 'render-slots.png') });
cleanup();
console.log(`done -> ${join(OUT_DIR, 'render-slots.png')}`);
