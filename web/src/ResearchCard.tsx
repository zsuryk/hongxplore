import type { CSSProperties } from 'react';
import { GATHERING_INFO_LABEL, GATHERING_INFO_SUBTITLE, GATHERING_INFO_TITLE } from './copy';

export type ResearchCardProps = {
  style?: CSSProperties;
};

export function ResearchCard({ style }: ResearchCardProps) {
  return (
    <article
      aria-label={GATHERING_INFO_LABEL}
      aria-live="polite"
      className="activity-card activity-card--canvas activity-card--researching"
      role="status"
      style={style}
    >
      <div className="activity-card__research-header">
        <div aria-hidden="true" className="activity-card__research-sparkle-wrap">
          <span className="activity-card__research-sparkle">✦</span>
        </div>
        <h2 className="activity-card__research-title">{GATHERING_INFO_TITLE}</h2>
        <p className="activity-card__research-subtitle">{GATHERING_INFO_SUBTITLE}</p>
      </div>
      <div aria-hidden="true" className="activity-card__skeleton">
        <div className="activity-card__skeleton-line activity-card__skeleton-line--full" />
        <div className="activity-card__skeleton-line activity-card__skeleton-line--medium" />
        <div className="activity-card__skeleton-line activity-card__skeleton-line--short" />
      </div>
    </article>
  );
}
