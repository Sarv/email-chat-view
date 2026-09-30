// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatBubble, RecipientsSummary } from '../../src/components/ChatBubble.js';
import type { ChatMessage } from '../../src/types.js';
import { DEFAULT_LABELS } from '../../src/ui/labels.js';
import { loadedFrameDocument, placeFrame, rightClick, settleFrameLoad } from '../helpers/frames.js';
import { chatMessage, NOW } from '../helpers/messages.js';

/** Plain `rgb()` so jsdom's CSSOM hands the same string back. */
const COLOR = {
  avatar: 'rgb(1, 2, 3)',
  bubble: 'rgb(4, 5, 6)',
  edge: 'rgb(7, 8, 9)',
  page: 'rgb(10, 11, 12)',
};

/** `en-GB` and an injected "now", so no assertion depends on the test clock. */
const FIXED = { locale: 'en-GB', now: NOW } as const;

afterEach(async () => {
  await settleFrameLoad();
});

describe('ChatBubble', () => {
  it('lays someone else’s message out on the left, in their identity colour', () => {
    const { container } = render(
      <ChatBubble message={chatMessage()} color={COLOR} labels={DEFAULT_LABELS} {...FIXED} />,
    );
    expect(container.querySelector('.sec-row')?.className).toBe('sec-row sec-row--theirs');
    expect((container.querySelector('.sec-avatar') as HTMLElement).style.backgroundColor).toBe(
      COLOR.avatar,
    );
    const bubble = container.querySelector('.sec-bubble') as HTMLElement;
    expect(bubble.className).toBe('sec-bubble sec-bubble--theirs sec-bubble--tail');
    expect(bubble.style.backgroundColor).toBe(COLOR.bubble);
    expect(bubble.style.borderColor).toBe(COLOR.edge);
    expect(container.querySelector('.sec-head__sender')?.textContent).toBe('Alice Chen');
    // A glance, not a manifest: the full list is in the hover tooltip.
    expect(container.querySelector('.sec-head__to')?.textContent).toBe('→ bob');
  });

  it('lays the reader’s own message out on the right, without a sender colour', () => {
    const { container } = render(
      <ChatBubble
        message={chatMessage({ isFromMe: true })}
        color={COLOR}
        labels={DEFAULT_LABELS}
        {...FIXED}
      />,
    );
    expect(container.querySelector('.sec-row')?.className).toBe('sec-row sec-row--mine');
    // The reader's own bubble is the brand tint from the stylesheet; an
    // identity colour on top of it would make the reader look like a stranger.
    expect((container.querySelector('.sec-bubble') as HTMLElement).style.backgroundColor).toBe('');
    expect(
      (container.querySelector('.sec-avatar') as HTMLElement).getAttribute('style'),
    ).toBeNull();
  });

  // Regression: attributing someone else's mail to the reader is a much worse
  // error than a thread that is flat on one side, so an unknown `isFromMe`
  // must fall to the left — never to the right.
  it('keeps an unattributed message on the left', () => {
    const { container } = render(
      <ChatBubble
        message={chatMessage({ isFromMe: undefined })}
        labels={DEFAULT_LABELS}
        {...FIXED}
      />,
    );
    expect(container.querySelector('.sec-row')?.className).toContain('sec-row--theirs');
  });

  // Regression: a message whose recipients the store never captured (a lone
  // draft, an import that dropped the To header) must not render a dangling
  // "→" with nothing after it.
  it('leaves the arrow off when it has no recipients to name', () => {
    const { container } = render(
      <ChatBubble
        message={chatMessage({ toAddress: '', toNames: '', ccAddress: '', ccNames: '' })}
        labels={DEFAULT_LABELS}
        {...FIXED}
      />,
    );
    expect(container.querySelector('.sec-head__sender')?.textContent).toBe('Alice Chen');
    expect(container.querySelector('.sec-head__to')).toBeNull();
  });

  // Regression: the "+23 others" count is what a one-string header loses to the
  // ellipsis, and it is the only part of the run the reader cannot reconstruct.
  // It has to be its own element so the stylesheet can shrink the names around
  // it — see `.sec-head__more`.
  it('puts the overflow count in an element the names cannot squeeze out', () => {
    const { container } = render(
      <ChatBubble
        message={chatMessage({
          toAddress: 'ankur.d@acme.example, bob@acme.example, carol@acme.example',
          toNames: 'Ankur Dubey, Bob Ray, Carol Diaz',
        })}
        labels={DEFAULT_LABELS}
        {...FIXED}
      />,
    );
    expect(container.querySelector('.sec-head__names')?.textContent).toBe('→ Ankur, Bob');
    expect(container.querySelector('.sec-head__more')?.textContent).toBe('+1 others');
  });

  it('renders no count element when every recipient is named', () => {
    const { container } = render(
      <ChatBubble message={chatMessage()} labels={DEFAULT_LABELS} {...FIXED} />,
    );
    expect(container.querySelector('.sec-head__more')).toBeNull();
  });

  it('lets the host decide whose message it is', () => {
    const { container } = render(
      <ChatBubble
        message={chatMessage({ isFromMe: false })}
        mine
        labels={DEFAULT_LABELS}
        {...FIXED}
      />,
    );
    expect(container.querySelector('.sec-row')?.className).toContain('sec-row--mine');
  });

  // CHANGED BEHAVIOUR (was: 'drops the header and the tail for a follow-up in
  // a run', which asserted no header at all). A follower now keeps a slim
  // header with its own time: with none, the same message sent twice a minute
  // apart showed as a second bubble with no time and no sender — and with the
  // host's shield floating alone above it — which read as a broken row.
  //
  // Regression: the follower still drops the avatar, the sender and the
  // recipients, which the run's first bubble already gave; but the avatar's
  // SPACE has to stay or every bubble after the first steps out of the run's
  // column. The tail corner goes too — that is what makes a run read as one
  // utterance rather than three.
  it('keeps only its own time, and drops the name and the tail, for a follow-up in a run', () => {
    const { container } = render(
      <ChatBubble message={chatMessage()} compact labels={DEFAULT_LABELS} {...FIXED} />,
    );
    const head = container.querySelector('.sec-head') as HTMLElement;
    expect(head.className).toBe('sec-head sec-head--run');
    expect([...head.children].map((child) => child.className)).toEqual(['sec-head__time']);
    expect(head.textContent).toBe('10:00');
    expect(container.querySelector('.sec-head__who')).toBeNull();
    expect(container.querySelector('.sec-head__sender')).toBeNull();
    expect(container.querySelector('.sec-head__to')).toBeNull();
    expect(container.querySelector('.sec-avatar--spacer')).not.toBeNull();
    expect(container.querySelector('.sec-bubble')?.className).not.toContain('sec-bubble--tail');
  });

  // Regression: the follower's time must be the full header's time element,
  // not a second copy of it — a copy is how the two come to disagree about
  // the zone, the format or the `~` on an inferred date, and a run then reads
  // as if its messages were sent at times they were not.
  it('marks up a follow-up’s time exactly as a full header does', () => {
    for (const message of [chatMessage(), chatMessage({ dateApprox: true })]) {
      const full = render(<ChatBubble message={message} labels={DEFAULT_LABELS} {...FIXED} />);
      const expected = (full.container.querySelector('time') as HTMLTimeElement).outerHTML;
      full.unmount();
      const follower = render(
        <ChatBubble message={message} compact labels={DEFAULT_LABELS} {...FIXED} />,
      );
      expect(
        (follower.container.querySelector('.sec-head--run time') as HTMLElement).outerHTML,
      ).toBe(expected);
      follower.unmount();
    }
  });

  // Regression: with no readable date and no marks there is nothing to put on
  // the follower's header, and an empty one is a blank line above the bubble
  // that reopens the gap the run closed.
  it('renders no header on a follow-up with no readable time and no marks', () => {
    const { container } = render(
      <ChatBubble
        message={chatMessage({ date: Number.NaN })}
        compact
        labels={DEFAULT_LABELS}
        renderHeaderMeta={() => null}
        {...FIXED}
      />,
    );
    expect(container.querySelector('.sec-head')).toBeNull();
  });

  // Regression: a framed body needs a sized containing block, so its bubble
  // takes the full column. A short reply hugs its text — which is what makes a
  // two-word answer look like a two-word answer instead of a banner.
  it('hugs a short reply and widens for a framed body', () => {
    const short = render(<ChatBubble message={chatMessage()} labels={DEFAULT_LABELS} {...FIXED} />);
    expect(short.container.querySelector('.sec-col')?.className).toBe('sec-col sec-col--hug');
    expect(short.container.querySelector('.sec-bubble')?.className).not.toContain('--wide');
    short.unmount();

    const rich = render(
      <ChatBubble
        message={chatMessage({ body: '<table><tr><td>Hi</td></tr></table>' })}
        labels={DEFAULT_LABELS}
        {...FIXED}
      />,
    );
    expect(rich.container.querySelector('.sec-col')?.className).toBe('sec-col');
    expect(rich.container.querySelector('.sec-bubble')?.className).toContain('sec-bubble--wide');
  });

  // CHANGED BEHAVIOUR (was: 'drops the sender tint ... for a designed mail').
  // The tint used to be dropped here on the grounds that a designed mail brings
  // its own background, so tinting it would read as a card inside a card. In
  // practice most mail leaves large areas transparent, so what the reader got
  // was an untinted white card in a column of coloured ones — the one message
  // type whose sender you could not identify at a glance. The tint now stays;
  // where the mail does paint its own background it simply covers it, and the
  // colours it paints into table cells are softened inside the frame
  // (`buildFrameCss`) so they read as pastels rather than competing with it.
  //
  // Regression: the padding removal still hangs off `--doc`, so that class must
  // stay on or a framed body gets a chat line's padding around it.
  it('carries the sender tint and loses the bubble padding for a designed mail', () => {
    const { container } = render(
      <ChatBubble
        message={chatMessage({ body: '<table><tr><td>Approve</td></tr></table>' })}
        color={COLOR}
        labels={DEFAULT_LABELS}
        {...FIXED}
      />,
    );
    const bubble = container.querySelector('.sec-bubble') as HTMLElement;
    expect(bubble.className).toContain('sec-bubble--doc');
    expect(bubble.style.backgroundColor).toBe(COLOR.bubble);
    // Regression: the wash alone is not enough here and the fix is incomplete
    // without this. A designed mail is rendered verbatim and paints its own
    // surface edge to edge over the tint, so the border is the only part of
    // the bubble the sender's colour still reaches — drop it and the reader is
    // back to a white card in a column of coloured ones.
    expect(bubble.style.borderColor).toBe(COLOR.edge);
    // Regression: the frame's page is painted by `SandboxedBody`, several
    // components down, so the colour reaches it as an inherited custom property
    // rather than a prop. Drop it and the page falls back to the app surface —
    // a white slab inside the sender's mat, which is what this replaced.
    expect(bubble.style.getPropertyValue('--sec-doc-page')).toBe(COLOR.page);
    // The avatar keeps carrying the same colour, so bubble and avatar agree.
    expect((container.querySelector('.sec-avatar') as HTMLElement).style.backgroundColor).toBe(
      COLOR.avatar,
    );
  });

  // Regression: the reader's OWN designed mail has no per-sender colour object
  // (`isMine` suppresses it), so an inline tint here would be `undefined` and
  // the bubble would fall through to whatever `--doc` sets. It must stay
  // uninlined so the stylesheet's own `--mine` document rule can colour it.
  it('leaves a designed mail of my own to the stylesheet', () => {
    const { container } = render(
      <ChatBubble
        message={chatMessage({ body: '<table><tr><td>Approve</td></tr></table>', isFromMe: true })}
        labels={DEFAULT_LABELS}
        {...FIXED}
      />,
    );
    const bubble = container.querySelector('.sec-bubble') as HTMLElement;
    expect(bubble.className).toContain('sec-bubble--doc');
    expect(bubble.className).toContain('sec-bubble--mine');
    expect(bubble.style.backgroundColor).toBe('');
  });

  // Regression: `--doc` is the framed-body marker, so an inline reply must
  // never carry it — a plain bubble with no padding collapses onto its text.
  it('keeps the tinted, padded bubble for an inline reply', () => {
    const { container } = render(
      <ChatBubble message={chatMessage()} color={COLOR} labels={DEFAULT_LABELS} {...FIXED} />,
    );
    const bubble = container.querySelector('.sec-bubble') as HTMLElement;
    expect(bubble.className).not.toContain('sec-bubble--doc');
    expect(bubble.style.backgroundColor).toBe(COLOR.bubble);
  });

  // Regression: THE "big thread breaks" bug, from the outside. A letter is
  // long, not designed: it brings no background and no margins of its own, so
  // the document treatment — no padding, no tint, no shadow, content to the
  // card's edge — leaves the reader looking at text jammed against a bare
  // border. It must render as an ordinary bubble, inline.
  it('keeps a long text-only mail an ordinary padded, tinted bubble', () => {
    const body = `<p>${'Thanks for the update, I will take a look today. '.repeat(12)}</p>`;
    const { container } = render(
      <ChatBubble
        message={chatMessage({ body })}
        color={COLOR}
        labels={DEFAULT_LABELS}
        {...FIXED}
      />,
    );
    const bubble = container.querySelector('.sec-bubble') as HTMLElement;
    expect(bubble.className).not.toContain('sec-bubble--doc');
    expect(bubble.style.backgroundColor).toBe(COLOR.bubble);
    // Inline, so the words are in the host's own DOM rather than an iframe the
    // reader cannot select across.
    expect(container.querySelector('.sec-body')).not.toBeNull();
    expect(container.querySelector('.sec-frame')).toBeNull();
    // Still too long to hug: a letter wrapped in a column the width of its
    // longest paragraph is the other half of this looking wrong.
    expect(bubble.className).toContain('sec-bubble--wide');
  });

  // Regression: end-to-end cover for the "screenful of blank under the last
  // line" bug. The bubble must render the SHAPE's html, not `message.body` —
  // wire it to the original and the trailing empty wrappers come back, and a
  // bubble is sized to its content, so the reader sees the gap.
  it('renders the body without the dead space on the end of it', () => {
    const { container } = render(
      <ChatBubble
        message={chatMessage({ body: '<p>Thanks!</p><div><br></div><div>&nbsp;</div>' })}
        labels={DEFAULT_LABELS}
        {...FIXED}
      />,
    );
    expect(container.querySelector('.sec-body')?.innerHTML).toBe('<p>Thanks!</p>');
  });

  describe('the timestamp', () => {
    it('shows the time, machine-readable in UTC and readable in the reader’s zone', () => {
      const { container } = render(
        <ChatBubble message={chatMessage()} labels={DEFAULT_LABELS} {...FIXED} />,
      );
      const time = container.querySelector('time') as HTMLTimeElement;
      expect(time.textContent).toBe('10:00');
      // Stored and marked up as UTC; rendered in local time beside it. This is
      // what makes the same thread read correctly in every zone.
      expect(time.getAttribute('datetime')).toBe(new Date(chatMessage().date).toISOString());
      expect(time.getAttribute('title')).toContain('3 March 2026');
    });

    // Regression: `new Date(NaN).toISOString()` THROWS, and mail stores carry
    // unparseable dates constantly. The element is skipped rather than guarded
    // downstream, so one bad header cannot take the bubble down.
    it('renders no time element at all for a date it cannot read', () => {
      const { container } = render(
        <ChatBubble
          message={chatMessage({ date: Number.NaN })}
          labels={DEFAULT_LABELS}
          {...FIXED}
        />,
      );
      expect(container.querySelector('time')).toBeNull();
    });

    // Regression: a message recovered from a quote is dated from the mail that
    // quoted it. Rendered as an exact time it reads as fact, and a reader
    // checking a bubble against their calendar has nothing to warn them.
    it('marks a time the transform inferred', () => {
      const { container } = render(
        <ChatBubble
          message={chatMessage({ dateApprox: true })}
          labels={DEFAULT_LABELS}
          {...FIXED}
        />,
      );
      const time = container.querySelector('time') as HTMLTimeElement;
      expect(time.textContent).toBe('~10:00');
      expect(time.getAttribute('title')).toContain(DEFAULT_LABELS.approximateTime);
    });
  });

  describe('attachments', () => {
    // Regression: two `image001.png` in one message is ordinary (a signature
    // logo forwarded twice). Keyed on the filename alone, React renders one.
    it('renders every attachment even when two share a filename', () => {
      const attachment = { filename: 'image001.png', mimeType: 'image/png' };
      const { container } = render(
        <ChatBubble
          message={chatMessage({ attachments: [attachment, attachment] })}
          labels={DEFAULT_LABELS}
          {...FIXED}
        />,
      );
      expect(container.querySelectorAll('.sec-chip')).toHaveLength(2);
    });

    it('reports a preview and a download with the message they belong to', () => {
      const onPreviewAttachment = vi.fn();
      const onDownloadAttachment = vi.fn();
      const attachment = { filename: 'report.pdf', mimeType: 'application/pdf' };
      const message = chatMessage({ attachments: [attachment] });
      render(
        <ChatBubble
          message={message}
          labels={DEFAULT_LABELS}
          onPreviewAttachment={onPreviewAttachment}
          onDownloadAttachment={onDownloadAttachment}
          {...FIXED}
        />,
      );
      fireEvent.click(screen.getByLabelText('Preview: report.pdf'));
      fireEvent.click(screen.getByLabelText('Download: report.pdf'));
      // The message goes with it: a host fetching bytes needs the UID, not
      // just a filename.
      expect(onPreviewAttachment).toHaveBeenCalledWith(attachment, message);
      expect(onDownloadAttachment).toHaveBeenCalledWith(attachment, message);
    });

    it('renders no attachment strip when there are none', () => {
      const { container } = render(
        <ChatBubble message={chatMessage()} labels={DEFAULT_LABELS} {...FIXED} />,
      );
      expect(container.querySelector('.sec-attachments')).toBeNull();
    });
  });

  // Regression: the audit trail, in the DOM. "Why did part of my email
  // disappear?" is answerable with devtools instead of a rebuild.
  it('records which rules were applied to the body', () => {
    const { container } = render(
      <ChatBubble
        message={chatMessage({ applied: ['gmail:quote', 'signature:dashes'] })}
        labels={DEFAULT_LABELS}
        {...FIXED}
      />,
    );
    expect(container.querySelector('.sec-bubble')?.getAttribute('data-sec-applied')).toBe(
      'gmail:quote signature:dashes',
    );
  });

  it('records nothing when no rule touched the body', () => {
    const untouched = render(
      <ChatBubble message={chatMessage()} labels={DEFAULT_LABELS} {...FIXED} />,
    );
    expect(untouched.container.querySelector('.sec-bubble')?.hasAttribute('data-sec-applied')).toBe(
      false,
    );
    untouched.unmount();

    const empty = render(
      <ChatBubble message={chatMessage({ applied: [] })} labels={DEFAULT_LABELS} {...FIXED} />,
    );
    expect(empty.container.querySelector('.sec-bubble')?.hasAttribute('data-sec-applied')).toBe(
      false,
    );
  });

  // Regression: everything application-specific — reply, star, an AI re-run, a
  // reply box — is a host slot. A bubble that reached for `window.open` or an
  // IPC channel of its own would work in exactly one application.
  it('renders the host’s own actions and footer', () => {
    const message = chatMessage();
    const { container } = render(
      <ChatBubble
        message={message}
        labels={DEFAULT_LABELS}
        renderActions={(each) => <button type="button">star {each.id}</button>}
        renderFooter={(each) => <div className="host-footer">reply to {each.id}</div>}
        {...FIXED}
      />,
    );
    expect(screen.getByRole('button', { name: 'star m1' })).not.toBeNull();
    // The footer belongs INSIDE the bubble; the actions belong outside it.
    expect(container.querySelector('.sec-bubble .host-footer')).not.toBeNull();
    expect(container.querySelector('.sec-actions')?.textContent).toBe('star m1');
  });

  describe('quick actions', () => {
    const quick = (each: ChatMessage) => <button type="button">reply {each.id}</button>;
    /** A body the view frames: a designed mail, in a `--doc` bubble. */
    const DOCUMENT = '<table><tr><td>Approve</td></tr></table>';

    // Regression: the cluster is positioned against its anchor, so the anchor
    // must wrap exactly the bubble — and a short reply's anchor must HUG it.
    // Anchored to the column instead, the buttons float in empty space beside
    // a two-word reply whenever the header above it is wider.
    it('anchors the host’s quick actions to a short bubble’s own box', () => {
      const { container } = render(
        <ChatBubble
          message={chatMessage()}
          labels={DEFAULT_LABELS}
          renderQuickActions={quick}
          {...FIXED}
        />,
      );
      const anchor = container.querySelector('.sec-col--hug > .sec-bubble-anchor') as HTMLElement;
      expect(anchor.className).toBe('sec-bubble-anchor');
      // The bubble, then the cluster — and nothing else in the positioning box.
      expect([...anchor.children].map((child) => child.classList[0])).toEqual([
        'sec-bubble',
        'sec-quick',
      ]);
      expect(anchor.querySelector('.sec-quick')?.textContent).toBe('reply m1');
    });

    // Regression: a document bubble is `overflow: hidden`, so a cluster placed
    // INSIDE it has the half that straddles the bottom edge cut off. It has to
    // be the bubble's sibling, in an anchor that spans the column the way the
    // wide bubble does.
    it('keeps them outside a document bubble, which clips what it holds', () => {
      const { container } = render(
        <ChatBubble
          message={chatMessage({ body: DOCUMENT })}
          labels={DEFAULT_LABELS}
          renderQuickActions={quick}
          {...FIXED}
        />,
      );
      const anchor = container.querySelector('.sec-bubble-anchor') as HTMLElement;
      expect(anchor.className).toBe('sec-bubble-anchor sec-bubble-anchor--wide');
      expect(anchor.querySelector(':scope > .sec-bubble--doc')).not.toBeNull();
      expect(anchor.querySelector(':scope > .sec-quick')).not.toBeNull();
      expect(container.querySelector('.sec-bubble .sec-quick')).toBeNull();
    });

    // Regression: a long letter is wide but not a document; its anchor must
    // widen with it or the bubble's `width: 100%` resolves against a
    // shrink-wrapped box.
    it('widens the anchor with a long inline bubble', () => {
      const body = `<p>${'Thanks for the update, I will take a look today. '.repeat(12)}</p>`;
      const { container } = render(
        <ChatBubble
          message={chatMessage({ body })}
          labels={DEFAULT_LABELS}
          renderQuickActions={quick}
          {...FIXED}
        />,
      );
      expect(container.querySelector('.sec-bubble-anchor')?.className).toBe(
        'sec-bubble-anchor sec-bubble-anchor--wide',
      );
    });

    // Regression: reply and forward apply to the reader's own messages too;
    // a slot that only rendered on the other side would hide half the thread's
    // actions.
    it('puts them on the reader’s own bubbles too', () => {
      const { container } = render(
        <ChatBubble
          message={chatMessage({ isFromMe: true })}
          labels={DEFAULT_LABELS}
          renderQuickActions={quick}
          {...FIXED}
        />,
      );
      expect(
        container.querySelector('.sec-row--mine .sec-bubble-anchor .sec-quick'),
      ).not.toBeNull();
    });

    // Regression: other hosts style `.sec-col > .sec-bubble`. A host that uses
    // no quick actions must get exactly the DOM it had before they existed.
    it('changes nothing about the DOM without the slot', () => {
      const { container } = render(
        <ChatBubble message={chatMessage()} labels={DEFAULT_LABELS} {...FIXED} />,
      );
      expect(container.querySelector('.sec-bubble-anchor')).toBeNull();
      expect(container.querySelector('.sec-quick')).toBeNull();
      expect(container.querySelector('.sec-col > .sec-bubble')).not.toBeNull();
    });

    // Regression: a recovered quote has no mail to reply to, and the host says
    // so by returning nothing. An empty cluster would still be a hover target
    // over the bubble's corner, and an anchor would still change the DOM.
    it.each([null, undefined, false])(
      'renders no wrapper at all when the host returns %s',
      (value) => {
        const { container } = render(
          <ChatBubble
            message={chatMessage()}
            labels={DEFAULT_LABELS}
            renderQuickActions={() => value}
            {...FIXED}
          />,
        );
        expect(container.querySelector('.sec-bubble-anchor')).toBeNull();
        expect(container.querySelector('.sec-quick')).toBeNull();
        expect(container.querySelector('.sec-col > .sec-bubble')).not.toBeNull();
      },
    );

    // Regression: the two slots are different places. The row actions stay on
    // the column's outer edge, not inside the bubble's anchor.
    it('leaves the row actions where they were', () => {
      const { container } = render(
        <ChatBubble
          message={chatMessage()}
          labels={DEFAULT_LABELS}
          renderQuickActions={quick}
          renderActions={() => <button type="button">star</button>}
          {...FIXED}
        />,
      );
      expect(container.querySelector('.sec-col > .sec-actions')?.textContent).toBe('star');
      expect(container.querySelector('.sec-bubble-anchor .sec-actions')).toBeNull();
    });

    // Regression: hosts pass an inline arrow function, a new identity every
    // render. If that alone re-mounted the bubble, every framed mail in the
    // thread would reload — and blank — on every re-render of the list.
    it('keeps the same bubble across re-renders while there are quick actions', () => {
      const message = chatMessage({ body: DOCUMENT });
      const { container, rerender } = render(
        <ChatBubble
          message={message}
          labels={DEFAULT_LABELS}
          renderQuickActions={(each) => quick(each)}
          {...FIXED}
        />,
      );
      const frame = container.querySelector('iframe');
      rerender(
        <ChatBubble
          message={message}
          labels={DEFAULT_LABELS}
          renderQuickActions={(each) => quick(each)}
          {...FIXED}
        />,
      );
      expect(container.querySelector('iframe')).toBe(frame);
    });

    // KNOWN GAP, deliberate: "no wrapper at all when the answer is null" means
    // the anchor comes and goes with the answer, and React re-parents the
    // bubble when it does — a framed body reloads once. The README tells hosts
    // to decide per message, not per render (an answer that waits on async
    // data flips once). If the anchor is ever made unconditional, this test
    // changes with it, deliberately.
    it('known gap: re-mounts the bubble when the answer flips between null and a node', () => {
      const message = chatMessage({ body: DOCUMENT });
      const { container, rerender } = render(
        <ChatBubble
          message={message}
          labels={DEFAULT_LABELS}
          renderQuickActions={() => null}
          {...FIXED}
        />,
      );
      const frame = container.querySelector('iframe');
      rerender(
        <ChatBubble
          message={message}
          labels={DEFAULT_LABELS}
          renderQuickActions={quick}
          {...FIXED}
        />,
      );
      expect(container.querySelector('.sec-bubble-anchor iframe')).not.toBeNull();
      expect(container.querySelector('iframe')).not.toBe(frame);
    });
  });

  describe('onMessageMenu', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      window.getSelection()?.removeAllRanges();
    });

    const LINKED = '<p>See <a href="https://x.example/a"><b>the plan</b></a></p>';

    // Regression: a right-click on a message is the host's to answer — with
    // the message it was on, where to open the menu, and the link under the
    // pointer — and the browser's own menu must not open on top of the host's.
    it('reports a right-click on the body and suppresses the browser’s menu', () => {
      const onMessageMenu = vi.fn();
      const message = chatMessage({ body: LINKED });
      const { container } = render(
        <ChatBubble
          message={message}
          labels={DEFAULT_LABELS}
          onMessageMenu={onMessageMenu}
          {...FIXED}
        />,
      );
      const opened = fireEvent.contextMenu(container.querySelector('b') as Element, {
        clientX: 12,
        clientY: 34,
      });
      expect(onMessageMenu).toHaveBeenCalledWith(message, {
        clientX: 12,
        clientY: 34,
        href: 'https://x.example/a',
        selectionText: '',
      });
      // `fireEvent` returns false when the default was prevented.
      expect(opened).toBe(false);
    });

    // Regression: the header is part of the message — right-clicking the
    // sender's name is as natural a way to ask for "reply" as the body is.
    it('reports a right-click on the header', () => {
      const onMessageMenu = vi.fn();
      const { container } = render(
        <ChatBubble
          message={chatMessage()}
          labels={DEFAULT_LABELS}
          onMessageMenu={onMessageMenu}
          {...FIXED}
        />,
      );
      fireEvent.contextMenu(container.querySelector('.sec-head__sender') as Element);
      expect(onMessageMenu).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'm1' }),
        expect.objectContaining({ href: null }),
      );
    });

    // Regression: "Copy" on a menu is useless without the text the reader
    // selected in this message.
    it('reports the reader’s selection inside the message', () => {
      const onMessageMenu = vi.fn();
      const { container } = render(
        <ChatBubble
          message={chatMessage()}
          labels={DEFAULT_LABELS}
          onMessageMenu={onMessageMenu}
          {...FIXED}
        />,
      );
      const paragraph = container.querySelector('.sec-body p') as Element;
      window.getSelection()?.selectAllChildren(paragraph);
      fireEvent.contextMenu(paragraph);
      expect(onMessageMenu.mock.calls[0]?.[1].selectionText).toBe('Sounds good — see you at 4.');
    });

    // Regression: a selection left in one bubble while the reader right-clicks
    // another must not be offered — "Copy" would copy a different message.
    it('does not report a selection that lies in another message', () => {
      const onMessageMenu = vi.fn();
      const { container } = render(
        <>
          <ChatBubble
            message={chatMessage({ id: 'a', body: '<p>From the first</p>' })}
            labels={DEFAULT_LABELS}
            onMessageMenu={onMessageMenu}
            {...FIXED}
          />
          <ChatBubble
            message={chatMessage({ id: 'b', body: '<p>From the second</p>' })}
            labels={DEFAULT_LABELS}
            onMessageMenu={onMessageMenu}
            {...FIXED}
          />
        </>,
      );
      const [first, second] = [...container.querySelectorAll('.sec-body p')] as Element[];
      window.getSelection()?.selectAllChildren(first as Element);
      fireEvent.contextMenu(second as Element);
      expect(onMessageMenu).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'b' }),
        expect.objectContaining({ selectionText: '' }),
      );
    });

    // Regression: a host with nothing to offer declines — a web host with no
    // menu for plain text, say — and then the browser's own menu must still
    // open. Suppressed anyway, the reader gets no menu at all.
    it('leaves the browser’s menu alone when the host declines', () => {
      const onMessageMenu = vi.fn(() => false);
      const { container } = render(
        <ChatBubble
          message={chatMessage()}
          labels={DEFAULT_LABELS}
          onMessageMenu={onMessageMenu}
          {...FIXED}
        />,
      );
      expect(fireEvent.contextMenu(container.querySelector('.sec-body') as Element)).toBe(true);
      expect(onMessageMenu).toHaveBeenCalledTimes(1);
    });

    // Regression: a host that never asked for right-clicks must not lose the
    // browser's menu on every message.
    it('changes nothing without a handler', () => {
      const { container } = render(
        <ChatBubble message={chatMessage({ body: LINKED })} labels={DEFAULT_LABELS} {...FIXED} />,
      );
      expect(fireEvent.contextMenu(container.querySelector('b') as Element)).toBe(true);
    });

    // Regression: the host's own controls are not the message. A message menu
    // opening over a reply button fights whatever the button's own
    // right-click does, and hides the button the reader was aiming at.
    it('ignores a right-click on the host’s row actions and quick actions', () => {
      const onMessageMenu = vi.fn();
      render(
        <ChatBubble
          message={chatMessage()}
          labels={DEFAULT_LABELS}
          onMessageMenu={onMessageMenu}
          renderActions={() => <button type="button">star</button>}
          renderQuickActions={() => (
            <button type="button">
              <i>reply</i>
            </button>
          )}
          {...FIXED}
        />,
      );
      expect(fireEvent.contextMenu(screen.getByRole('button', { name: 'star' }))).toBe(true);
      // Inside a control, not just on it.
      expect(fireEvent.contextMenu(screen.getByText('reply'))).toBe(true);
      expect(onMessageMenu).not.toHaveBeenCalled();
    });

    // Regression: React bubbles a PORTAL's events through the component tree.
    // A host dropdown portalled to `document.body` from one of the slots
    // arrives at the bubble's handler although nothing under the pointer is
    // the message — and a right-click in that dropdown opened a message menu
    // over it.
    it('ignores a right-click inside something the host portals out of the bubble', () => {
      const onMessageMenu = vi.fn();
      // A layer of the host's own, as a menu library would create. Not
      // `document.body` itself: the suite clears the body before React
      // unmounts, which would pull the portal's child out from under it.
      const layer = document.createElement('div');
      document.body.append(layer);
      render(
        <ChatBubble
          message={chatMessage()}
          labels={DEFAULT_LABELS}
          onMessageMenu={onMessageMenu}
          renderFooter={() => createPortal(<button type="button">dropdown item</button>, layer)}
          {...FIXED}
        />,
      );
      const item = screen.getByRole('button', { name: 'dropdown item' });
      expect(item.closest('.sec-row')).toBeNull();
      expect(fireEvent.contextMenu(item)).toBe(true);
      expect(onMessageMenu).not.toHaveBeenCalled();
    });

    // Regression: a framed body is a separate document, so its right-click
    // never reaches the column's handler — the frame has to report it, with
    // the point translated into the page and the message attached.
    it('reports a right-click inside a framed body, in the page’s coordinates', async () => {
      const onMessageMenu = vi.fn();
      const message = chatMessage({ body: '<table><tr><td>Approve</td></tr></table>' });
      const { container } = render(
        <ChatBubble
          message={message}
          labels={DEFAULT_LABELS}
          onMessageMenu={onMessageMenu}
          {...FIXED}
        />,
      );
      const frame = container.querySelector('iframe') as HTMLIFrameElement;
      const doc = await loadedFrameDocument(frame, LINKED);
      placeFrame(frame, 40, 60);
      const event = rightClick(doc.querySelector('b') as Element, 5, 6);
      expect(onMessageMenu).toHaveBeenCalledWith(message, {
        clientX: 45,
        clientY: 66,
        href: 'https://x.example/a',
        selectionText: '',
      });
      expect(event.defaultPrevented).toBe(true);
    });

    // Regression: the bubble wraps `onMessageMenu` for the frame, and a wrapper
    // that dropped its return value swallowed the host's `false` — a web host
    // declining a right-click inside a framed mail lost the browser's menu
    // there, while the same decline worked on an inline body.
    it('passes the host’s decline through from inside a framed body', async () => {
      const onMessageMenu = vi.fn(() => false);
      const { container } = render(
        <ChatBubble
          message={chatMessage({ body: '<table><tr><td>Approve</td></tr></table>' })}
          labels={DEFAULT_LABELS}
          onMessageMenu={onMessageMenu}
          {...FIXED}
        />,
      );
      const frame = container.querySelector('iframe') as HTMLIFrameElement;
      const doc = await loadedFrameDocument(frame, LINKED);
      const event = rightClick(doc.querySelector('b') as Element, 5, 6);
      expect(onMessageMenu).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(false);
    });

    // Regression: host content inside the message — an inline reply editor in
    // the footer — can answer a right-click with a menu of its own. React
    // still bubbles the event up to the column, and the message menu opened
    // as a second menu on top of the editor's.
    it('stays out of a right-click that something inside the message already handled', () => {
      const onMessageMenu = vi.fn();
      render(
        <ChatBubble
          message={chatMessage()}
          labels={DEFAULT_LABELS}
          onMessageMenu={onMessageMenu}
          renderFooter={() => (
            <div onContextMenu={(event) => event.preventDefault()}>
              <span>draft</span>
            </div>
          )}
          {...FIXED}
        />,
      );
      fireEvent.contextMenu(screen.getByText('draft'));
      expect(onMessageMenu).not.toHaveBeenCalled();
    });

    // Regression: a text field's own menu — paste, spelling suggestions — is
    // what the reader right-clicked it for. A message menu opening in its
    // place, with the browser's suppressed, left a reply box with no paste.
    it('leaves a right-click in a text field to the field', () => {
      const onMessageMenu = vi.fn();
      render(
        <ChatBubble
          message={chatMessage()}
          labels={DEFAULT_LABELS}
          onMessageMenu={onMessageMenu}
          renderFooter={() => (
            <>
              <textarea aria-label="reply" />
              <input aria-label="subject" />
              <div contentEditable suppressContentEditableWarning>
                <b>typed</b>
              </div>
            </>
          )}
          {...FIXED}
        />,
      );
      expect(fireEvent.contextMenu(screen.getByLabelText('reply'))).toBe(true);
      expect(fireEvent.contextMenu(screen.getByLabelText('subject'))).toBe(true);
      // Inside a rich editor, not just on it.
      expect(fireEvent.contextMenu(screen.getByText('typed'))).toBe(true);
      expect(onMessageMenu).not.toHaveBeenCalled();
    });
  });

  // Regression: a per-message mark belongs on the metadata line the reader
  // already reads to answer "who is this from, and when". Rendered under the
  // body it reads as part of the message — which is how a shield that judges
  // the mail comes to look like something the SENDER wrote.
  it('renders the host’s header meta after the timestamp', () => {
    const { container } = render(
      <ChatBubble
        message={chatMessage()}
        labels={DEFAULT_LABELS}
        renderHeaderMeta={(each) => <i className="host-shield">shield {each.id}</i>}
        {...FIXED}
      />,
    );
    const head = container.querySelector('.sec-head') as HTMLElement;
    const children = [...head.children];
    expect(container.querySelector('.sec-head__meta .host-shield')?.textContent).toBe('shield m1');
    // AFTER the time, not before it: the mark qualifies the header, it does
    // not interrupt it.
    expect(children.indexOf(head.querySelector('.sec-head__meta') as Element)).toBe(
      children.indexOf(head.querySelector('.sec-head__time') as Element) + 1,
    );
  });

  // Regression: a run follower drops its sender because that is INHERITED
  // from the run's first bubble. A per-message judgement is not, so it still
  // renders. Drop it silently and a reader comes to believe every message in a
  // run carried the mark the first one did.
  //
  // CHANGED BEHAVIOUR: the mark used to sit alone on a `--meta-only` row with
  // no time, and a shield floating by itself above a bubble read as a broken
  // header. It now follows the follower's own time, as on a full header.
  it('keeps the header meta on a follow-up in a run, after its own time', () => {
    const { container } = render(
      <ChatBubble
        message={chatMessage()}
        compact
        labels={DEFAULT_LABELS}
        renderHeaderMeta={() => <i className="host-shield">shield</i>}
        {...FIXED}
      />,
    );
    const head = container.querySelector('.sec-head') as HTMLElement;
    expect(head.className).toBe('sec-head sec-head--run');
    expect([...head.children].map((child) => child.className)).toEqual([
      'sec-head__time',
      'sec-head__meta',
    ]);
    expect(head.querySelector('.sec-head__meta .host-shield')).not.toBeNull();
    // Still no sender — the time and the mark, nothing the run already said.
    expect(head.querySelector('.sec-head__sender')).toBeNull();
  });

  // Regression: an unreadable date must not cost a follower its marks — the
  // judgement matters most on exactly the mail whose headers are malformed.
  it('keeps a follow-up’s marks when its time cannot be read', () => {
    const { container } = render(
      <ChatBubble
        message={chatMessage({ date: Number.NaN })}
        compact
        labels={DEFAULT_LABELS}
        renderHeaderMeta={() => <i className="host-shield">shield</i>}
        {...FIXED}
      />,
    );
    const head = container.querySelector('.sec-head--run') as HTMLElement;
    expect([...head.children].map((child) => child.className)).toEqual(['sec-head__meta']);
    expect(head.querySelector('time')).toBeNull();
  });

  // Regression: a host that has nothing to say about THIS message returns
  // nothing, and must not get an empty wrapper for it — an empty flex item on
  // the header line is a stray gap beside the time.
  it('renders no meta element when the host returns nothing', () => {
    const { container } = render(
      <ChatBubble
        message={chatMessage()}
        compact
        labels={DEFAULT_LABELS}
        renderHeaderMeta={() => null}
        {...FIXED}
      />,
    );
    expect(container.querySelector('.sec-head__meta')).toBeNull();
    // The follower's time is still there: the header is the time's, not the mark's.
    expect(container.querySelector('.sec-head--run')?.textContent).toBe('10:00');
  });

  it('takes a class from its host', () => {
    const { container } = render(
      <ChatBubble
        message={chatMessage()}
        labels={DEFAULT_LABELS}
        className="app-bubble"
        {...FIXED}
      />,
    );
    expect(container.querySelector('.sec-row')?.className).toBe(
      'sec-row sec-row--theirs app-bubble',
    );
  });

  it('passes the body’s callbacks through', () => {
    const onOpenLink = vi.fn();
    const { container } = render(
      <ChatBubble
        message={chatMessage({ body: '<p><a href="https://x.example/a">link</a></p>' })}
        labels={DEFAULT_LABELS}
        onOpenLink={onOpenLink}
        {...FIXED}
      />,
    );
    fireEvent.click(container.querySelector('a') as HTMLElement);
    expect(onOpenLink).toHaveBeenCalledWith('https://x.example/a');
  });

  // Regression: found in Sarv Inbox. The bubble drew its own "Load images"
  // banner and told nobody, so a host with a per-sender allowlist never
  // learned of the click: that one bubble loaded, the sender was never
  // remembered, and their next mail was blocked again.
  it('tells the host which message the reader loaded images for', () => {
    const onLoadRemoteImages = vi.fn();
    const message = chatMessage({
      body: '<table><tr><td><img src="https://cdn.example/logo.png" alt="logo"></td></tr></table>',
    });
    const { container } = render(
      <ChatBubble
        message={message}
        labels={DEFAULT_LABELS}
        onLoadRemoteImages={onLoadRemoteImages}
        {...FIXED}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load images' }));
    expect(onLoadRemoteImages).toHaveBeenCalledTimes(1);
    expect(onLoadRemoteImages).toHaveBeenCalledWith(message);
    expect(container.querySelector('iframe')?.getAttribute('srcdoc')).toContain(
      'img-src data: cid: https: http:',
    );
  });
});

