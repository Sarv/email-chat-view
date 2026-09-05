/**
 * The demo thread the README media is generated from.
 *
 * Deliberately ugly on the input side: every message carries the clutter a real
 * reply carries — a quoted copy of the whole history, a client signature, a
 * legal footer a gateway appended. That clutter is the point of the picture, so
 * it has to be the markup real clients actually emit (`.gmail_quote`,
 * `.gmail_signature`, an `On … wrote:` attribution) rather than a caricature.
 *
 * Addresses are all on reserved `.example` domains, which cannot resolve and
 * cannot be scraped into anything useful.
 */

/** Fixed clock, so "Today" / "Yesterday" render the same on every regeneration. */
export const NOW = Date.UTC(2025, 2, 4, 9, 30);

const DAY = 86_400_000;
const at = (dayOffset, hour, minute) =>
  Math.floor((NOW + dayOffset * DAY - (9 - hour) * 3_600_000 - (30 - minute) * 60_000) / 1000);

/** The reader. */
export const ME = 'ankur@sarv.example';

/**
 * The legal footer, appended by a mail gateway with no marker of any kind —
 * which is why the disclaimer rules weigh evidence instead of matching a class.
 * The `demo-legal` class is a hook for the media highlight only; the rules never
 * look at it.
 */
const DISCLAIMER = `<p class="demo-legal">CONFIDENTIALITY NOTICE: This email and any attachments are
  confidential and intended solely for the addressee. If you have received this message in error,
  please notify the sender immediately and delete it from your system. Any unauthorised disclosure,
  copying, use or distribution of the information contained in this communication is strictly
  prohibited and may be unlawful.</p>`;

export const mails = [
  {
    id: '1',
    fromAddress: 'alice@acme.example',
    fromName: 'Alice Chen',
    toAddress: ME,
    toNames: 'Ankur Dubey',
    date: at(-1, 16, 12),
    body: `<div>Hi Ankur — are we still on for the Tuesday review? I can bring the Q1 numbers.</div>
      <div class="gmail_signature">--<br>Alice Chen | VP Sales, Acme Corp<br>+1 555 0100 | acme.example</div>`,
  },
  {
    id: '2',
    fromAddress: ME,
    fromName: 'Ankur Dubey',
    toAddress: 'alice@acme.example',
    toNames: 'Alice Chen',
    date: at(-1, 16, 41),
    body: `<div>Yes — 10am works. I'll book the small room.</div>
      <div class="gmail_signature">--<br>Ankur Dubey | Sarv</div>
      <div class="gmail_quote">
        <div class="gmail_attr">On Mon, 3 Mar 2025 at 16:12, Alice Chen &lt;alice@acme.example&gt; wrote:</div>
        <blockquote>Hi Ankur — are we still on for the Tuesday review? I can bring the Q1 numbers.</blockquote>
      </div>
      ${DISCLAIMER}`,
  },
  {
    id: '3',
    fromAddress: 'carol@vendor.example',
    fromName: 'Carol Nayar',
    toAddress: `${ME}, alice@acme.example`,
    toNames: 'Ankur Dubey, Alice Chen',
    date: at(0, 8, 2),
    attachments: [{ filename: 'Q1-proposal.pdf', sizeBytes: 284_160, mimeType: 'application/pdf' }],
    body: `<div>Proposal attached — happy to walk through it on Tuesday.</div>
      <div class="gmail_signature">--<br>Carol Nayar | Vendor Ltd</div>
      <div class="gmail_quote">
        <div class="gmail_attr">On Mon, 3 Mar 2025 at 16:41, Ankur Dubey &lt;ankur@sarv.example&gt; wrote:</div>
        <blockquote>Yes — 10am works. I'll book the small room.
          <blockquote>Hi Ankur — are we still on for the Tuesday review?</blockquote>
        </blockquote>
      </div>
      ${DISCLAIMER}`,
  },
  {
    id: '4',
    fromAddress: ME,
    fromName: 'Ankur Dubey',
    toAddress: 'alice@acme.example, carol@vendor.example',
    toNames: 'Alice Chen, Carol Nayar',
    date: at(0, 8, 24),
    body: `<div>Room's booked. See you both at 10.</div>
      <div class="gmail_signature">--<br>Ankur Dubey | Sarv</div>
      <div class="gmail_quote">
        <div class="gmail_attr">On Tue, 4 Mar 2025 at 08:02, Carol Nayar &lt;carol@vendor.example&gt; wrote:</div>
        <blockquote>Proposal attached — happy to walk through it on Tuesday.</blockquote>
      </div>
      ${DISCLAIMER}`,
  },
];
