// @vitest-environment jsdom
/**
 * The view's callbacks, as native receives them.
 *
 * `MailChatView` is replaced by a stub that keeps its props, so each callback
 * can be invoked directly. Its own tests already prove WHEN each one fires;
 * what is under test here is only the translation into a {@link NativeEvent},
 * and above all that every event names the MAIL, never a derived message.
 */
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MailChatViewProps } from '../../src/components/MailChatView.js';
import type { NativeEvent } from '../../src/mobile/bridge.js';
import { MobileThread } from '../../src/mobile/host.js';
import { createBodyCache } from '../../src/transform/mails-to-messages.js';
import { chatMessage } from '../helpers/messages.js';

const captured: { props?: MailChatViewProps } = {};

vi.mock('../../src/components/MailChatView.js', () => ({
  MailChatView: (props: MailChatViewProps) => {
    captured.props = props;
    return null;
  },
}));

const split = chatMessage({ id: 'm1#1', sourceId: 'm1' });
const attachment = { filename: 'q1.pdf', sizeBytes: 10 };

function viewProps(events: NativeEvent[]): MailChatViewProps {
  render(
    <MobileThread
      state={{ messages: [chatMessage({ id: 'm0' }), split], hasOlder: true, locale: 'en-GB' }}
      post={(event) => events.push(event)}
      cache={createBodyCache()}
    />,
  );
  if (!captured.props) throw new Error('MailChatView was not rendered');
  return captured.props;
}

beforeEach(() => {
  captured.props = undefined;
});

describe('MobileThread events', () => {
  it('passes the display options through', () => {
    const props = viewProps([]);
    expect(props.hasOlder).toBe(true);
    expect(props.locale).toBe('en-GB');
  });

  it('turns every callback into a native event keyed by mail id', () => {
    const events: NativeEvent[] = [];
    const props = viewProps(events);
    props.onOpenLink?.('https://example.com/');
    props.onRetryBody?.(split);
    props.onPreviewAttachment?.(attachment, split);
    props.onDownloadAttachment?.(attachment, split);
    props.onLoadOlder?.();
    props.onVisibleRangeChange?.({ firstIndex: 0, lastIndex: 1, ids: ['m0', 'm1#1'] });

    expect(events).toEqual([
      { type: 'openLink', url: 'https://example.com/' },
      { type: 'retryBody', mailId: 'm1' },
      { type: 'previewAttachment', mailId: 'm1', attachment },
      { type: 'downloadAttachment', mailId: 'm1', attachment },
      { type: 'loadOlder' },
      { type: 'visibleRange', mailIds: ['m0', 'm1'] },
    ]);
  });
});
