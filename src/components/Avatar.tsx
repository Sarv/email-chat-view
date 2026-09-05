/**
 * The sender's circle.
 *
 * Initials on their identity colour, which is the only per-participant signal
 * the view has that survives being glanced at rather than read.
 */
import { initialsFor } from '../ui/recipients.js';

export interface AvatarProps {
  address: string | null | undefined;
  name?: string | null;
  /** Background fill. Omit for the reader's own messages (brand tint). */
  color?: string;
  /**
   * Render an invisible placeholder of the same size instead of the circle.
   *
   * Used by follow-up bubbles in a sender run: the circle is not repeated, but
   * the space it occupied has to stay or the run's bubbles would step left out
   * of alignment with the first one.
   */
  spacer?: boolean;
}

export function Avatar({ address, name, color, spacer }: AvatarProps) {
  if (spacer) return <span className="sec-avatar sec-avatar--spacer" aria-hidden="true" />;
  return (
    <span
      className="sec-avatar"
      style={color ? { backgroundColor: color } : undefined}
      // The name is already in the bubble header next to this, so announcing
      // it again here would make a screen reader read every sender twice.
      aria-hidden="true"
    >
      {initialsFor(address, name)}
    </span>
  );
}
