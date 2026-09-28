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
 * channel of its own would work in exactly one application. A right-click is
 * the same: the bubble reports it (`onMessageMenu`) and the host draws the
 * menu, native or not.
 */
import {
  useCallback,
  useMemo,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';

import type { HtmlParser } from '../dom.js';
import type { Attachment, ChatMessage } from '../types.js';
import { inspectBody } from '../ui/body-shape.js';
import { bubbleTimestamp } from '../ui/dates.js';
import { resolveLabels, type ViewLabels } from '../ui/labels.js';
import {
  isEditableTarget,
  messageMenuRequest,
  type MessageMenuRequest,
} from '../ui/message-menu.js';
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
  /**
   * Whether this message's thread is people writing to each other.
   *
   * `MailChatView` works this out for the whole thread and passes it down; a
   * bubble rendered on its own has no thread to look at and defaults to false.
   * It narrows what counts as a designed document — see `inspectBody`.
   */
  conversational?: boolean;
  /** Withhold network images until the reader asks. Default true. */
  blockRemoteImages?: boolean;
  onOpenLink?: (url: string) => void;
  onRetryBody?: (message: ChatMessage) => void;
  onPreviewAttachment?: (attachment: Attachment, message: ChatMessage) => void;
  onDownloadAttachment?: (attachment: Attachment, message: ChatMessage) => void;
  /**
   * A right-click anywhere in this message: the header, the bubble, the body —
   * including a body rendered in a sandboxed frame, whose events never reach
   * the host's DOM on their own. The request carries the point in the PAGE's
   * viewport (translated out of the frame's for a framed body), the link under
   * the pointer, and the selected text when the selection lies inside this
   * message. See {@link MessageMenuRequest}.
   *
   * Return `false` to decline: the browser's own menu then opens as usual,
   * which is what a host with nothing to offer at that spot wants. Any other
   * return suppresses it. Omit the prop and right-clicks are left alone.
   *
   * Not reported: a right-click on the host's own controls (`renderActions`,
   * `renderQuickActions`), or on anything the host portals out of the bubble —
   * a dropdown rendered into `document.body` still bubbles through React's
   * tree, but it is the host's element with a menu of its own. Nor one in a
   * text field (`input`, `textarea`, `contenteditable`), whose own menu is the
   * one the reader wants, nor one that something inside the message already
   * handled with `preventDefault()`.
   */
  onMessageMenu?: (message: ChatMessage, request: MessageMenuRequest) => boolean | void;
  /** Controls shown at the bubble's outer edge on hover: menus, star, retry. */
  renderActions?: (message: ChatMessage) => ReactNode;
  /**
   * One-click actions pinned to the bubble's bottom inline-end corner (bottom
   * right in a left-to-right page), on every bubble — the reader's own and
   * everyone else's, a two-word reply and a framed document alike: reply,
   * reply all, forward. The host renders the buttons; the view only positions
   * them and reveals them exactly as it reveals `renderActions`, on row hover
   * and on `:focus-within`.
   *
   * They straddle the bubble's bottom edge, so on a one-line reply they sit in
   * the bubble's padding rather than over its words. Return `null` for a
   * message with nothing to act on and nothing renders — no empty container,
   * and no anchor around the bubble either.
   */
  renderQuickActions?: (message: ChatMessage) => ReactNode;
  /**
   * Per-message metadata beside the timestamp: a security shield, a verified
   * mark, a label. The header is where a reader already looks to answer "who
   * is this from, and when" — a mark that qualifies the answer belongs on that
   * line, not under the body where it reads as part of the message.
   *
   * A follow-up in a sender run has no header, and this still renders: the
   * bubble grows a meta-only row in its place. The header is dropped because
   * sender and time are INHERITED from the run's first bubble; a per-message
   * judgement is not, and silently dropping one is how a reader comes to
   * believe every message in a run was vouched for.
   */
  renderHeaderMeta?: (message: ChatMessage) => ReactNode;
  /**
   * Anything below the body, inside the bubble: a reply box, an AI notice.
   *
   * A bubble holding a designed mail carries no padding of its own — the
   * document reaches the card's edge — so a footer that needs breathing room
   * has to bring it. Style it against `.sec-bubble--doc` if it must differ.
   */
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
  conversational,
  blockRemoteImages,
  onOpenLink,
  onRetryBody,
  onPreviewAttachment,
  onDownloadAttachment,
  onMessageMenu,
  renderActions,
  renderQuickActions,
  renderHeaderMeta,
  renderFooter,
  className,
}: ChatBubbleProps) {
  const resolvedLabels = resolveLabels(labels);
  const actionsRef = useRef<HTMLDivElement>(null);
  const quickRef = useRef<HTMLDivElement>(null);

  // One parse per body, reused for three decisions: inline or framed, whether
  // there is anything to show at all, and whether to offer the image banner.
  const shape = useMemo(
    () => inspectBody(message.body, { parser, conversational }),
    [message.body, parser, conversational],
  );

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

  // Wrapped by the library rather than by the host so the header can align it:
  // `.sec-head` sits on a baseline, and an icon handed straight into that line
  // hangs below the text it annotates.
  const headerMeta = renderHeaderMeta?.(message);
  const metaNode = headerMeta ? <span className="sec-head__meta">{headerMeta}</span> : null;

  const previewAttachment = useCallback(
    (attachment: Attachment) => onPreviewAttachment?.(attachment, message),
    [onPreviewAttachment, message],
  );
  const downloadAttachment = useCallback(
    (attachment: Attachment) => onDownloadAttachment?.(attachment, message),
    [onDownloadAttachment, message],
  );

  // On the column, so the header and the bubble are one target. An inline
  // body is ordinary DOM and arrives here by bubbling; a framed one cannot, so
  // the frame reports it separately through `frameMenu` below.
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!onMessageMenu) return;
      const scope = event.currentTarget;
      const target = event.target as Node;
      // React bubbles an event from a PORTAL through the component tree, not
      // the DOM: a host dropdown rendered into `document.body` from one of the
      // slots arrives here although nothing under the pointer is this message.
      if (!scope.contains(target)) return;
      // Something inside the message already answered this right-click — an
      // inline reply editor in the footer with a menu of its own, say. React
      // still bubbles it up to here, and opening the message menu too would
      // put two menus on screen.
      if (event.isDefaultPrevented()) return;
      // The host's own controls. A right-click on a reply button is not a
      // right-click on the message, and a host menu opening over it would
      // fight whatever the control does itself. A text field is the host's
      // too, and its own menu — paste, spelling — is what the reader wants.
      if (actionsRef.current?.contains(target) || quickRef.current?.contains(target)) return;
      if (isEditableTarget(target)) return;
      const request = messageMenuRequest(event, scope.ownerDocument.getSelection(), scope);
      // `false` is the host declining, and the browser's menu must still open.
      if (onMessageMenu(message, request) === false) return;
      event.preventDefault();
    },
    [onMessageMenu, message],
  );
  // Undefined without a handler, so the frame leaves its right-click alone.
  const frameMenu = useMemo(
    () =>
      onMessageMenu ? (request: MessageMenuRequest) => onMessageMenu(message, request) : undefined,
    [onMessageMenu, message],
  );

  const quickActions = renderQuickActions?.(message);

  const attachments = message.attachments ?? [];
  // A designed mail is not a chat line, it is a finished document: it brings
  // its own background, its own margins and often its own colour scheme. Tint
  // and pad it like a bubble and the reader gets a card inside a card. So a
  // framed body keeps the container and loses the costume.
  //
  // `shape.kind`, never the body's LENGTH. A long letter is still a chat
  // message: stripping its padding and its tint for being long is what put the
  // sender's words against the bare edge of an untinted box.
  const isDocument = shape.kind === 'rich';
  // A framed body needs a sized containing block, so its bubble takes the full
  // column — and so does a long one, which would otherwise wrap in a column the
  // width of its longest paragraph. A short inline one hugs its text, which is
  // what makes a two-word reply look like a two-word reply.
  const hug = !isDocument && !shape.long;

  const rowClasses = ['sec-row', isMine ? 'sec-row--mine' : 'sec-row--theirs', className]
    .filter(Boolean)
    .join(' ');
  const bubbleClasses = [
    'sec-bubble',
    isMine ? 'sec-bubble--mine' : 'sec-bubble--theirs',
    compact ? '' : 'sec-bubble--tail',
    hug ? '' : 'sec-bubble--wide',
    isDocument ? 'sec-bubble--doc' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const bubble = (
    <div
      className={bubbleClasses}
      // The audit trail, in the DOM. "Why did part of my email disappear?"
      // is answerable with devtools instead of a rebuild.
      data-sec-applied={message.applied?.length ? message.applied.join(' ') : undefined}
      // Every bubble carries its sender's own colour, documents included.
      // A document used to be exempt on the grounds that its own background
      // would hide the tint — but most mail leaves large areas transparent,
      // so what the reader actually got was an untinted white card in a
      // column of coloured ones, and no way to tell at a glance who sent
      // it. Where the mail DOES paint its own background the tint is simply
      // covered, which costs nothing; and the colours it paints into table
      // cells are softened inside the frame (see `buildFrameCss`) so they
      // read as pastels of the sender's hue rather than competing with it.
      //
      // The rim goes on with the fill, and for a document it is the half
      // that does the work: the mail's own surface covers the wash, so
      // without a coloured border a designed mail is a white card in a
      // column of coloured ones. `--doc` widens it into a visible spine.
      //
      // `--sec-doc-page` is the same colour again, opaque. A document's
      // frame is transparent, so it needs a solid page to be printed on —
      // handed over as a custom property rather than as a prop because the
      // element that paints it is inside `SandboxedBody`, and because the
      // frame's own cell wash is derived from it in the stylesheet, which
      // keeps the page and the colours softened against it in one family.
      style={
        !isMine && color
          ? ({
              backgroundColor: color.bubble,
              borderColor: color.edge,
              '--sec-doc-page': color.page,
            } as CSSProperties)
          : undefined
      }
    >
      <MessageBody
        message={message}
        shape={shape}
        labels={resolvedLabels}
        blockRemoteImages={blockRemoteImages}
        onOpenLink={onOpenLink}
        onRetryBody={onRetryBody}
        onFrameMenu={frameMenu}
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
  );

  return (
    <div className={rowClasses}>
      <Avatar
        address={message.fromAddress}
        name={message.fromName}
        color={isMine ? undefined : color?.avatar}
        spacer={compact}
      />
      <div className={`sec-col${hug ? ' sec-col--hug' : ''}`} onContextMenu={handleContextMenu}>
        {compact ? (
          metaNode && <div className="sec-head sec-head--meta-only">{metaNode}</div>
        ) : (
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
            {metaNode}
          </div>
        )}

        {quickActions ? (
          // The quick actions' positioning box, and it exists only because they
          // are there. Sized to the bubble exactly — full width for a wide one,
          // hugging for a short one — which is what keeps them on the bubble's
          // own corner when the column is wider than the bubble; and OUTSIDE
          // the bubble, whose `overflow: hidden` on a document would clip the
          // half that hangs below its edge.
          <div className={hug ? 'sec-bubble-anchor' : 'sec-bubble-anchor sec-bubble-anchor--wide'}>
            {bubble}
            <div className="sec-quick" ref={quickRef}>
              {quickActions}
            </div>
          </div>
        ) : (
          bubble
        )}

        {renderActions ? (
          <div className="sec-actions" ref={actionsRef}>
            {renderActions(message)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
