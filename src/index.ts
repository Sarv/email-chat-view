/**
 * `email-chat-view` — render an email thread as a chat.
 *
 * The package root re-exports the whole surface: the React view and the pure
 * transform that feeds it. Import from `email-chat-view/transform` instead
 * when you want the transform WITHOUT React in the dependency graph (a Node
 * pipeline, a worker, a CLI).
 *
 * @example
 * ```tsx
 * import { MailChatView, mailsToMessages, createBodyCache } from 'email-chat-view';
 * import 'email-chat-view/style.css';
 *
 * const cache = useRef(createBodyCache()).current;
 * const messages = useMemo(
 *   () => mailsToMessages(mails, { currentUserAddress: me, dateUnit: 's', cache }),
 *   [mails, me, cache],
 * );
 *
 * <MailChatView messages={messages} hasOlder={hasOlder} onLoadOlder={loadOlder} />
 * ```
 */

export * from './transform.js';
export * from './view.js';
