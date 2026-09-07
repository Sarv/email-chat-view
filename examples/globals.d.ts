/**
 * Ambient declarations for the examples.
 *
 * `@sarv-in/email-chat-view/style.css` is a side-effect import with nothing to import
 * FROM, and TypeScript has no idea what a stylesheet is. Declaring the module
 * lets the example keep the line a real consumer writes, rather than dropping
 * it and quietly teaching people to forget the stylesheet.
 *
 * Your own app almost certainly already has this, via a bundler's client types
 * (`vite/client`, `next-env.d.ts`, a webpack `*.css` declaration).
 */
declare module '@sarv-in/email-chat-view/style.css';
