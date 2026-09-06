/**
 * Every string the view can render, in one place.
 *
 * Not because localisation is a feature we ship, but because a library that
 * hard-codes English into its components cannot be localised by the app that
 * embeds it — the strings are unreachable from outside. So they live here, as
 * plain data, and a consumer passes a partial override:
 *
 *     <MailChatView messages={messages} labels={{ today: 'Aujourd’hui' }} />
 *
 * Dates and times are NOT in here. Those go through `Intl` with the reader's
 * own locale, which gets the format, the month names and the 12/24-hour
 * convention right in every language without a translation table.
 */

/** Placeholder-carrying strings use `{count}`; see {@link fillTemplate}. */
export interface ViewLabels {
  /** Date separator for messages sent today. */
  today: string;
  /** Date separator for messages sent yesterday. */
  yesterday: string;
  /** Date separator for messages whose timestamp could not be read. */
  unknownDate: string;
  /** Tooltip prefix on a timestamp that was inferred rather than read. */
  approximateTime: string;
  /** Shown while a body is still being fetched. */
  bodyLoading: string;
  /** Shown when a body fetch failed permanently. */
  bodyFailed: string;
  /** Action on a failed body. */
  retry: string;
  /** A message that carried no content of its own (a bare forward or reply). */
  noContent: string;
  /** Button revealing messages held back by `maxRendered`. `{count}` available. */
  showEarlier: string;
  /** Button fetching an older page from the host. */
  loadOlder: string;
  /** Replaces {@link loadOlder} while the host's fetch is in flight. */
  loadingOlder: string;
  /** Shown instead of the thread when there are no messages. */
  empty: string;
  /** Row labels in the recipients tooltip. */
  from: string;
  to: string;
  cc: string;
  /** Recipient overflow in a bubble header. `{count}` available. */
  moreRecipients: string;
  /** Attachment affordances. */
  preview: string;
  download: string;
  /** Remote-image protection. */
  remoteImagesBlocked: string;
  loadImages: string;
  /** `<iframe title>` for a rich body — screen readers announce it. */
  bodyFrameTitle: string;
}

/**
 * The subset a date separator can render.
 *
 * Date grouping asks for this rather than the whole {@link ViewLabels} so the
 * signature states what it reads — and so a caller grouping messages outside
 * the view need only supply three strings. A full `ViewLabels` satisfies it.
 */
export type DayLabels = Pick<ViewLabels, 'today' | 'yesterday' | 'unknownDate'>;

/** English defaults. Override any subset via the view's `labels` prop. */
export const DEFAULT_LABELS: ViewLabels = {
  today: 'Today',
  yesterday: 'Yesterday',
  unknownDate: 'Unknown date',
  approximateTime: 'Approximate time',
  bodyLoading: 'Loading content…',
  bodyFailed: 'This message could not be downloaded.',
  retry: 'Retry',
  noContent: 'No new content (forwarded or replied without comment)',
  showEarlier: 'Show {count} earlier messages',
  loadOlder: 'Load older messages',
  loadingOlder: 'Loading older messages…',
  empty: 'No messages',
  from: 'From',
  to: 'To',
  cc: 'Cc',
  moreRecipients: '+{count} others',
  preview: 'Preview',
  download: 'Download',
  remoteImagesBlocked: 'Remote images blocked to protect your privacy',
  loadImages: 'Load images',
  bodyFrameTitle: 'Message body',
};

/**
 * Fill `{name}` placeholders.
 *
 * A deliberately dumb single-pass replace over the VALUES rather than a regex
 * over the template: a translated string is data from outside this package, and
 * scanning it with a pattern is how a stray brace turns into a crash. Unknown
 * placeholders are left alone so a mistranslation degrades to visible text
 * instead of an empty gap.
 */
export function fillTemplate(template: string, values: Record<string, string | number>): string {
  let filled = template;
  for (const [name, value] of Object.entries(values)) {
    filled = filled.split(`{${name}}`).join(String(value));
  }
  return filled;
}

/** Merge a caller's partial overrides onto the defaults. */
export function resolveLabels(overrides?: Partial<ViewLabels>): ViewLabels {
  return overrides ? { ...DEFAULT_LABELS, ...overrides } : DEFAULT_LABELS;
}
