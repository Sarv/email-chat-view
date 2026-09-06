/**
 * One message, as a bubble.
 *
 * Exported on its own, not just used by `MailChatView`, because a host with its
 * own list (a virtualizer, a split view, a single-message preview) needs the
 * bubble without the list around it.
 *
 * Everything the host must own is a prop, and none of it is guessed: opening a
 * link, retrying a body, previewing an attachment, and whatever extra controls
 * belong on a bubble (reply, star, an AI re-run) come in as callbacks and
 * render slots. A component that reached for `window.open` or an Electron IPC
 * channel of its own would work in exactly one application.
 */
import { useCallback, useMemo, type ReactNode } from 'react';

import type { HtmlParser } from '../dom.js';
import type { Attachment, ChatMessage } from '../types.js';
import { inspectBody } from '../ui/body-shape.js';
import { bubbleTimestamp } from '../ui/dates.js';
import { resolveLabels, type ViewLabels } from '../ui/labels.js';
import {
  describeRecipients,
  displayNameFor,
  parseAddressList,
  type ParsedAddress,
} from '../ui/recipients.js';
import type { SenderColor } from '../ui/sender-colors.js';

import { AttachmentChip } from './AttachmentChip.js';
import { Avatar } from './Avatar.js';
import { MessageBody } from './MessageBody.js';
import { Tooltip } from './Tooltip.js';

/** How wide the recipients tooltip may get before it wraps. */
const RECIPIENTS_TOOLTIP_WIDTH = 420;

function AddressRow({
  label,
  recipients,
}: {
  label: string;
  recipients: readonly ParsedAddress[];
}) {
  if (!recipients.length) return null;
  return (
    <span className="sec-addr-row">
      <span className="sec-addr-row__label">{label}</span>
      <span className="sec-addr-row__value">
        {recipients
          .map((recipient) =>
            recipient.name ? `${recipient.name} <${recipient.address}>` : recipient.address,
          )
          .join(', ')}
      </span>
    </span>
  );
}

/**
 * The full From / To / Cc list, shown on hover over the header.
 *
 * The header itself is a glance — one or two names — because a bubble whose
 * header lists nine recipients is no longer a chat message. Nothing is lost:
 * the complete list is here, one hover away, which is where a reader goes when
 * they actually need to know who saw something.
 */
export function RecipientsSummary({
  message,
  labels,
}: {
  message: ChatMessage;
  labels: ViewLabels;
}) {
  const from: ParsedAddress[] = message.fromAddress
    ? [
        message.fromName
          ? { address: message.fromAddress, name: message.fromName }
          : { address: message.fromAddress },
      ]
    : [];
  return (
    <span className="sec-addr">
      <AddressRow label={labels.from} recipients={from} />
      <AddressRow
        label={labels.to}
        recipients={parseAddressList(message.toAddress, message.toNames)}
      />
      <AddressRow
        label={labels.cc}
        recipients={parseAddressList(message.ccAddress, message.ccNames)}
      />
    </span>
  );
}

export interface ChatBubbleProps {
  message: ChatMessage;
  /** The sender's identity colours. Omit for the reader's own messages. */
  color?: SenderColor;
  /** Right-align this bubble. Defaults to the message's own `isFromMe`. */
  mine?: boolean;
  /** A follow-up in a sender run: no avatar, no header, no tail corner. */
  compact?: boolean;
  /** Partial label overrides; see {@link ViewLabels}. */
  labels?: Partial<ViewLabels>;
  /** BCP 47 locale for dates. Defaults to the reader's own. */
  locale?: string | string[];
  /** "Now", for the relative day labels. Injectable so tests are not clock-dependent. */
  now?: number;
  /** HTML parser, for environments with no global `DOMParser`. */
  parser?: HtmlParser;
  /** Withhold network images until the reader asks. Default true. */
  blockRemoteImages?: boolean;
  onOpenLink?: (url: string) => void;
  onRetryBody?: (message: ChatMessage) => void;
  onPreviewAttachment?: (attachment: Attachment, message: ChatMessage) => void;
  onDownloadAttachment?: (attachment: Attachment, message: ChatMessage) => void;
  /** Controls shown at the bubble's outer edge on hover: menus, star, retry. */
  renderActions?: (message: ChatMessage) => ReactNode;
  /** Anything below the body, inside the bubble: a reply box, an AI notice. */
  renderFooter?: (message: ChatMessage) => ReactNode;
  className?: string;
}

