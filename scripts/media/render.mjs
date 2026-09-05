/**
 * Generates the README media from the real component.
 *
 *     pnpm build && node scripts/media/render.mjs
 *
 * Nothing here is a mockup: the chat side is `MailChatView` rendered from
 * `dist/`, styled by the shipped `dist/style.css`, fed by the real transform.
 * The raw side is the same `mails` array with nothing done to it. So the
 * picture cannot drift from the package — if a bubble changes, regenerating
 * changes the picture too.
 *
 * How it works, and why this way: the components are rendered to static markup
 * under a jsdom global (DOMPurify needs a `window`, so a bare Node render
 * sanitizes every body down to nothing), written to a standalone HTML file with
 * the stylesheet inlined, and screenshotted by headless Chrome. The GIF is a
 * handful of those screenshots with per-frame durations, assembled by ffmpeg.
 * That is why there is no Playwright and no bundler in this pipeline.
 *
 * Requires: a built `dist/`, Google Chrome, and ffmpeg (GIF only).
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JSDOM } from 'jsdom';

import { mails, ME, NOW } from './thread.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT_DIR = join(ROOT, 'docs', 'media');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/**
 * jsdom globals BEFORE the package is imported.
 *
 * The sanitizer resolves DOMPurify against `window` at module load; without one
 * every body sanitizes to empty and the bubbles render "no new content".
 */
const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.Node = dom.window.Node;

const React = (await import('react')).default;
const { renderToStaticMarkup } = await import('react-dom/server');
const { MailChatView, mailsToMessages } = await import('../../dist/index.js');

const messages = mailsToMessages(mails, { currentUserAddress: ME, dateUnit: 's' });

const STYLESHEET = readFileSync(join(ROOT, 'dist', 'style.css'), 'utf8');
/*
 * The lockup — mark and word — from one file, so the watermark is the brand
 * asset rather than something reassembled in this page's markup. The baked-in
 * `width`/`height` come off because an SVG's own attributes win over CSS, and
 * the size belongs to the layout below.
 */
const LOGO = readFileSync(join(OUT_DIR, 'sarv-logo.svg'), 'utf8')
  .replace(/<\?xml[^>]*\?>/, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\s(?:width|height)="[^"]*"/, '')
  .replace('<svg', '<svg class="brand__logo"');

/** The chat side: the actual component, actual transform output. */
const chatMarkup = renderToStaticMarkup(
  React.createElement(MailChatView, {
    messages,
    currentUserAddress: ME,
    now: NOW,
    locale: 'en-GB',
    onDownloadAttachment: () => {},
  }),
);

/**
 * Every rule that fired, as a chip next to the block it removed.
 *
 * Read off `applied` rather than hard-coded, so the labels in the picture are
 * the labels the library actually reports.
 */
const appliedByFamily = (family) => {
  const names = messages.flatMap((message) =>
    (message.applied ?? []).filter((rule) => rule.startsWith(`${family}:`)),
  );
  return names[0] ?? '';
};

const CHIPS = {
  signature: appliedByFamily('signature'),
  quote: appliedByFamily('quote'),
  disclaimer: appliedByFamily('disclaimer'),
};

/** The raw side: the same mails, untouched, in a plain mail-client frame. */
const rawMarkup = mails
  .map((mail) => {
    const who = mail.fromName ?? mail.fromAddress;
    const when = new Date(mail.date * 1000).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    });
    return `
      <article class="raw-mail">
        <header class="raw-mail__head">
          <span class="raw-mail__from">${who}</span>
          <span class="raw-mail__to">to ${mail.toNames ?? mail.toAddress}</span>
          <span class="raw-mail__when">${when}</span>
        </header>
        <div class="raw-mail__body">${mail.body}</div>
      </article>`;
  })
  .join('');

/**
 * One frame / screenshot.
 *
 * `vars` drives the whole animation: the raw side collapses its stripped blocks
 * (`--strip`), the chat side fades up (`--chat`). Static screenshots are just
 * the end states of the same template, so the two can never disagree.
 */