describe('RecipientsSummary', () => {
  it('lists From, To and Cc in full', () => {
    const { container } = render(
      <RecipientsSummary
        message={chatMessage({
          toAddress: 'bob@acme.example, "Chen, Dana" <dana@acme.example>',
          ccAddress: 'eve@acme.example',
          ccNames: 'Eve Stone',
        })}
        labels={DEFAULT_LABELS}
      />,
    );
    const rows = [...container.querySelectorAll('.sec-addr-row')].map((row) => row.textContent);
    expect(rows).toEqual([
      'FromAlice Chen <alice@acme.example>',
      'Tobob@acme.example, Chen, Dana <dana@acme.example>',
      'CcEve Stone <eve@acme.example>',
    ]);
  });

  it('omits a row it has nothing for', () => {
    const { container } = render(
      <RecipientsSummary
        message={chatMessage({ fromAddress: '', fromName: '', toAddress: '' })}
        labels={DEFAULT_LABELS}
      />,
    );
    expect(container.querySelectorAll('.sec-addr-row')).toHaveLength(0);
  });

  it('shows a sender who gave no name by their address alone', () => {
    const { container } = render(
      <RecipientsSummary
        message={chatMessage({ fromName: '', toAddress: '' })}
        labels={DEFAULT_LABELS}
      />,
    );
    expect(container.querySelector('.sec-addr-row')?.textContent).toBe('Fromalice@acme.example');
  });
});
