// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AttachmentChip } from '../../src/components/AttachmentChip.js';
import type { Attachment } from '../../src/types.js';
import { DEFAULT_LABELS } from '../../src/ui/labels.js';

const pdf: Attachment = { filename: 'Q3 report.pdf', mimeType: 'application/pdf', sizeBytes: 20_480 };

describe('AttachmentChip', () => {
  it('shows the filename and its size', () => {
    const { container } = render(<AttachmentChip attachment={pdf} labels={DEFAULT_LABELS} />);
    expect(container.querySelector('.sec-chip__name')?.textContent).toBe('Q3 report.pdf');
    expect(container.querySelector('.sec-chip__size')?.textContent).toBe('20.5 kB');
    // The name is truncated by CSS, so the full one has to stay reachable.
    expect(container.querySelector('.sec-chip__name')?.getAttribute('title')).toBe('Q3 report.pdf');
  });

  // Regression: mail stores report a missing size as null or NaN routinely.
  // Rendering the empty string leaves a stray separator dot in the chip.
  it('omits the size when there is none to show', () => {
    const { container } = render(
      <AttachmentChip attachment={{ filename: 'x.pdf' }} labels={DEFAULT_LABELS} />,
    );
    expect(container.querySelector('.sec-chip__size')).toBeNull();
  });

  // Regression: the library never fetches, opens or saves anything — where the
  // bytes come from is an IPC call in Electron and a signed URL on the web. A
  // chip that offered an affordance the host cannot serve is a dead button.
  it('offers no affordance the host has not supplied', () => {
    render(<AttachmentChip attachment={pdf} labels={DEFAULT_LABELS} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('previews only what the host can preview', () => {
    const onPreview = vi.fn();
    const { unmount } = render(
      <AttachmentChip attachment={pdf} labels={DEFAULT_LABELS} onPreview={onPreview} />,
    );
    // Named for the assistive-technology user, who gets no tooltip and no
    // filename column — just this button.
    fireEvent.click(screen.getByLabelText('Preview: Q3 report.pdf'));
    expect(onPreview).toHaveBeenCalledWith(pdf);
    unmount();

    // A zip has no inline representation, so no preview is offered even though
    // the host would accept one.
    render(
      <AttachmentChip
        attachment={{ filename: 'archive.zip', mimeType: 'application/zip' }}
        labels={DEFAULT_LABELS}
        onPreview={onPreview}
      />,
    );
    expect(screen.queryByLabelText('Preview: archive.zip')).toBeNull();
  });

  it('downloads whatever the host will download', () => {
    const onDownload = vi.fn();
    render(
      <AttachmentChip
        attachment={{ filename: 'archive.zip' }}
        labels={DEFAULT_LABELS}
        onDownload={onDownload}
      />,
    );
    fireEvent.click(screen.getByLabelText('Download: archive.zip'));
    expect(onDownload).toHaveBeenCalledWith({ filename: 'archive.zip' });
  });

  it('takes the host’s own wording', () => {
    render(
      <AttachmentChip
        attachment={pdf}
        labels={{ ...DEFAULT_LABELS, download: 'Enregistrer' }}
        onDownload={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Enregistrer: Q3 report.pdf')).not.toBeNull();
  });
});
