// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatBubble, RecipientsSummary } from '../../src/components/ChatBubble.js';
import { DEFAULT_LABELS } from '../../src/ui/labels.js';
import { settleFrameLoad } from '../helpers/frames.js';
import { chatMessage, NOW } from '../helpers/messages.js';

/** Plain `rgb()` so jsdom's CSSOM hands the same string back. */
const COLOR = { avatar: 'rgb(1, 2, 3)', bubble: 'rgb(4, 5, 6)', edge: 'rgb(7, 8, 9)', page: 'rgb(10, 11, 12)' };

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

  // Regression: a follow-up in a sender run drops the avatar and the header,
  // but the avatar's SPACE has to stay or every bubble after the first steps
  // out of the run's column. The tail corner goes too — that is what makes a
  // run read as one utterance rather than three.
  it('drops the header and the tail for a follow-up in a run', () => {
    const { container } = render(
      <ChatBubble message={chatMessage()} compact labels={DEFAULT_LABELS} {...FIXED} />,
    );
    expect(container.querySelector('.sec-head')).toBeNull();
    expect(container.querySelector('.sec-avatar--spacer')).not.toBeNull();
    expect(container.querySelector('.sec-bubble')?.className).not.toContain('sec-bubble--tail');
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

  // Regression: a run follower drops its header because sender and time are
  // INHERITED from the run's first bubble. A per-message judgement is not, so
  // it still renders — in a row of its own. Drop it silently and a reader
  // comes to believe every message in a run carried the mark the first one did.
  it('keeps the header meta on a follow-up in a run', () => {
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
    expect(head.className).toBe('sec-head sec-head--meta-only');
    expect(head.querySelector('.host-shield')).not.toBeNull();
    // Still no sender and no time — the row carries the mark and nothing else.
    expect(head.querySelector('.sec-head__sender')).toBeNull();
    expect(head.querySelector('.sec-head__time')).toBeNull();
  });

  // Regression: a host that has nothing to say about THIS message returns
  // nothing, and must not get an empty wrapper for it — on a run follower that
  // would be a blank row above the bubble, opening the gap the run closed.
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
    expect(container.querySelector('.sec-head')).toBeNull();
    expect(container.querySelector('.sec-head__meta')).toBeNull();
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
