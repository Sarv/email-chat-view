/**
 * Headless-Chrome screenshots, shared by every media script.
 *
 * Extracted rather than copied: `render.mjs` and `actions.mjs` must produce
 * pixel-comparable images — same scale factor, same forced colour scheme, same
 * "has the file stopped growing?" wait. Two copies of that would drift, and the
 * drift would show up as two README pictures that do not look like the same
 * product.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sizeOf = (path) => statSync(path, { throwIfNoEntry: false })?.size ?? 0;

/**
 * A screenshotter with its own throwaway Chrome profile.
 *
 * Call `cleanup()` when done. The profile is never the user's — a media script
 * must not touch the browser somebody has open.
 */
export function createShooter() {
  const profile = mkdtempSync(join(tmpdir(), 'ecv-media-'));

  /**
   * One screenshot.
   *
   * Chrome's new headless mode writes the PNG and then, on macOS, frequently
   * does not exit — `execFileSync` would wait for a process that never leaves.
   * So: spawn it, wait for the file to appear AND stop growing, then kill it.
   * That is also faster than a fixed timeout, because most frames land in a
   * second or two.
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
         * `prefers-color-scheme: dark` block — so on a dark-mode Mac the
         * capture came out with dark-mode ink on the light demo panel and the
         * message text was unreadable. The library is fine either way (the
         * identity wash is translucent and sits on whatever surface is under
         * it); it is the PICTURE that must not depend on who regenerated it.
         * `color-scheme: light` on :root does not flip the media query in this
         * build; this does.
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

  /*
   * Retries, because SIGKILL is not synchronous: the profile directory is still
   * being flushed for a moment after the process is gone, and a `cleanup()`
   * called right after the last screenshot gets ENOTEMPTY. `rmSync` retries
   * exactly that class of error, so this is the fix rather than a sleep.
   */
  const cleanup = () =>
    rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });

  return { shoot, cleanup };
}