const page = ({ vars, caption, layout = 'stage', width, height }) => `
<!doctype html>
<meta charset="utf-8">
<style>
${STYLESHEET}

:root {
  --demo-ink: #0b1530;
  --demo-muted: #6b7691;
  --demo-line: #e6e9f1;
  --demo-brand: #3069b0;
  --demo-danger: #d94a4a;
  --strip: ${vars.strip ?? 1};
  --hl: ${vars.hl ?? 0};
  --chat: ${vars.chat ?? 0};
  --raw: ${vars.raw ?? 1};
}

* { box-sizing: border-box; }
body {
  margin: 0;
  width: ${width}px;
  height: ${height}px;
  overflow: hidden;
  background: #eef1f7;
  color: var(--demo-ink);
  font: 15px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif;
  -webkit-font-smoothing: antialiased;
}

.shell { display: flex; flex-direction: column; height: 100%; padding: 18px 20px 12px; }

.bar { display: flex; align-items: center; gap: 12px; padding-bottom: 12px; }
.bar__name { font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
.bar__tag { color: var(--demo-muted); font-size: 13px; }
.brand { margin-left: auto; display: flex; align-items: center; gap: 7px; opacity: 0.85; }
.brand__logo { height: 24px; width: auto; display: block; }

.caption {
  display: inline-flex; align-items: center; gap: 8px; align-self: flex-start;
  margin-bottom: 10px; padding: 5px 11px; border-radius: 999px;
  background: #fff; border: 1px solid var(--demo-line);
  font-size: 12.5px; font-weight: 600; color: var(--demo-muted);
}
.caption__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--demo-brand); }

.panels { position: relative; flex: 1; min-height: 0; }
.panel {
  position: absolute; inset: 0; background: #fff; border: 1px solid var(--demo-line);
  border-radius: 14px; overflow: hidden; box-shadow: 0 8px 24px rgba(11, 21, 48, 0.07);
}
.panel--raw { opacity: var(--raw); }
.panel--chat { opacity: var(--chat); }
.panel__scroll { height: 100%; overflow: hidden; padding: 14px 16px; }

/* ---- the raw mail side ---- */
.raw-mail { border-bottom: 1px solid var(--demo-line); padding: 12px 4px; }
.raw-mail:last-child { border-bottom: 0; }
.raw-mail__head { display: flex; gap: 10px; align-items: baseline; font-size: 13px; margin-bottom: 6px; }
.raw-mail__from { font-weight: 700; }
.raw-mail__to { color: var(--demo-muted); }
.raw-mail__when { margin-left: auto; color: var(--demo-muted); font-variant-numeric: tabular-nums; }
.raw-mail__body { font-size: 13.5px; color: #26314d; }
.raw-mail__body blockquote {
  margin: 6px 0 6px 8px; padding-left: 10px;
  border-left: 2px solid #c9d2e4; color: var(--demo-muted);
}
.raw-mail__body .gmail_attr { color: var(--demo-muted); font-size: 12.5px; }
.raw-mail__body .demo-legal { font-size: 11.5px; color: #7c869c; }

/* The three families, highlighted then collapsed — this is what the library removes. */
.gmail_signature, .gmail_quote, .demo-legal {
  position: relative;
  max-height: calc(var(--strip) * 340px);
  opacity: calc(0.35 + var(--strip) * 0.65);
  overflow: hidden;
  border-radius: 8px;
  background: rgba(217, 74, 74, calc(var(--hl) * 0.09));
  box-shadow: inset 0 0 0 calc(var(--hl) * 1px) rgba(217, 74, 74, 0.45);
  transition: none;
}
.gmail_signature::after, .gmail_quote::after, .demo-legal::after {
  content: attr(data-rule);
  position: absolute; top: 4px; right: 6px;
  padding: 1px 7px; border-radius: 999px;
  background: var(--demo-danger); color: #fff;
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.02em;
  opacity: var(--hl);
}

/* ---- the chat side ---- */
.panel--chat .sec-thread { height: 100%; }

/* ---- side-by-side, for the still ---- */
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; flex: 1; min-height: 0; }
.split .panels { position: relative; }
.split .panel { position: absolute; }
.split-head {
  display: grid; grid-template-columns: 1fr 1fr; gap: 16px;
  font-size: 12.5px; font-weight: 700; color: var(--demo-muted); padding-bottom: 8px;
}
.split-head span { display: flex; align-items: center; gap: 7px; }
.split-head .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--demo-danger); }
.split-head .dot--ok { background: #2e9e6b; }
.fade-bottom::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 56px;
  background: linear-gradient(to bottom, rgba(255,255,255,0), #fff);
}

.foot {
  display: flex; align-items: center; gap: 8px;
  padding-top: 10px; font-size: 11.5px; color: var(--demo-muted);
}
.foot__spacer { margin-left: auto; }
</style>

<div class="shell">
  <div class="bar">
    <span class="bar__name">email-chat-view</span>
    <span class="bar__tag">an email thread, read as a conversation</span>
    <span class="brand">${LOGO}</span>
  </div>

  ${
    layout === 'split'
      ? `<div class="split-head">
           <span><i class="dot"></i>The thread as it arrives</span>
           <span><i class="dot dot--ok"></i>The same thread, as a chat</span>
         </div>
         <div class="split">
           <div class="panels"><div class="panel panel--raw fade-bottom"><div class="panel__scroll">${rawMarkup}</div></div></div>
           <div class="panels"><div class="panel panel--chat"><div class="panel__scroll">${chatMarkup}</div></div></div>
         </div>`
      : `<span class="caption"><i class="caption__dot"></i>${caption}</span>
         <div class="panels">
           <div class="panel panel--raw fade-bottom"><div class="panel__scroll">${rawMarkup}</div></div>
           <div class="panel panel--chat"><div class="panel__scroll">${chatMarkup}</div></div>
         </div>`
  }

  <div class="foot">
    <span>Quoted history, signatures and legal footers removed by rule — every removal is reported.</span>
    <span class="foot__spacer">Demo thread by Ankur Dubey · Sarv</span>
  </div>
</div>

<script>
  // Label each removed block with the rule that actually removed it.
  const rules = ${JSON.stringify(CHIPS)};
  for (const [selector, rule] of [
    ['.gmail_signature', rules.signature],
    ['.gmail_quote', rules.quote],
    ['.demo-legal', rules.disclaimer],
  ]) {
    document.querySelectorAll(selector).forEach((el) => el.setAttribute('data-rule', rule));
  }
</script>
`;

