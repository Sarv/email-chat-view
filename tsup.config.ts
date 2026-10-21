import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      // Separate entry so a consumer who only wants the email -> chat DATA
      // transform (a server-side pipeline, a CLI, a non-React UI) never pulls
      // React or any component code into their bundle.
      transform: 'src/transform.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    external: ['react', 'react-dom'],
    // `pretty-bytes` is ESM-only, so leaving it external would emit a
    // `require('pretty-bytes')` into the CJS build that throws at load time in
    // any CommonJS consumer. It is ~1 KB with no dependencies of its own, so it
    // is bundled into both formats instead — which is also why it sits in
    // devDependencies: it ships inside `dist`, not in the consumer's tree.
    noExternal: ['pretty-bytes'],
  },
  {
    // The stylesheet, built by the bundler that is already here rather than by
    // Tailwind. Tailwind generates CSS by scanning source for class names,
    // which cannot work for components that ship pre-built in `dist/`, and its
    // preflight reset would leak into the consumer's app. See the header of
    // src/styles/index.css.
    //
    // Its own config object because a CSS entry has no ESM/CJS distinction —
    // built once, not once per JS format. `clean` stays off so it does not wipe
    // the JS build that ran first.
    entry: { style: 'src/styles/index.css' },
    minify: true,
    clean: false,
  },
  {
    // The mobile bundle: React, the view and the transform in ONE script with
    // no imports, which `scripts/mobile/build-html.mjs` inlines into the page
    // the iOS and Android wrappers load. IIFE because a WebView page loaded
    // from a file has no module resolution to speak of, and everything is
    // bundled because there is no `node_modules` on a phone.
    entry: { 'email-chat-view': 'src/mobile/entry.ts' },
    outDir: 'dist/mobile',
    format: ['iife'],
    platform: 'browser',
    // The oldest engines the wrappers support: iOS 15's WKWebView and an
    // Android System WebView of Chromium 90. esbuild lowers what it can for
    // them and FAILS the build on syntax it cannot (a regex lookbehind, say,
    // which would stop the whole page parsing on iOS 15).
    target: ['safari15', 'chrome90'],
    noExternal: [/.*/],
    env: { NODE_ENV: 'production' },
    minify: true,
    clean: false,
  },
]);
