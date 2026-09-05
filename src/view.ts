/**
 * The React view layer.
 *
 * Everything reachable from here needs React, and — unlike
 * `email-chat-view/transform` — a DOM: the sanitizer, the frame and the
 * observers are all browser work. Keeping the two apart is what lets a Node
 * pipeline import the transform without pulling in React, DOMPurify or an
 * address grammar.
 *
 * The composed component is `MailChatView`. Everything below it is exported
 * too, because a host with its own list, its own virtualizer or its own layout
 * needs the parts rather than the whole — and because the pure functions
 * (colours, grouping, dates, sanitizing) are useful on their own.
 */

// --- The composed view -------------------------------------------------------
export { MailChatView } from './components/MailChatView.js';
export type { MailChatViewProps, VisibleRange } from './components/MailChatView.js';

// --- The parts ---------------------------------------------------------------
export { AttachmentChip } from './components/AttachmentChip.js';
export type { AttachmentChipProps } from './components/AttachmentChip.js';
export { Avatar } from './components/Avatar.js';
export type { AvatarProps } from './components/Avatar.js';
export { ChatBubble, RecipientsSummary } from './components/ChatBubble.js';
export type { ChatBubbleProps } from './components/ChatBubble.js';
export { ChatSkeleton } from './components/ChatSkeleton.js';
export type { ChatSkeletonProps } from './components/ChatSkeleton.js';
export { DateSeparator } from './components/DateSeparator.js';
export type { DateSeparatorProps } from './components/DateSeparator.js';
export { MessageBody } from './components/MessageBody.js';
export type { MessageBodyProps } from './components/MessageBody.js';
export { SandboxedBody } from './components/SandboxedBody.js';
export type { SandboxedBodyProps } from './components/SandboxedBody.js';
export { Tooltip } from './components/Tooltip.js';
export type { TooltipProps } from './components/Tooltip.js';

// --- Strings -----------------------------------------------------------------
export { DEFAULT_LABELS, fillTemplate, resolveLabels } from './ui/labels.js';
export type { ViewLabels } from './ui/labels.js';

// --- Identity colours --------------------------------------------------------
export {
  buildSenderColorMap,
  colorForHue,
  MIN_HUE_SEP,
  resolveSenderColor,
  senderHue,
} from './ui/sender-colors.js';
export type { SenderColor } from './ui/sender-colors.js';

// --- Layout decisions --------------------------------------------------------
export {
  DEFAULT_SENDER_RUN_MS,
  groupMessagesByDate,
  isSameSenderRun,
} from './ui/grouping.js';
export type { DateGroup } from './ui/grouping.js';
export { inspectBody, SIMPLE_TEXT_LIMIT } from './ui/body-shape.js';
export type { BodyKind, BodyShape, InspectBodyOptions } from './ui/body-shape.js';

// --- Dates -------------------------------------------------------------------
export {
  dateGroupLabel,
  formatChatTime,
  formatChatTimestamp,
  formatFullTimestamp,
  isSameLocalDay,
} from './ui/dates.js';

// --- Addresses ---------------------------------------------------------------
export {
  describeRecipients,
  displayNameFor,
  formatRecipientLabels,
  initialsFor,
  parseAddressList,
  shortNameFor,
} from './ui/recipients.js';
export type { ParsedAddress, RecipientSummary } from './ui/recipients.js';

// --- Attachments -------------------------------------------------------------
export {
  extensionOf,
  formatFileSize,
  isPreviewable,
  PREVIEWABLE_EXTENSIONS,
} from './ui/attachments.js';

// --- Sanitizing --------------------------------------------------------------
export {
  canSanitize,
  INLINE_ALLOWED_ATTR,
  INLINE_ALLOWED_TAGS,
  sanitizeFrameHtml,
  sanitizeInlineHtml,
} from './ui/sanitize.js';
export type { Purifier } from './ui/sanitize.js';

// --- The sandboxed frame -----------------------------------------------------
export {
  buildFrameCss,
  buildFrameDocument,
  clickedHref,
  estimateFrameHeight,
  FALLBACK_FRAME_THEME,
  measureFrameHeight,
  readFrameTheme,
} from './ui/frame.js';
export type { FrameDocumentOptions, FrameTheme } from './ui/frame.js';
