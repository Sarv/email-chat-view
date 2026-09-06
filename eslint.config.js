// The house style, as rules rather than as prose.
//
// CONTRIBUTING.md used to say "there is no linter; match the surrounding code".
// That works until the first outside PR, at which point "match the surrounding
// code" is an unreviewable ask: a contributor cannot know that relative imports
// need a `.js` extension, or that an unbounded quantifier is a ReDoS in a mail
// body, until a reviewer tells them — which is late, personal, and easy to
// forget. Everything below is a rule the review would otherwise have to make by
// hand.
//
// Formatting is NOT here. Prettier owns it (`.prettierrc.json`), and
// `eslint-config-prettier` switches off every stylistic rule that would argue
// with it, so the two can never disagree about the same line.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import regexp from 'eslint-plugin-regexp';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Build output, coverage reports and the generated media. Nothing here is
    // hand-written, so linting it only produces noise.
    ignores: ['dist/**', 'coverage/**', 'docs/media/**', 'node_modules/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  regexp.configs['flat/recommended'],

  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      // The transform runs in Node AND in a browser, so both sets are in
      // scope. Which one a given module may actually touch is enforced by
      // types and by `resolveParser`, not by this list.
      globals: { ...globals.browser, ...globals.node },
    },
    settings: {
      'import-x/resolver': {
        typescript: { project: './tsconfig.json' },
      },
    },
    rules: {
      // --- ESM that actually resolves ------------------------------------
      //
      // The single rule most likely to catch an outside contributor. The
      // emitted ESM is consumed by Node with no bundler, so a relative import
      // without the `.js` extension resolves in the editor, type-checks
      // cleanly, builds without complaint, and then throws
      // ERR_MODULE_NOT_FOUND in somebody's app. It is invisible in review.
      'import-x/extensions': [
        'error',
        'ignorePackages',
        { ts: 'never', tsx: 'never', js: 'always', mjs: 'always' },
      ],

      // A cycle between two modules is the usual way a "layer" stops being one.
      'import-x/no-cycle': ['error', { maxDepth: Infinity }],
      'import-x/no-useless-path-segments': 'error',

      // Both off: they fire on packages whose OWN documented usage is a default
      // import that also carries same-named named exports — `DOMPurify`,
      // `typescript-eslint`, `eslint-plugin-import-x`. Following the advice
      // would break them, so the warning is pure noise.
      'import-x/no-named-as-default': 'off',
      'import-x/no-named-as-default-member': 'off',

      // Import order is bikeshed material, so it is settled here rather than in
      // review: built-ins, packages, then relatives, each group alphabetised
      // and separated by a blank line.
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],

      // --- Types -----------------------------------------------------------
      //
      // `verbatimModuleSyntax` is on, so a type imported without `import type`
      // survives into the emitted JS as a real import of a module that may
      // export nothing at runtime.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',

      // `any` erases the contract this package's whole value rests on. An
      // unavoidable one is an explicit, commented disable — not a default.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // --- Regex: the ReDoS rules -------------------------------------------
      //
      // "Bound every quantifier" has been in CONTRIBUTING.md since the first
      // commit. This is the machine that checks it. Mail bodies are the most
      // hostile input a client ever sees, and a 5 MB marketing email against a
      // super-linear pattern hangs the tab.
      //
      // A WARNING, not an error, and deliberately: turning the linter on found
      // an existing backlog of adjacent-quantifier cases (`\s+` beside `.+?` in
      // the attribution patterns, mostly) that are polynomial rather than
      // exponential. Each fix changes what a pattern matches, so each needs its
      // own fixtures and its own commit — which is not a thing to do while
      // adding a linter. `pnpm lint` runs with `--max-warnings` pinned at the
      // count that existed on the day it was adopted, so the backlog cannot
      // grow: a new one fails CI even though the old ones do not.
      'regexp/no-super-linear-backtracking': 'warn',
      'regexp/no-potentially-useless-backreference': 'error',
      'regexp/optimal-quantifier-concatenation': 'error',

      // `no-super-linear-move` is deliberately NOT enabled. It fires on a bare
      // `/\s+/`, which is every whitespace pattern in the package, and a rule
      // that flags correct code is a rule people learn to run with `--no-fix`.

      // --- Purity ------------------------------------------------------------
      //
      // A library that logs is a library that pollutes somebody else's console
      // and cannot be silenced. Report through a return value or a callback.
      'no-console': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-template': 'error',
      'object-shorthand': ['error', 'properties'],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // --- React ---------------------------------------------------------------
  {
    files: ['src/components/**/*.tsx', 'examples/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Exhaustive deps is an error, not a warning. A stale closure in a mail
      // client shows the previous thread's messages, which reads as data loss.
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  // --- Tests -----------------------------------------------------------------
  {
    files: ['test/**/*.{ts,tsx}'],
    rules: {
      // A fixture is markup a real client produced, and an assertion's throwaway
      // pattern never sees hostile input. Neither is the package's own regex
      // surface, which is what the ReDoS rules exist to protect.
      'regexp/no-super-linear-backtracking': 'off',
      // Reaching into a private shape to assert on it is what a unit test is
      // for, and a test's `any` cannot reach a consumer.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  // --- Runnable examples -----------------------------------------------------
  {
    files: ['examples/**', 'scripts/**'],
    rules: {
      // These are scripts, and the React examples stub out the host's IPC with
      // a `console.log` so the reader can see what the callback receives.
      // Printing IS the output here; the ban exists to keep the LIBRARY quiet.
      'no-console': 'off',
      // They import the BUILT `dist/` by package specifier, which does not
      // exist until `pnpm build` has run — so the resolver cannot see it.
      'import-x/no-unresolved': 'off',
    },
  },

  // Last, so it wins: turns off every rule Prettier would fight over.
  prettier,
);
