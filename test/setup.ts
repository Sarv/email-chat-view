/**
 * Shared test setup.
 *
 * Runs for BOTH environments, so everything here has to be a no-op under plain
 * Node (the transform tests) and only take effect under jsdom (the component
 * tests). `typeof document` is the discriminator.
 */
import { afterEach } from 'vitest';

afterEach(() => {
  // React Testing Library's own auto-cleanup only registers when its module has
  // been imported, which the transform tests never do. Clearing the body here
  // instead keeps component tests independent of each other without making
  // every test file import a DOM library.
  if (typeof document !== 'undefined') document.body.innerHTML = '';
});
