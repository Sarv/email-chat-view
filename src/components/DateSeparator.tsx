/**
 * The rule and label between two days of messages.
 */

export interface DateSeparatorProps {
  label: string;
}

export function DateSeparator({ label }: DateSeparatorProps) {
  return (
    // `separator` with an accessible name, so a screen reader announces the day
    // change instead of stepping silently from one date into the next.
    <div className="sec-date-sep" role="separator" aria-label={label}>
      <span className="sec-date-sep__line" />
      <span className="sec-date-sep__label">{label}</span>
      <span className="sec-date-sep__line" />
    </div>
  );
}
