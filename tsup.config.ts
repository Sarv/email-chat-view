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
]);
