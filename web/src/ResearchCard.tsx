import type { CSSProperties } from 'react';
import { IconPending } from './icons';
import {
  ACTIVITY_CARD_PENDING_SERIAL,
  GATHERING_INFO_LABEL,
  GATHERING_INFO_PLATE_LABEL,
  GATHERING_INFO_SUBTITLE,
  GATHERING_INFO_TITLE,
} from './copy';

export type ResearchCardProps = {
  style?: CSSProperties;
};

/**
 * The pending cell.
 *
 * It is drawn as a result card whose rows have not arrived yet: same bezel, same header row,
 * same plate column, and a skeleton where the data rows will be — so swapping it for real
 * cards is a substitution rather than a change of object. The only difference is the amber
 * `Gathering` label, because amber means "waiting on you" and this is the one thing on the
 * board the user is genuinely waiting on.
 */
export function ResearchCard({ style }: ResearchCardProps) {
  return (
    <article
      aria-label={GATHERING_INFO_LABEL}
      aria-live="polite"
      className="activity-card activity-card--canvas activity-card--researching"
      role="status"
      style={style}
    >
      <header className="activity-card__research-head">
        <span aria-hidden="true" className="activity-card__research-plate">
          {ACTIVITY_CARD_PENDING_SERIAL}
        </span>
        <span className="activity-card__research-state">
          <IconPending />
          {GATHERING_INFO_PLATE_LABEL}
        </span>
      </header>
      <h2 className="activity-card__research-title">{GATHERING_INFO_TITLE}</h2>
      <p className="activity-card__research-subtitle">{GATHERING_INFO_SUBTITLE}</p>
      <div aria-hidden="true" className="activity-card__skeleton">
        <div className="activity-card__skeleton-line activity-card__skeleton-line--full" />
        <div className="activity-card__skeleton-line activity-card__skeleton-line--medium" />
        <div className="activity-card__skeleton-line activity-card__skeleton-line--short" />
      </div>
    </article>
  );
}
