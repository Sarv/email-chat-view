/**
 * One attachment, as a chip under the message body.
 *
 * The library shows the chip and reports the click; it never fetches, opens or
 * saves anything. Where the bytes come from is entirely the host's business —
 * an IPC call in Electron, a signed URL on the web — and a component that
 * guessed would be wrong in both.
 */
import type { Attachment } from '../types.js';
import { formatFileSize, isPreviewable } from '../ui/attachments.js';
import type { ViewLabels } from '../ui/labels.js';

import { DownloadIcon, EyeIcon, PaperclipIcon } from './icons.js';
import { Tooltip } from './Tooltip.js';

export interface AttachmentChipProps {
  attachment: Attachment;
  labels: ViewLabels;
  /** Show it inline. Omit and no preview affordance appears. */
  onPreview?: (attachment: Attachment) => void;
  /** Save it. Omit and no download affordance appears. */
  onDownload?: (attachment: Attachment) => void;
}

export function AttachmentChip({ attachment, labels, onPreview, onDownload }: AttachmentChipProps) {
  const size = formatFileSize(attachment.sizeBytes);
  const previewable = Boolean(onPreview) && isPreviewable(attachment);

  return (
    <span className="sec-chip">
      <PaperclipIcon className="sec-chip__clip" />
      <span className="sec-chip__name" title={attachment.filename}>
        {attachment.filename}
      </span>
      {size ? <span className="sec-chip__size">{size}</span> : null}
      {previewable ? (
        <Tooltip content={labels.preview}>
          <button
            type="button"
            className="sec-chip__btn"
            // Named for the assistive-technology user, who gets no tooltip and
            // no filename column — just this button.
            aria-label={`${labels.preview}: ${attachment.filename}`}
            onClick={() => onPreview?.(attachment)}
          >
            <EyeIcon />
          </button>
        </Tooltip>
      ) : null}
      {onDownload ? (
        <Tooltip content={labels.download}>
          <button
            type="button"
            className="sec-chip__btn"
            aria-label={`${labels.download}: ${attachment.filename}`}
            onClick={() => onDownload(attachment)}
          >
            <DownloadIcon />
          </button>
        </Tooltip>
      ) : null}
    </span>
  );
}