/** One headless-Chrome screenshot. Its own profile dir, never the user's. */
const profile = mkdtempSync(join(tmpdir(), 'ecv-media-'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sizeOf = (path) => statSync(path, { throwIfNoEntry: false })?.size ?? 0;

/**
 * Chrome's new headless mode writes the PNG and then, on macOS, frequently does
 * not exit — `execFileSync` waits for a process that never leaves. So: spawn it,
 * wait for the file to appear AND stop growing, then kill it. That is also
 * faster than a fixed timeout, because most frames land in a second or two.
 */
const shoot = async (html, { width, height, out }) => {
  rmSync(out, { force: true });
  const file = join(profile, 'frame.html');
  writeFileSync(file, html);

  const child = spawn(
    CHROME,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      /*
       * Force the light scheme. Headless Chrome inherits the MACHINE's
       * appearance setting, and the stylesheet has a real
       * `prefers-color-scheme: dark` block — so on a dark-mode Mac the capture
       * came out with dark-mode ink on the light demo panel and the message
       * text was unreadable. The library is fine either way (the identity wash
       * is translucent and sits on whatever surface is under it); it is the
       * PICTURE that must not depend on who regenerated it. `color-scheme:
       * light` on :root does not flip the media query in this build; this does.
       */
      '--blink-settings=preferredColorScheme=1',
      `--user-data-dir=${profile}`,
      // 2x, then downscaled by ffmpeg / kept as a retina still: text stays crisp.
      '--force-device-scale-factor=2',
      `--window-size=${width},${height}`,
      '--virtual-time-budget=1500',
      `--screenshot=${out}`,
      `file://${file}`,
    ],
    { stdio: 'ignore' },
  );

  try {
    for (let waited = 0; waited < 30_000; waited += 200) {
      await sleep(200);
      const size = sizeOf(out);
      if (size === 0) continue;
      await sleep(300);
      if (sizeOf(out) === size) return;
    }
    throw new Error(`screenshot never settled: ${out}`);
  } finally {
    child.kill('SIGKILL');
  }
};

const GIF_SIZE = { width: 960, height: 620 };

/**
 * The story, as frames: the thread arrives ugly, the rules are named, the
 * clutter collapses, the chat view is what is left.
 */
const storyboard = [
  { hold: 1.9, caption: 'The thread as your mail store hands it over', vars: { strip: 1, hl: 0, raw: 1, chat: 0 } },
  { hold: 1.7, caption: 'Each block is matched by a named rule', vars: { strip: 1, hl: 1, raw: 1, chat: 0 } },
  ...[0.82, 0.6, 0.4, 0.22, 0.08, 0].map((strip) => ({
    hold: 0.1,
    caption: 'Each block is matched by a named rule',
    vars: { strip, hl: 1, raw: 1, chat: 0 },
  })),
  /*
   * The cross-fade is deliberately NOT symmetrical: the raw side drops away
   * ahead of the chat side coming up. A straight 1-x / x fade puts both panels
   * near half opacity in the middle frames, and two full pages of text at 50%
   * on top of each other is unreadable mush — the frame that is meant to show
   * the change is the one nobody can read.
   */
  ...[
    { raw: 0.45, chat: 0.12 },
    { raw: 0.12, chat: 0.45 },
    { raw: 0, chat: 0.8 },
  ].map((vars) => ({
    hold: 0.1,
    caption: 'What is left is one turn per message',
    vars: { strip: 0, hl: 0, ...vars },
  })),
  { hold: 2.8, caption: 'What is left is one turn per message', vars: { strip: 0, hl: 0, raw: 0, chat: 1 } },
];

mkdirSync(OUT_DIR, { recursive: true });
const frameDir = mkdtempSync(join(tmpdir(), 'ecv-frames-'));

console.log(`rendering ${storyboard.length} frames…`);
const framePaths = [];
for (const [index, frame] of storyboard.entries()) {
  const out = join(frameDir, `f${String(index).padStart(3, '0')}.png`);
  await shoot(page({ ...frame, ...GIF_SIZE, layout: 'stage' }), { ...GIF_SIZE, out });
  framePaths.push(out);
  process.stdout.write(`  frame ${index + 1}/${storyboard.length}\r`);
}
process.stdout.write('\n');

// Variable per-frame delays, so the two holds read and the transition moves.
const concat = framePaths
  .map((path, index) => `file '${path}'\nduration ${storyboard[index].hold}`)
  .concat([`file '${framePaths.at(-1)}'`])
  .join('\n');
writeFileSync(join(frameDir, 'frames.txt'), concat);

const gif = join(OUT_DIR, 'thread-to-chat.gif');
console.log('assembling gif…');
execFileSync(
  'ffmpeg',
  [
    '-y', '-f', 'concat', '-safe', '0', '-i', join(frameDir, 'frames.txt'),
    '-filter_complex',
    `scale=${GIF_SIZE.width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3`,
    '-loop', '0', gif,
  ],
  { stdio: 'ignore' },
);

console.log('rendering stills…');
await shoot(
  page({
    vars: { strip: 0, hl: 0, raw: 0, chat: 1 },
    caption: 'One bubble per turn — quoted history, signatures and footers removed',
    width: 1040,
    height: 660,
  }),
  { width: 1040, height: 660, out: join(OUT_DIR, 'chat-view.png') },
);

await shoot(
  page({ vars: { strip: 1, hl: 0, raw: 1, chat: 1 }, layout: 'split', width: 1360, height: 720 }),
  { width: 1360, height: 720, out: join(OUT_DIR, 'before-after.png') },
);

rmSync(frameDir, { recursive: true, force: true });
rmSync(profile, { recursive: true, force: true });
console.log(`done -> ${OUT_DIR}`);
