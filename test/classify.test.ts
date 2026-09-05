import { describe, expect, it } from 'vitest';

import { classifyMail, isConversational } from '../src/classify/classify-mail.js';
import {
  AUTOMATED_THRESHOLD,
  automatedSignals,
  ESP_MESSAGE_ID_DOMAINS,
  hasEspMessageIdDomain,
} from '../src/classify/signals.js';

/** A plain human reply, with nothing machine-like about it. */
const HUMAN_REPLY = {
  body: '<div dir="ltr">Tuesday works for me — see you then.</div>',
  messageId: '<CAF=abc123@mail.gmail.com>',
  fromAddress: 'alice@example.com',
};

describe('hasEspMessageIdDomain', () => {
  // Regression: a human client's Message-ID comes from its own mail host. If
  // this matched Gmail's, every conversation would be classified as bulk.
  it('does not match an ordinary mail host', () => {
    expect(hasEspMessageIdDomain('<CAF=abc@mail.gmail.com>')).toBe(false);
    expect(hasEspMessageIdDomain('<abc@outlook.office365.com>')).toBe(false);
  });

  it('matches a known ESP domain exactly', () => {
    expect(hasEspMessageIdDomain('<01000190@amazonses.com>')).toBe(true);
  });

  // Regression: ESPs send from per-tenant subdomains far more often than from
  // the bare domain, so a suffix match is the useful one.
  it('matches a subdomain of a known ESP', () => {
    expect(hasEspMessageIdDomain('<x@bounces.sendgrid.net>')).toBe(true);
  });

  // Regression: the trailing `>` is part of the RFC syntax and must be trimmed,
  // or every well-formed Message-ID fails to match.
  it('tolerates the RFC angle brackets and surrounding whitespace', () => {
    expect(hasEspMessageIdDomain('  <x@amazonses.com>  ')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(hasEspMessageIdDomain('<x@AmazonSES.COM>')).toBe(true);
  });

  // Regression: a Message-ID with no `@`, or nothing after it, must not throw
  // or match — malformed ids are common in the wild.
  it('rejects a malformed Message-ID', () => {
    expect(hasEspMessageIdDomain('no-at-sign')).toBe(false);
    expect(hasEspMessageIdDomain('trailing@')).toBe(false);
    expect(hasEspMessageIdDomain('')).toBe(false);
  });

  // Regression: the list is the primary contribution surface. If it were empty
  // or unexported, the easiest possible contribution would be impossible.
  it('exposes a non-empty ESP list', () => {
    expect(ESP_MESSAGE_ID_DOMAINS.length).toBeGreaterThan(10);
  });
});

describe('classifyMail', () => {
  // Regression: the default must be "human". A false "automated" strips chat
  // treatment from a real conversation, which is the visible failure.
  it('calls an ordinary reply human', () => {
    expect(classifyMail(HUMAN_REPLY)).toEqual({ kind: 'human', score: 0, signals: [] });
    expect(isConversational(HUMAN_REPLY)).toBe(true);
  });

  it('treats a message with nothing supplied as human', () => {
    expect(classifyMail({}).kind).toBe('human');
  });

  // Regression: header signals are the gold standard — a sender declaring
  // itself bulk is not a heuristic, it is the sender telling you. Each must
  // decide on its own.
  it.each([
    ['List-Unsubscribe', { 'list-unsubscribe': '<https://x/u>' }, 'list-unsubscribe-header'],
    ['Auto-Submitted', { 'auto-submitted': 'auto-generated' }, 'auto-submitted-header'],
    ['Precedence: bulk', { precedence: 'bulk' }, 'bulk-precedence-header'],
    ['Precedence: list', { precedence: 'list' }, 'bulk-precedence-header'],
    ['Precedence: junk', { precedence: 'junk' }, 'bulk-precedence-header'],
  ])('flags %s on its own', (_label, headers, signal) => {
    const result = classifyMail({ ...HUMAN_REPLY, headers });
    expect(result.kind).toBe('automated');
    expect(result.signals).toContain(signal);
  });

  // Regression: RFC 3834 says `Auto-Submitted: no` is what a normal message
  // sets. Reading "the header exists" as automation would flag well-behaved
  // human mail — the exact opposite of the header's purpose.
  it('does not flag Auto-Submitted: no', () => {
    expect(classifyMail({ ...HUMAN_REPLY, headers: { 'auto-submitted': ' No ' } }).kind).toBe(
      'human',
    );
  });

  it('ignores an empty Auto-Submitted or Precedence value', () => {
    expect(classifyMail({ ...HUMAN_REPLY, headers: { 'auto-submitted': '  ' } }).kind).toBe(
      'human',
    );
    expect(classifyMail({ ...HUMAN_REPLY, headers: { precedence: 'first-class' } }).kind).toBe(
      'human',
    );
  });

  // Regression: header names are case-insensitive per RFC 5322, and stores
  // preserve whatever case the sender used. A signal looking up the lowercase
  // key must still find `List-Unsubscribe`.
  it('looks headers up case-insensitively', () => {
    const result = classifyMail({ ...HUMAN_REPLY, headers: { 'List-Unsubscribe': '<x>' } });
    expect(result.signals).toContain('list-unsubscribe-header');
  });

  it.each([
    ['1x1 pixel by attributes', '<img src="https://t/x" width="1" height="1">'],
    ['1x1 pixel, height first', '<img src="https://t/x" height="1" width="1">'],
    ['1x1 pixel by inline style', '<img src="https://t/x" style="width:1px;height:1px">'],
  ])('flags a tracking pixel (%s) on its own', (_label, body) => {
    const result = classifyMail({ ...HUMAN_REPLY, body });
    expect(result.kind).toBe('automated');
    expect(result.signals).toContain('tracking-pixel');
  });

  it('does not flag an ordinary inline image', () => {
    expect(
      classifyMail({ ...HUMAN_REPLY, body: '<img src="cid:logo" width="120" height="40">' }).kind,
    ).toBe('human');
  });

  // Regression: a leaked merge tag proves a template engine produced the
  // message. No human types `{{first_name}}` into a reply.
  it.each([
    ['handlebars', 'Hi {{ first_name }},'],
    ['percent tokens', 'Hi %FIRST_NAME%,'],
    ['bracket tokens', 'Hi [FIRST_NAME],'],
  ])('flags an unrendered %s placeholder on its own', (_label, body) => {
    const result = classifyMail({ ...HUMAN_REPLY, body });
    expect(result.kind).toBe('automated');
    expect(result.signals).toContain('unrendered-placeholder');
  });

  it('flags an ESP Message-ID on its own', () => {
    const result = classifyMail({ ...HUMAN_REPLY, messageId: '<x@bounces.sendgrid.net>' });
    expect(result.kind).toBe('automated');
    expect(result.signals).toContain('esp-message-id');
  });

  it.each([
    'no-reply@example.com',
    'noreply@example.com',
    'donotreply@example.com',
    'do-not-reply@example.com',
    'mailer-daemon@example.com',
    'postmaster@example.com',
    'notifications@example.com',
    'system@example.com',
  ])('flags %s as a non-conversational sender', (fromAddress) => {
    const result = classifyMail({ ...HUMAN_REPLY, fromAddress });
    expect(result.kind).toBe('automated');
    expect(result.signals).toContain('noreply-sender');
  });

  it('is case-insensitive about the sender', () => {
    expect(classifyMail({ ...HUMAN_REPLY, fromAddress: 'No-Reply@Example.com' }).kind).toBe(
      'automated',
    );
  });

  // Regression: THE reason signals are weighted. A corporate footer often says
  // "unsubscribe", and flagging a genuine reply because of its footer would be
  // the most common misclassification of all. It must need corroboration.
  it('does not flag unsubscribe copy on its own', () => {
    const result = classifyMail({
      ...HUMAN_REPLY,
      body: '<p>Sure, Tuesday works.</p><p>To unsubscribe from these updates, click here.</p>',
    });

    expect(result.kind).toBe('human');
    expect(result.score).toBe(2);
    expect(result.signals).toEqual(['unsubscribe-copy']);
  });

  // Regression: two weak signals together do reach the threshold, which is what
  // "weighted" is for — neither alone is proof, both together are.
  it('flags unsubscribe copy once it is corroborated', () => {
    const result = classifyMail({
      ...HUMAN_REPLY,
      body: '<p>Our weekly digest. <a href="#">Unsubscribe</a></p><img src="t" width="1" height="1">',
    });

    expect(result.kind).toBe('automated');
    expect(result.signals).toEqual(['tracking-pixel', 'unsubscribe-copy']);
    expect(result.score).toBe(5);
  });

  // Regression: score accumulates across signals, and the verdict is a simple
  // comparison against the threshold. Stated so a contributor can reason about
  // what weight to give a new signal.
  it('accumulates weights and flips at the threshold', () => {
    expect(AUTOMATED_THRESHOLD).toBe(3);

    const below = classifyMail({ body: 'x' }, { signals: [], threshold: 1 });
    expect(below).toEqual({ kind: 'human', score: 0, signals: [] });

    const custom = classifyMail(
      { body: 'x' },
      {
        signals: [
          { name: 'a', weight: 1, rationale: '', test: () => true },
          { name: 'b', weight: 1, rationale: '', test: () => true },
        ],
        threshold: 2,
      },
    );
    expect(custom).toEqual({ kind: 'automated', score: 2, signals: ['a', 'b'] });
  });

  // Regression: everything here is advisory — the worst outcome of getting it
  // wrong should be a bubble styled the other way. A third-party signal with a
  // bad regex must not be able to stop a message from rendering.
  it('skips a signal that throws instead of failing the call', () => {
    const result = classifyMail(HUMAN_REPLY, {
      signals: [
        {
          name: 'broken',
          weight: 3,
          rationale: '',
          test: () => {
            throw new Error('bad signal');
          },
        },
        { name: 'fine', weight: 3, rationale: '', test: () => true },
      ],
    });

    expect(result.signals).toEqual(['fine']);
    expect(result.kind).toBe('automated');
  });

  // Regression: every shipped signal must be documented and weighted sanely.
  // A weight of 3+ decides alone, so an under-justified one silently
  // misclassifies real mail.
  it('ships signals that are all named, weighted and justified', () => {
    for (const signal of automatedSignals) {
      expect(signal.name).toMatch(/^[a-z0-9-]+$/);
      expect(signal.weight).toBeGreaterThan(0);
      expect(signal.rationale.length).toBeGreaterThan(20);
    }
    expect(new Set(automatedSignals.map((signal) => signal.name)).size).toBe(
      automatedSignals.length,
    );
  });

  // Regression: a real bulk send hits several signals at once. This is the
  // end-to-end shape, and `signals` is the tuning record.
  it('flags a realistic marketing send with multiple signals', () => {
    const result = classifyMail({
      body: '<p>Hi {{first_name}}, our news!</p><a href="#">Unsubscribe</a><img src="t" width="1" height="1">',
      messageId: '<abc@mail123.mcsv.net>',
      fromAddress: 'news@brand.example',
      headers: { 'List-Unsubscribe': '<mailto:u@brand.example>', Precedence: 'bulk' },
    });

    expect(result.kind).toBe('automated');
    expect(result.signals).toEqual([
      'list-unsubscribe-header',
      'bulk-precedence-header',
      'tracking-pixel',
      'unrendered-placeholder',
      'esp-message-id',
      'unsubscribe-copy',
    ]);
    expect(isConversational({ body: result.signals.join() })).toBe(true);
  });

  it('treats null body, messageId and fromAddress as absent', () => {
    expect(classifyMail({ body: null, messageId: null, fromAddress: null })).toEqual({
      kind: 'human',
      score: 0,
      signals: [],
    });
  });
});
