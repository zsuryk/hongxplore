import type { CSSProperties } from 'react';
import type { CardVariant } from './boardLayout';
import {
  ACTIVITY_CARD_LANGUAGE_LABEL,
  ACTIVITY_CARD_MATCH_RATIONALE_LABEL,
  ACTIVITY_CARD_ORIGINAL_TITLE_LABEL,
  ACTIVITY_CARD_SOURCE_LABEL,
  ACTIVITY_CARD_TIME_UNAVAILABLE,
  FIND_SIMILAR_LABEL,
  activityCardAccessibleLabel,
  activityCardCtaLabel,
  activityCardDistrictLabel,
  activityCardLocation,
  activityCardPriceLabel,
  formatActivityFreshness,
  formatActivityPrice,
  getActivityLanguageBadge,
} from './copy';
import type { components } from './api/schema';

type MatchedActivity = components['schemas']['MatchedActivity'];

/**
 * `canvas` — a node on the zoomable whiteboard.
 * `docked`  — a card parked in a timeline slot, in screen space at a fixed size.
 */
export type ActivityCardSize = 'canvas' | 'docked';

export type ActivityCardProps = {
  isRecent?: boolean;
  match: MatchedActivity;
  onFindSimilar?: (match: MatchedActivity) => void;
  size?: ActivityCardSize;
  state?: 'spawning' | 'discarding' | 'dragging' | 'bouncing';
  style?: CSSProperties;
  variant?: CardVariant;
};

const hktDateFormatter = new Intl.DateTimeFormat('en-HK', {
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  month: 'short',
  timeZone: 'Asia/Hong_Kong',
  weekday: 'short',
});

export function ActivityCard({
  isRecent = false,
  match,
  onFindSimilar,
  size = 'canvas',
  state = 'spawning',
  style,
  variant = 'standard',
}: ActivityCardProps) {
  const { activity, match_rationale: matchRationale } = match;
  const language = getActivityLanguageBadge(activity, matchRationale);
  const start = activity.parts[0]?.start;
  const title = activity.title_en ?? activity.title;
  const hasTranslatedTitle = activity.title_en && activity.title_en !== activity.title;
  const priceFormatted = formatActivityPrice(activity.price);
  const freshnessFormatted = activity.listed_at ? formatActivityFreshness(activity.listed_at) : null;

  const stateClass = state ? ` activity-card--${state}` : '';
  const variantClass = size === 'canvas' ? ` activity-card--${variant}` : '';
  const recentClass = isRecent ? ' activity-card--recent' : '';

  // Minimal view for docked timeline cards to prevent vertical blowout
  if (size === 'docked') {
    return (
      <article
        aria-label={activityCardAccessibleLabel(title)}
        className={`activity-card activity-card--docked${stateClass}`}
        style={style}
      >
        <div className="activity-card__topline">
          {start ? (
            <span className="activity-card__time-badge">
              <time dateTime={start}>{formatActivityTime(start)}</time>
            </span>
          ) : (
            <span>{ACTIVITY_CARD_TIME_UNAVAILABLE}</span>
          )}
        </div>
        <h2 className="activity-card__docked-title">{title}</h2>
        <p className="activity-card__location">
          {activityCardLocation(activity.location.venue, activity.location.district)}
        </p>
      </article>
    );
  }

  return (
    <article
      aria-label={activityCardAccessibleLabel(title, language)}
      className={`activity-card activity-card--${size}${variantClass}${stateClass}${recentClass}`}
      style={style}
    >
      <div className="activity-card__topline">
        <div className="activity-card__badges">
          <span
            aria-label={`${ACTIVITY_CARD_LANGUAGE_LABEL}: ${language}`}
            className="activity-card__language"
            tabIndex={0}
            title={`${ACTIVITY_CARD_LANGUAGE_LABEL}: ${language}`}
          >
            {language}
          </span>
          <span
            aria-label={activityCardDistrictLabel(activity.location.district)}
            className="activity-card__district-badge"
            tabIndex={0}
            title={activityCardDistrictLabel(activity.location.district)}
          >
            {activity.location.district}
          </span>
          {priceFormatted ? (
            <span
              aria-label={activityCardPriceLabel(priceFormatted)}
              className="activity-card__price-badge"
              tabIndex={0}
              title={activityCardPriceLabel(priceFormatted)}
            >
              {priceFormatted}
            </span>
          ) : null}
          {freshnessFormatted ? (
            <span className="activity-card__freshness" tabIndex={0} title={freshnessFormatted}>
              {freshnessFormatted}
            </span>
          ) : null}
        </div>
        {start ? (
          <span
            className={`activity-card__time-badge${variant === 'compact' ? ' activity-card__compact-badge' : ''}`}
            title={formatActivityTime(start)}
          >
            <time dateTime={start}>{formatActivityTime(start)}</time>
          </span>
        ) : (
          <span>{ACTIVITY_CARD_TIME_UNAVAILABLE}</span>
        )}
      </div>
      <p className="activity-card__rationale" tabIndex={0}>
        <span className="activity-card__rationale-label">{ACTIVITY_CARD_MATCH_RATIONALE_LABEL}</span>
        {matchRationale}
      </p>
      <h2>{title}</h2>
      {hasTranslatedTitle ? (
        <p className="activity-card__original-title">
          <span className="sr-only">{ACTIVITY_CARD_ORIGINAL_TITLE_LABEL}: </span>
          {activity.title}
        </p>
      ) : null}
      <p className="activity-card__location">
        {activityCardLocation(activity.location.venue, activity.location.district)}
      </p>
      {variant !== 'compact' ? (
        <p className="activity-card__source">
          <span className="activity-card__source-label">{ACTIVITY_CARD_SOURCE_LABEL}: </span>
          {activity.source.url ? (
            <a href={activity.source.url} rel="noreferrer" target="_blank">
              {activity.source.name}
            </a>
          ) : (
            activity.source.name
          )}
        </p>
      ) : null}
      <div className="activity-card__actions">
        <a
          aria-label={activityCardCtaLabel(activity.source.name)}
          className="btn btn--sm btn--primary activity-card__cta"
          href={activity.url}
          onPointerDown={(event) => event.stopPropagation()}
          rel="noreferrer"
          target="_blank"
          title={activityCardCtaLabel(activity.source.name)}
        >
          <span className="activity-card__cta-text">{activityCardCtaLabel(activity.source.name)}</span>
        </a>
        {onFindSimilar ? (
          <button
            className="btn btn--sm activity-card__similar-button"
            onClick={() => onFindSimilar(match)}
            onPointerDown={(event) => event.stopPropagation()}
            type="button"
          >
            {FIND_SIMILAR_LABEL}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function formatActivityTime(start: string): string {
  return hktDateFormatter.format(new Date(start));
}
