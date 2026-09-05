// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MessageBody } from '../../src/components/MessageBody.js';
import { inspectBody, type BodyShape } from '../../src/ui/body-shape.js';
import { DEFAULT_LABELS } from '../../src/ui/labels.js';
import { chatMessage } from '../helpers/messages.js';

/**
 * The real inspection, run in the same environment the component runs in.
 *
 * jsdom has a `DOMParser`, so no parser needs injecting here — and going
 * through `inspectBody` rather than hand-writing a shape is what keeps these
 * tests honest about which state a given body actually lands in.
 */
function shapeOf(body: string | null | undefined): BodyShape {
  return inspectBody(body);
}

function renderBody(body: string, onOpenLink?: (url: string) => void) {
  return render(
    <MessageBody
      message={chatMessage({ body })}
      shape={shapeOf(body)}
      labels={DEFAULT_LABELS}
      onOpenLink={onOpenLink}
    />,
  );
}

describe('MessageBody', () => {
  // Regression: a body still downloading must SAY so. Rendering an empty
  // bubble instead is indistinguishable from a message that had no content,
  // and the reader stops trusting the thread.
  it('says a body is still on its way', () => {
    const message = chatMessage({ body: '', bodyPending: true });
    render(<MessageBody message={message} shape={shapeOf('')} labels={DEFAULT_LABELS} />);
    const note = screen.getByRole('status');
    expect(note.textContent).toContain('Loading content…');
    expect(note.querySelector('.sec-spin')).not.toBeNull();
  });

  // Regression: the streaming contract. Once a body arrives, `bodyPending` may
  // still be set for a tick — the content wins, or a message that has already
  // downloaded flickers back to a spinner.
  it('prefers a body that has arrived over a stale pending flag', () => {
    const message = chatMessage({ body: '<p>arrived</p>', bodyPending: true });
    const { container } = render(
      <MessageBody message={message} shape={shapeOf('<p>arrived</p>')} labels={DEFAULT_LABELS} />,
    );
    expect(container.querySelector('.sec-body')?.textContent).toBe('arrived');
  });

  // Regression: a spinner that never stops is the worst of the failure states —
  // the reader cannot tell whether to keep waiting. A permanent failure has to
  // be stated, and offered a way out.
  it('offers a retry on a body that failed for good', () => {
    const onRetryBody = vi.fn();
    const message = chatMessage({ body: '', bodyFailed: true });
    render(
      <MessageBody
        message={message}
        shape={shapeOf('')}
        labels={DEFAULT_LABELS}
        onRetryBody={onRetryBody}
      />,
    );
    expect(screen.getByText('This message could not be downloaded.')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetryBody).toHaveBeenCalledWith(message);
  });

  it('states the failure without a retry the host cannot serve', () => {
    const message = chatMessage({ body: '', bodyFailed: true });
    render(<MessageBody message={message} shape={shapeOf('')} labels={DEFAULT_LABELS} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  // Regression: a reply whose only content was a quote, or a bare forward,
  // leaves nothing behind after the strip passes. Saying THAT is what stops it
  // reading as a broken message.
  it('explains a message that carried no words of its own', () => {
    const { container } = renderBody('<div><br></div>');
    expect(container.querySelector('.sec-note--quiet')?.textContent).toBe(
      'No new content (forwarded or replied without comment)',
    );
  });

  it('renders a short body inline', () => {
    const { container } = renderBody('<p>Sounds good — see you at 4.</p>');
    expect(container.querySelector('.sec-body')?.innerHTML).toBe(
      '<p>Sounds good — see you at 4.</p>',
    );
    // No frame for a two-line reply: the cost of a document per bubble is only
    // worth paying for a body that would restyle the app.
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('frames a designed body', () => {
    const { container } = renderBody('<table><tr><td>Hi</td></tr></table>');
    expect(container.querySelector('iframe')).not.toBeNull();
    expect(container.querySelector('.sec-body')).toBeNull();
  });

  // Regression: the fall-through that keeps unsanitized markup off the screen.
  // A `simple` body whose every element was disallowed sanitizes to nothing —
  // and the honest note is the only correct answer, because rendering the
  // ORIGINAL would be handing the sender's markup straight to the DOM.
  it('falls back to the note rather than render an unsanitized body', () => {
    const message = chatMessage({ body: '<script>steal()</script>' });
    const { container } = render(
      <MessageBody
        message={message}
        // Hand-written: this body's text content makes it `simple`, and then
        // there is nothing left of it after the inline policy runs.
        shape={{
          kind: 'simple',
          html: message.body,
          text: 'steal()',
          hasRemoteImages: false,
        }}
        labels={DEFAULT_LABELS}
      />,
    );
    expect(container.querySelector('.sec-note--quiet')).not.toBeNull();
    expect(container.innerHTML).not.toContain('steal()');
  });

  describe('link clicks', () => {
    const body = '<p>see <a href="https://x.example/a"><b>this</b></a> and <i>that</i></p>';

    // Regression: the click almost always lands on something INSIDE the anchor,
    // so reading the event target alone would miss most real clicks.
    it('hands a clicked link to the host, from wherever inside it was clicked', () => {
      const onOpenLink = vi.fn();
      const { container } = renderBody(body, onOpenLink);
      fireEvent.click(container.querySelector('b') as HTMLElement);
      expect(onOpenLink).toHaveBeenCalledWith('https://x.example/a');
    });

    // Regression: without `preventDefault` the anchor navigates the whole
    // application away from itself — in a desktop mail client that is the app
    // window turning into a web page, with no way back.
    it('stops the navigation whether or not the host handles the link', () => {
      const { container } = renderBody(body);
      const anchor = container.querySelector('a') as HTMLElement;
      // `fireEvent.click` returns false when a handler called preventDefault.
      expect(fireEvent.click(anchor)).toBe(false);
    });

    it('ignores a click that was not on a link', () => {
      const onOpenLink = vi.fn();
      const { container } = renderBody(body, onOpenLink);
      const plain = container.querySelector('i') as HTMLElement;
      expect(fireEvent.click(plain)).toBe(true);
      expect(onOpenLink).not.toHaveBeenCalled();
    });
  });
});