export function ChatBubble({
  message,
  color,
  mine,
  compact = false,
  labels,
  locale,
  now,
  parser,
  blockRemoteImages,
  onOpenLink,
  onRetryBody,
  onPreviewAttachment,
  onDownloadAttachment,
  renderActions,
  renderFooter,
  className,
}: ChatBubbleProps) {
  const resolvedLabels = resolveLabels(labels);

  // One parse per body, reused for three decisions: inline or framed, whether
  // there is anything to show at all, and whether to offer the image banner.
  const shape = useMemo(() => inspectBody(message.body, { parser }), [message.body, parser]);

  // `?? false` and not `?? true`: when the transform could not work out whose
  // message this is, `isFromMe` is undefined, and left-aligning everything is
  // the honest fallback. Attributing someone else's mail to the reader is a
  // much worse error than a thread that is flat on one side.
  const isMine = mine ?? message.isFromMe ?? false;

  const recipients = useMemo(
    () => [
      ...parseAddressList(message.toAddress, message.toNames),
      ...parseAddressList(message.ccAddress, message.ccNames),
    ],
    [message.toAddress, message.toNames, message.ccAddress, message.ccNames],
  );

  const senderLabel = displayNameFor(message.fromAddress, message.fromName);
  const recipientSummary = describeRecipients(recipients, resolvedLabels);
  const timestamp = bubbleTimestamp(message.date, message.dateApprox, resolvedLabels, locale, now);

  const previewAttachment = useCallback(
    (attachment: Attachment) => onPreviewAttachment?.(attachment, message),
    [onPreviewAttachment, message],
  );
  const downloadAttachment = useCallback(
    (attachment: Attachment) => onDownloadAttachment?.(attachment, message),
    [onDownloadAttachment, message],
  );

  const attachments = message.attachments ?? [];
  // A framed body needs a sized containing block, so its bubble takes the full
  // column. A short inline one hugs its text, which is what makes a two-word
  // reply look like a two-word reply.
  const hug = shape.kind !== 'rich';

  const rowClasses = ['sec-row', isMine ? 'sec-row--mine' : 'sec-row--theirs', className]
    .filter(Boolean)
    .join(' ');
  const bubbleClasses = [
    'sec-bubble',
    isMine ? 'sec-bubble--mine' : 'sec-bubble--theirs',
    compact ? '' : 'sec-bubble--tail',
    hug ? '' : 'sec-bubble--wide',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rowClasses}>
      <Avatar
        address={message.fromAddress}
        name={message.fromName}
        color={isMine ? undefined : color?.avatar}
        spacer={compact}
      />
      <div className={`sec-col${hug ? ' sec-col--hug' : ''}`}>
        {compact ? null : (
          <div className="sec-head">
            <Tooltip
              className="sec-head__who"
              maxWidth={RECIPIENTS_TOOLTIP_WIDTH}
              content={<RecipientsSummary message={message} labels={resolvedLabels} />}
            >
              <span className="sec-head__sender">{senderLabel}</span>
              {recipientSummary.names ? (
                <span className="sec-head__to">
                  {/* Two elements, not one string: the names shrink and
                      ellipsise, the count never does. See
                      `describeRecipients`. */}
                  <span className="sec-head__names">
                    <span aria-hidden="true">→ </span>
                    {recipientSummary.names}
                  </span>
                  {recipientSummary.more ? (
                    <span className="sec-head__more">{recipientSummary.more}</span>
                  ) : null}
                </span>
              ) : null}
            </Tooltip>
            {timestamp.text ? (
              <time
                className="sec-head__time"
                // Safe unguarded: a date this machine cannot read produces an
                // empty `timestamp` above, and then this element is not
                // rendered at all. Machine-readable form is always UTC; the
                // visible text next to it is the reader's own zone.
                dateTime={new Date(message.date).toISOString()}
                title={timestamp.title}
              >
                {timestamp.text}
              </time>
            ) : null}
          </div>
        )}

        <div
          className={bubbleClasses}
          // The audit trail, in the DOM. "Why did part of my email disappear?"
          // is answerable with devtools instead of a rebuild.
          data-sec-applied={message.applied?.length ? message.applied.join(' ') : undefined}
          style={!isMine && color ? { backgroundColor: color.bubble } : undefined}
        >
          <MessageBody
            message={message}
            shape={shape}
            labels={resolvedLabels}
            blockRemoteImages={blockRemoteImages}
            onOpenLink={onOpenLink}
            onRetryBody={onRetryBody}
          />

          {attachments.length ? (
            <div className="sec-attachments">
              {attachments.map((attachment, index) => (
                <AttachmentChip
                  // Filenames repeat within one message more often than you
                  // would think (two `image001.png` from a signature), so the
                  // index is part of the key.
                  key={`${attachment.filename}:${index}`}
                  attachment={attachment}
                  labels={resolvedLabels}
                  onPreview={onPreviewAttachment ? previewAttachment : undefined}
                  onDownload={onDownloadAttachment ? downloadAttachment : undefined}
                />
              ))}
            </div>
          ) : null}

          {renderFooter?.(message)}
        </div>

        {renderActions ? <div className="sec-actions">{renderActions(message)}</div> : null}
      </div>
    </div>
  );
}
