import type { CSSProperties } from 'react';
import type { CardVariant } from './boardLayout';
import {
  ACTIVITY_CARD_LANGUAGE_CHINESE,
  ACTIVITY_CARD_LANGUAGE_ENGLISH,
  ACTIVITY_CARD_LANGUAGE_LABEL,
  ACTIVITY_CARD_MATCH_RATIONALE_LABEL,
  ACTIVITY_CARD_ORIGINAL_TITLE_LABEL,
  ACTIVITY_CARD_SOURCE_LABEL,
  ACTIVITY_CARD_TIME_UNAVAILABLE,
  FIND_SIMILAR_LABEL,
  activityCardAccessibleLabel,
  activityCardLocation,
} from './copy';
import type { components } from './api/schema';

type MatchedActivity = components['schemas']['MatchedActivity'];

/**
 * `canvas` — a node on the zoomable whiteboard.
 * `docked`  — a card parked in a timeline slot, in screen space at a fixed size.
 */
export type ActivityCardSize = 'canvas' | 'docked';

export type ActivityCardProps = {
  match: MatchedActivity;
  onFindSimilar?: (match: MatchedActivity) => void;
  size?: ActivityCardSize;
  state?: 'spawning' | 'discarding' | 'dragging';
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

const hktCompactDateFormatter = new Intl.DateTimeFormat('en-HK', {
  day: 'numeric',
  month: 'numeric',
  timeZone: 'Asia/Hong_Kong',
  weekday: 'short',
});

export function ActivityCard({
  match,
  onFindSimilar,
  size = 'canvas',
  state = 'spawning',
  style,
  variant = 'standard',
}: ActivityCardProps) {
  const { activity, match_rationale: matchRationale } = match;
  const language = activity.lang === 'en' ? ACTIVITY_CARD_LANGUAGE_ENGLISH : ACTIVITY_CARD_LANGUAGE_CHINESE;
  const start = activity.parts[0]?.start;
  const title = activity.title_en ?? activity.title;
  const hasTranslatedTitle = activity.title_en && activity.title_en !== activity.title;

  const stateClass = state ? ` activity-card--${state}` : '';
  const variantClass = size === 'canvas' ? ` activity-card--${variant}` : '';

  // Minimal view for docked timeline cards to prevent vertical blowout
  if (size === 'docked') {
    return (
      <article
        aria-label={activityCardAccessibleLabel(title)}
        className={`activity-card activity-card--docked${stateClass}`}
        style={style}
      >
        <div className="activity-card__topline">
          <span className="activity-card__language">
            {ACTIVITY_CARD_LANGUAGE_LABEL}: {language}
          </span>
          {start ? (
            <time dateTime={start}>{formatActivityTime(start)}</time>
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
      aria-label={activityCardAccessibleLabel(title)}
      className={`activity-card activity-card--${size}${variantClass}${stateClass}`}
      style={style}
    >
      <div className="activity-card__topline">
        <span className="activity-card__language">
          {ACTIVITY_CARD_LANGUAGE_LABEL}: {language}
        </span>
        {start ? (
          variant === 'compact' ? (
            <span className="activity-card__compact-badge" title={formatActivityTime(start)}>
              <time dateTime={start}>{formatCompactDate(start)}</time>
            </span>
          ) : (
            <time dateTime={start}>{formatActivityTime(start)}</time>
          )
        ) : (
          <span>{ACTIVITY_CARD_TIME_UNAVAILABLE}</span>
        )}
      </div>
      <h2>{title}</h2>
      {hasTranslatedTitle && variant !== 'compact' ? (
        <p className="activity-card__original-title">
          <span className="sr-only">{ACTIVITY_CARD_ORIGINAL_TITLE_LABEL}: </span>
          {activity.title}
        </p>
      ) : null}
      <p className="activity-card__location">
        {activityCardLocation(activity.location.venue, activity.location.district)}
      </p>
      <p className="activity-card__rationale">
        <span className="activity-card__rationale-label">{ACTIVITY_CARD_MATCH_RATIONALE_LABEL}</span>
        {matchRationale}
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
    </article>
  );
}

function formatActivityTime(start: string): string {
  return hktDateFormatter.format(new Date(start));
}

function formatCompactDate(start: string): string {
  return hktCompactDateFormatter.format(new Date(start));
}
