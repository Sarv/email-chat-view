import { describe, expect, it } from 'vitest';

import { DEFAULT_LABELS, fillTemplate, resolveLabels } from '../../src/ui/labels.js';

describe('fillTemplate', () => {
  // Regression: `Show {count} earlier messages` rendering with the brace still
  // in it — the placeholder has to be substituted, not just found.
  it('substitutes a named placeholder', () => {
    expect(fillTemplate('Show {count} earlier messages', { count: 12 })).toBe(
      'Show 12 earlier messages',
    );
  });

  // Regression: a translator writing `{count} of {count}` getting only the
  // first one filled, because a single `replace` stops after one match.
  it('substitutes every occurrence of the same placeholder', () => {
    expect(fillTemplate('{count} of {count}', { count: 3 })).toBe('3 of 3');
  });

  it('accepts strings as well as numbers', () => {
    expect(fillTemplate('{who} replied', { who: 'Alice' })).toBe('Alice replied');
  });

  // Regression: a mistranslation that drops a placeholder must degrade to
  // visible text, never to a crash or a silently empty label.
  it('leaves an unknown placeholder alone', () => {
    expect(fillTemplate('{count} of {total}', { count: 2 })).toBe('2 of {total}');
  });

  // Regression: the reason this is a split/join over the VALUES and not a regex
  // over the template — a stray brace in a translated string is inert here and
  // would be a syntax hazard in a pattern.
  it('does not choke on an unbalanced brace', () => {
    expect(fillTemplate('a { b {count}', { count: 1 })).toBe('a { b 1');
  });

  it('returns the template untouched when there is nothing to fill', () => {
    expect(fillTemplate('No messages', {})).toBe('No messages');
  });
});

describe('resolveLabels', () => {
  // Regression: allocating a fresh label object per render defeats the memo in
  // MailChatView that keys the day grouping off label identity.
  it('hands back the shared defaults when nothing is overridden', () => {
    expect(resolveLabels()).toBe(DEFAULT_LABELS);
    expect(resolveLabels(undefined)).toBe(DEFAULT_LABELS);
  });

  // Regression: a consumer overriding one string and losing the other twenty.
  it('merges a partial override onto the defaults', () => {
    const labels = resolveLabels({ today: 'Aujourd’hui' });
    expect(labels.today).toBe('Aujourd’hui');
    expect(labels.yesterday).toBe(DEFAULT_LABELS.yesterday);
  });
});
