import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Deliberately `node`, not `jsdom`: the transform layer must never depend
    // on an ambient browser DOM. Tests pass linkedom in explicitly, which is
    // the same thing a server-side consumer has to do — so this config is what
    // proves the Node story actually works.
    //
    // Component tests opt INTO jsdom individually, with a
    // `// @vitest-environment jsdom` docblock. Per-file rather than by glob so
    // the default stays meaningful: a transform test can never quietly start
    // depending on an ambient `DOMParser` that a server-side consumer lacks.
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    setupFiles: ['test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**'],
      // Barrels re-export and nothing else; `transform.ts`, `view.ts` and
      // `index.ts` are pure `export` lines, so counting them inflates the
      // number without testing anything.
      exclude: ['src/index.ts', 'src/transform.ts', 'src/view.ts', 'src/styles/**'],
      // Enforced, not aspirational. Every rule in this package can silently
      // delete part of somebody's email, so an untested branch is not a
      // cosmetic gap — CI must fail on it, or coverage decays with the first
      // contribution that adds a rule without a fixture.
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
