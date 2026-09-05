/**
 * Engine for {@link AutomatedSignal} — score a message and return a verdict.
 *
 * Separate from the signal list so the two can move independently: adding an
 * ESP domain or a header check touches only `signals.ts`, and this file's
 * behaviour (normalize once, sum weights, compare to a threshold) never needs
 * to change for it.
 */
import type {
  AutomatedSignal,
  MailClassification,
  MailClassificationInput,
  NormalizedInput,
} from './signals.js';
import { AUTOMATED_THRESHOLD, automatedSignals } from './signals.js';

/** Options for {@link classifyMail}. */
export interface ClassifyMailOptions {
  /** Replaces the default signal set entirely. Compose it from the exported signals. */
  signals?: readonly AutomatedSignal[];
  /** Score at which the verdict flips. Defaults to {@link AUTOMATED_THRESHOLD}. */
  threshold?: number;
}

/** Lowercase every header key so a signal can look one up without guessing case. */
function normalizeHeaders(
  headers: MailClassificationInput['headers'],
): Record<string, string | undefined> {
  if (!headers) return {};
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

/** Normalize once, so N signals do not each re-lowercase the same body. */
function normalizeInput(input: MailClassificationInput): NormalizedInput {
  return {
    body: input.body ?? '',
    messageId: (input.messageId ?? '').trim(),
    fromAddress: (input.fromAddress ?? '').trim().toLowerCase(),
    headers: normalizeHeaders(input.headers),
  };
}

/**
 * Decide whether a message is a human conversation turn or machine-generated.
 *
 * A signal that throws is skipped rather than allowed to fail the call: a
 * third-party signal with a bad regex must not be able to stop a message from
 * rendering. Everything here is advisory — the worst outcome of getting it
 * wrong should be a bubble styled the other way.
 */
export function classifyMail(
  input: MailClassificationInput,
  options: ClassifyMailOptions = {},
): MailClassification {
  const signals = options.signals ?? automatedSignals;
  const threshold = options.threshold ?? AUTOMATED_THRESHOLD;
  const normalized = normalizeInput(input);

  const fired: string[] = [];
  let score = 0;

  for (const signal of signals) {
    let hit = false;
    try {
      hit = signal.test(normalized);
    } catch {
      continue;
    }
    if (!hit) continue;
    fired.push(signal.name);
    score += signal.weight;
  }

  return {
    kind: score >= threshold ? 'automated' : 'human',
    score,
    signals: fired,
  };
}

/**
 * Convenience predicate: is this a message worth chat treatment?
 *
 * The inverse of "automated", named for how it is actually used at the call
 * site — `if (isConversational(mail))` reads better than a negation.
 */
export function isConversational(
  input: MailClassificationInput,
  options?: ClassifyMailOptions,
): boolean {
  return classifyMail(input, options).kind === 'human';
}
