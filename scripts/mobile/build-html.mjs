/**
 * Builds the single HTML page the iOS and Android wrappers load, and the
 * native data bundle (`email-chat-core.js`) beside it.
 *
 *     pnpm build:mobile
 *
 * Inlines the mobile bundle (`dist/mobile/email-chat-view.global.js`) and the
 * shipped stylesheet (`dist/style.css`) into one file with no external
 * references, so a WebView can load it from the app bundle with no network,
 * no asset server and no base-URL games.
 *
 * Written to ONE place, inside the Swift package, because SwiftPM can only
 * bundle a resource that lives under its target and is committed to git (it
 * never runs npm). The Android module points its assets at the same folder, so
 * the two apps can never ship different builds of the page.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(
  ROOT,
  'mobile',
  'ios',
  'Sources',
  'EmailChatView',
  'Resources',
  'email-chat-view.html',
);

const script = readFileSync(join(ROOT, 'dist', 'mobile', 'email-chat-view.global.js'), 'utf8');
const stylesheet = readFileSync(join(ROOT, 'dist', 'style.css'), 'utf8');

/*
 * The page itself is a full-height scroller and nothing else: `.sec-thread`
 * scrolls itself (its visible-range observer uses it as the root), so it has
 * to be given the viewport's height. The bottom inset keeps the last bubble
 * clear of the home indicator when native lays the WebView edge to edge.
 */
const PAGE_CSS = `
html, body, #root { height: 100%; margin: 0; }
body { background: var(--sec-surface); -webkit-text-size-adjust: 100%; }
#root > .sec-thread {
  height: 100%;
  box-sizing: border-box;
  padding-bottom: calc(var(--sec-pad) + env(safe-area-inset-bottom));
}`;

/** `</script` anywhere in the bundle would end the inline script early. */
const inlineSafe = (source) => source.replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>email-chat-view</title>
<style>${stylesheet}${PAGE_CSS}</style>
</head>
<body>
<div id="root"></div>
<script>${inlineSafe(script)}</script>
</body>
</html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT.slice(ROOT.length + 1)} (${(html.length / 1024).toFixed(0)} KB)`);

/*
 * The native data bundle (`EmailChatCore` in Swift and Kotlin) ships beside the
 * page, as plain script: a bare JavaScript engine evaluates source, not HTML.
 */
const CORE_OUT = join(dirname(OUT), 'email-chat-core.js');
const core = readFileSync(join(ROOT, 'dist', 'mobile', 'email-chat-core.global.js'), 'utf8');
writeFileSync(CORE_OUT, core);
console.log(`wrote ${CORE_OUT.slice(ROOT.length + 1)} (${(core.length / 1024).toFixed(0)} KB)`);
