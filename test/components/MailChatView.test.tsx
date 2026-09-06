// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MailChatView, type MailChatViewProps } from '../../src/components/MailChatView.js';
import type { ChatMessage } from '../../src/types.js';
import { settleFrameLoad } from '../helpers/frames.js';
import { chatMessage, NOW, thread, TODAY_AT_TEN } from '../helpers/messages.js';
import { FakeIntersectionObserver, installIntersectionObserver } from '../helpers/observers.js';

/** `en-GB` and an injected "now", so no assertion depends on the test clock. */
function renderView(props: Partial<MailChatViewProps> = {}) {
  const { messages = thread(4), ...rest } = props;
  return render(<MailChatView messages={messages} locale="en-GB" now={NOW} {...rest} />);
}

function bubblesIn(container: HTMLElement) {
  return [...container.querySelectorAll('[data-sec-index]')];
}

/** The observer watching the bubbles, as opposed to the top sentinel. */
function rangeObserver() {
  const found = FakeIntersectionObserver.instances.find((observer) =>
    observer.targets.some((target) => (target as HTMLElement).dataset?.secIndex !== undefined),
  );
  if (!found) throw new Error('no observer is watching any bubble');
  return found;
}

afterEach(async () => {
  await settleFrameLoad();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MailChatView', () => {
  // Regression: ghost bubbles say something a spinner cannot — that what is
  // coming is a conversation, roughly this long. But only while there is
  // nothing to show: once messages exist they win, or a background refresh
  // that sets `loading` blanks a thread the reader is reading.
  it('shows placeholders only while there is nothing to show', () => {
    const empty = renderView({ messages: [], loading: true });
    expect(empty.container.querySelectorAll('.sec-ghost')).toHaveLength(3);
    empty.unmount();

    const refreshing = renderView({ loading: true });
    expect(refreshing.container.querySelector('.sec-ghost')).toBeNull();
    expect(bubblesIn(refreshing.container)).toHaveLength(4);
  });

  it('says so when the thread is empty, in the host’s own words', () => {
    const plain = renderView({ messages: [] });
    expect(plain.container.querySelector('.sec-empty')?.textContent).toBe('No messages');
    plain.unmount();

    const custom = renderView({ messages: [], emptyState: <p>Nothing here yet</p> });
    expect(custom.container.querySelector('.sec-empty')).toBeNull();
    expect(screen.getByText('Nothing here yet')).not.toBeNull();
  });

  // Regression: a thread spanning a fortnight reads as one continuous
  // conversation without these, and every "when was this?" needs a hover.
  it('separates the days and takes the host’s wording for them', () => {
    const yesterday = TODAY_AT_TEN - 24 * 60 * 60 * 1000;
    const { container } = renderView({
      messages: [
        chatMessage({ id: 'a', date: yesterday }),
        chatMessage({ id: 'b', date: TODAY_AT_TEN }),
      ],
      labels: { today: 'Aujourd’hui', yesterday: 'Hier' },
    });
    expect(
      [...container.querySelectorAll('.sec-date-sep__label')].map((l) => l.textContent),
    ).toEqual(['Hier', 'Aujourd’hui']);
  });

  describe('sender runs', () => {
    const run: ChatMessage[] = [
      chatMessage({ id: 'a', date: TODAY_AT_TEN }),
      chatMessage({ id: 'b', date: TODAY_AT_TEN + 60_000 }),
    ];

    // Regression: three consecutive messages from one person, each with its own
    // avatar and header, is what makes a mail thread NOT read as a chat.
    it('collapses a follow-up from the same sender', () => {
      const { container } = renderView({ messages: run });
      const items = bubblesIn(container);
      expect(items[0]?.className).toBe('sec-item');
      expect(items[1]?.className).toBe('sec-item sec-item--run');
      expect(container.querySelectorAll('.sec-head')).toHaveLength(1);
    });

    it('gives every message its own header when the host asks for one', () => {
      const { container } = renderView({ messages: run, senderRunWindowMs: 0 });
      expect(container.querySelectorAll('.sec-head')).toHaveLength(2);
    });
  });

  describe('the DOM ceiling', () => {
    // Regression: a 200-message thread with a frame per rich body is a browser
    // tab that stops responding. The older bubbles stay one click away rather
    // than being rendered and hidden.
    it('holds older bubbles back and reveals them a page at a time', () => {
      const { container } = renderView({ messages: thread(5), maxRendered: 2 });
      expect(bubblesIn(container)).toHaveLength(2);

      fireEvent.click(screen.getByRole('button', { name: /Show 3 earlier messages/ }));
      expect(bubblesIn(container)).toHaveLength(4);

      fireEvent.click(screen.getByRole('button', { name: /Show 1 earlier messages/ }));
      expect(bubblesIn(container)).toHaveLength(5);
      expect(screen.queryByRole('button', { name: /earlier/ })).toBeNull();
    });

    it('renders the whole thread when the host turns the ceiling off', () => {
      const { container } = renderView({ messages: thread(5), maxRendered: 0 });
      expect(bubblesIn(container)).toHaveLength(5);
      expect(screen.queryByRole('button', { name: /earlier/ })).toBeNull();
    });

    // Regression: the withheld bubbles are numbered in the CALLER's array, not
    // in the rendered slice — a host prioritising body fetches by index would
    // otherwise fetch the wrong messages entirely.
    it('numbers the rendered bubbles as the caller numbers them', () => {
      const { container } = renderView({ messages: thread(5), maxRendered: 2 });
      expect(bubblesIn(container).map((item) => (item as HTMLElement).dataset.secIndex)).toEqual([
        '3',
        '4',
      ]);
    });
  });

  describe('older history', () => {
    it('offers to fetch more, and says so while it is fetching', () => {
      const onLoadOlder = vi.fn();
      const { unmount } = renderView({ hasOlder: true, onLoadOlder });
      fireEvent.click(screen.getByRole('button', { name: 'Load older messages' }));
      expect(onLoadOlder).toHaveBeenCalledTimes(1);
      unmount();

      const busy = renderView({ hasOlder: true, onLoadOlder, loadingOlder: true });
      const button = screen.getByRole('button', { name: /Loading older messages/ });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(busy.container.querySelector('.sec-spin')).not.toBeNull();
    });

    it('offers nothing the host cannot serve', () => {
      renderView({ hasOlder: true });
      expect(screen.queryByRole('button')).toBeNull();
    });

    // Regression: fetching more history from the network while a "show earlier"
    // button is still hiding messages we already have grows a thread the reader
    // cannot see.
    it('reveals what is already here before asking for more', () => {
      renderView({ messages: thread(5), maxRendered: 2, hasOlder: true, onLoadOlder: vi.fn() });
      expect(screen.queryByRole('button', { name: 'Load older messages' })).toBeNull();
      expect(screen.getByRole('button', { name: /Show 3 earlier messages/ })).not.toBeNull();
    });

    it('fetches when the top of the thread comes into view', () => {
      installIntersectionObserver();
      const onLoadOlder = vi.fn();
      const { container } = renderView({ hasOlder: true, onLoadOlder });
      const sentinel = container.querySelector('.sec-top');
      const observer = FakeIntersectionObserver.instances.find((each) =>
        each.targets.includes(sentinel),
      );

      act(() => {
        observer?.emit([{ target: sentinel, isIntersecting: false }]);
      });
      expect(onLoadOlder).not.toHaveBeenCalled();

      act(() => {
        observer?.emit([{ target: sentinel, isIntersecting: true }]);
      });
      expect(onLoadOlder).toHaveBeenCalledTimes(1);
    });

    // Regression: without this the sentinel is still on screen when the fetch
    // returns, and the view asks for the same page again, forever.
    it('does not ask again while a fetch is in flight', () => {
      installIntersectionObserver();
      const { container } = renderView({
        hasOlder: true,
        onLoadOlder: vi.fn(),
        loadingOlder: true,
      });
      const sentinel = container.querySelector('.sec-top');
      expect(
        FakeIntersectionObserver.instances.some((each) => each.targets.includes(sentinel)),
      ).toBe(false);
    });
  });

  describe('visibility reporting', () => {
    // Regression: THE reason this exists. A host fetching bodies needs to know
    // which messages somebody is actually looking at, or a 200-message thread
    // fetches from the top while the reader sits at the bottom.
    it('reports the whole span between the first and last visible bubble', () => {
      installIntersectionObserver();
      const onVisibleRangeChange = vi.fn();
      const { container } = renderView({ onVisibleRangeChange });
      const items = bubblesIn(container);

      act(() => {
        // Only the ends report; the bubble between them has not fired its own
        // callback yet, and its body is exactly as much on screen.
        rangeObserver().emit([
          { target: items[2], isIntersecting: true },
          { target: items[0], isIntersecting: true },
        ]);
      });
      expect(onVisibleRangeChange).toHaveBeenLastCalledWith({
        firstIndex: 0,
        lastIndex: 2,
        ids: ['m0', 'm1', 'm2'],
      });
    });

    it('reports indices in the caller’s own array, not in the rendered slice', () => {
      installIntersectionObserver();
      const onVisibleRangeChange = vi.fn();
      const { container } = renderView({
        messages: thread(5),
        maxRendered: 2,
        onVisibleRangeChange,
      });

      act(() => {
        rangeObserver().emit([{ target: bubblesIn(container)[1], isIntersecting: true }]);
      });
      expect(onVisibleRangeChange).toHaveBeenLastCalledWith({
        firstIndex: 4,
        lastIndex: 4,
        ids: ['m4'],
      });
    });

    it('forgets a bubble that has scrolled away', () => {
      installIntersectionObserver();
      const onVisibleRangeChange = vi.fn();
      const { container } = renderView({ onVisibleRangeChange });
      const items = bubblesIn(container);

      act(() => {
        rangeObserver().emit([{ target: items[0], isIntersecting: true }]);
      });
      expect(onVisibleRangeChange).toHaveBeenCalledTimes(1);

      // Nothing visible any more: there is no range to report, and reporting an
      // empty one would have the host cancel the fetches it just started.
      act(() => {
        rangeObserver().emit([{ target: items[0], isIntersecting: false }]);
      });
      expect(onVisibleRangeChange).toHaveBeenCalledTimes(1);
    });

    // Regression: `useLatest` is the whole reason the observer effect can leave
    // the host's callback out of its dependencies, and it writes its ref in an
    // effect rather than during render. If that write ever stops landing before
    // the observer fires, the view reports visibility into a callback the host
    // has already replaced — body fetches get prioritised through a closure
    // over the previous thread, and the reader waits on the wrong bodies.
    it('reports to the callback from the latest render, not the first one', () => {
      installIntersectionObserver();
      const first = vi.fn();
      const second = vi.fn();
      const messages = thread(4);
      const { container, rerender } = render(
        <MailChatView messages={messages} locale="en-GB" now={NOW} onVisibleRangeChange={first} />,
      );
      rerender(
        <MailChatView messages={messages} locale="en-GB" now={NOW} onVisibleRangeChange={second} />,
      );

      act(() => {
        rangeObserver().emit([{ target: bubblesIn(container)[1], isIntersecting: true }]);
      });

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenLastCalledWith({ firstIndex: 1, lastIndex: 1, ids: ['m1'] });
    });

    it('ignores an element that is not one of its bubbles', () => {
      installIntersectionObserver();
      const onVisibleRangeChange = vi.fn();
      renderView({ onVisibleRangeChange });

      act(() => {
        rangeObserver().emit([
          { target: { dataset: { secIndex: 'not-a-number' } }, isIntersecting: true },
        ]);
      });
      expect(onVisibleRangeChange).not.toHaveBeenCalled();
    });

    // Regression: the span is walked by index, and a stale entry (a bubble the
    // ceiling has since withheld) points past the end of the rendered slice.
    // Left unguarded that is `undefined.id`, which takes the thread down.
    it('survives a report for a bubble that is no longer rendered', () => {
      installIntersectionObserver();
      const onVisibleRangeChange = vi.fn();
      renderView({ onVisibleRangeChange });

      act(() => {
        rangeObserver().emit([{ target: { dataset: { secIndex: '99' } }, isIntersecting: true }]);
      });
      expect(onVisibleRangeChange).toHaveBeenLastCalledWith({
        firstIndex: 99,
        lastIndex: 99,
        ids: [],
      });
    });

    it('watches nothing when the host does not want to know', () => {
      installIntersectionObserver();
      renderView();
      expect(FakeIntersectionObserver.instances).toHaveLength(0);
    });

    // Regression: an old webview with no IntersectionObserver must still render
    // the thread. Visibility is a hint; losing it is the right degradation.
    it('renders the thread where there is no IntersectionObserver at all', () => {
      expect(typeof IntersectionObserver).toBe('undefined');
      const onVisibleRangeChange = vi.fn();
      const { container } = renderView({
        onVisibleRangeChange,
        hasOlder: true,
        onLoadOlder: vi.fn(),
      });
      expect(bubblesIn(container)).toHaveLength(4);
      expect(onVisibleRangeChange).not.toHaveBeenCalled();
    });
  });

  describe('following new messages', () => {
    function stubScrollIntoView() {
      const scrollIntoView = vi.fn();
      // jsdom does not implement it, so there is nothing to spy ON — it has to
      // be added. Which is also why the component calls it optionally.
      Object.defineProperty(Element.prototype, 'scrollIntoView', {
        value: scrollIntoView,
        configurable: true,
        writable: true,
      });
      return scrollIntoView;
    }

    afterEach(() => {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    });

    // Regression: keyed on the last message's ID, deliberately not on the
    // count. Prepending a page of older history changes the count, and jumping
    // to the bottom then throws the reader out of the history they just asked
    // for.
    it('follows a new message down but not a page of older ones', () => {
      const scrollIntoView = stubScrollIntoView();
      const messages = thread(3);
      const { rerender } = render(<MailChatView messages={messages} now={NOW} locale="en-GB" />);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);

      // A page of older history, prepended: same last message, no jump.
      rerender(
        <MailChatView
          messages={[chatMessage({ id: 'older', date: TODAY_AT_TEN - 86_400_000 }), ...messages]}
          now={NOW}
          locale="en-GB"
        />,
      );
      expect(scrollIntoView).toHaveBeenCalledTimes(1);

      // A reply arrives: follow it.
      rerender(
        <MailChatView
          messages={[...messages, chatMessage({ id: 'new', date: NOW })]}
          now={NOW}
          locale="en-GB"
        />,
      );
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
    });

    it('stays where the reader put it when told not to follow', () => {
      const scrollIntoView = stubScrollIntoView();
      renderView({ autoScroll: false });
      expect(scrollIntoView).not.toHaveBeenCalled();
    });

    it('renders where scrollIntoView does not exist', () => {
      expect(Element.prototype.scrollIntoView).toBeUndefined();
      const { container } = renderView();
      expect(bubblesIn(container)).toHaveLength(4);
    });
  });

  describe('identity colours', () => {
    /** Two people writing to the reader, so every bubble is somebody else's. */
    function participants(count: number): ChatMessage[] {
      return thread(count).map((message) => ({ ...message, isFromMe: false }));
    }

    function avatarColors(container: HTMLElement) {
      return [...container.querySelectorAll('.sec-avatar')].map(
        (avatar) => (avatar as HTMLElement).style.backgroundColor,
      );
    }

    // Regression: the reader is not a participant to be told apart — their own
    // bubbles are the brand tint from the stylesheet. An identity colour on
    // top of it makes the reader look like a stranger in their own thread.
    it('colours the people the reader is talking to and not the reader', () => {
      const { container } = renderView({ messages: thread(2) });
      const avatars = [...container.querySelectorAll('.sec-avatar')] as HTMLElement[];
      expect(avatars[0]?.style.backgroundColor).not.toBe('');
      expect(avatars[1]?.getAttribute('style')).toBeNull();
    });

    // Regression: a string is iterable, so a spread would turn one address
    // into eighteen single characters and quietly exclude nobody. Whether the
    // host has one account or five must make no difference to the colouring.
    it('takes the reader’s address as a string or as a list', () => {
      const single = renderView({
        messages: participants(4),
        currentUserAddress: 'reader@acme.example',
      });
      const asString = avatarColors(single.container);
      single.unmount();

      const many = renderView({
        messages: participants(4),
        currentUserAddress: ['reader@acme.example', 'reader+alias@acme.example'],
      });
      expect(avatarColors(many.container)).toEqual(asString);
      expect(asString.every(Boolean)).toBe(true);
    });

    // Regression: colours are built from the WHOLE thread, not the rendered
    // slice — otherwise revealing older messages recolours the people already
    // on screen, and the one signal that survives a glance stops being stable.
    it('keeps a participant’s colour when older messages are revealed', () => {
      const { container } = renderView({ messages: participants(5), maxRendered: 2 });
      const before = avatarColors(container);
      expect(before).toHaveLength(2);

      fireEvent.click(screen.getByRole('button', { name: /Show 3 earlier messages/ }));
      // A reveal adds one page, so this is still not the whole thread — and
      // the two bubbles that were already on screen are the last two, which
      // must be exactly the colours they were.
      expect(avatarColors(container).slice(-2)).toEqual(before);
    });
  });

  it('takes a class from its host', () => {
    const { container } = renderView({ className: 'app-thread' });
    expect(container.querySelector('.sec-thread')?.className).toBe('sec-thread app-thread');
  });
});
