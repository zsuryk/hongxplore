import type { CSSProperties } from 'react';
import {
  ACTIVITY_CARD_LANGUAGE_CHINESE,
  ACTIVITY_CARD_LANGUAGE_ENGLISH,
  ACTIVITY_CARD_LANGUAGE_LABEL,
  ACTIVITY_CARD_MATCH_RATIONALE_LABEL,
  ACTIVITY_CARD_ORIGINAL_TITLE_LABEL,
  ACTIVITY_CARD_SOURCE_LABEL,
  ACTIVITY_CARD_TIME_UNAVAILABLE,
  activityCardAccessibleLabel,
  activityCardLocation,
} from './copy';
import type { components } from './api/schema';

type MatchedActivity = components['schemas']['MatchedActivity'];

type ActivityCardProps = {
  match: MatchedActivity;
  state?: 'spawning' | 'discarding';
  style?: CSSProperties;
};

const hktDateFormatter = new Intl.DateTimeFormat('en-HK', {
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  month: 'short',
  timeZone: 'Asia/Hong_Kong',
  weekday: 'short',
});

export function ActivityCard({ match, state = 'spawning', style }: ActivityCardProps) {
  const { activity, match_rationale: matchRationale } = match;
  const language = activity.lang === 'en' ? ACTIVITY_CARD_LANGUAGE_ENGLISH : ACTIVITY_CARD_LANGUAGE_CHINESE;
  const time = formatActivityTime(activity.parts[0]?.start);
  const title = activity.title_en ?? activity.title;
  const hasTranslatedTitle = activity.title_en && activity.title_en !== activity.title;

  return (
    <article
      aria-label={activityCardAccessibleLabel(title)}
      className={`activity-card activity-card--${state}`}
      style={style}
    >
      <div className="activity-card__topline">
        <span className="activity-card__language">
          {ACTIVITY_CARD_LANGUAGE_LABEL}: {language}
        </span>
        <time>{time}</time>
      </div>
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
      <p className="activity-card__rationale">
        <span>{ACTIVITY_CARD_MATCH_RATIONALE_LABEL}</span>
        {matchRationale}
      </p>
      <p className="activity-card__source">
        <span>{ACTIVITY_CARD_SOURCE_LABEL}: </span>
        {activity.source.url ? (
          <a href={activity.source.url} rel="noreferrer" target="_blank">
            {activity.source.name}
          </a>
        ) : (
          activity.source.name
        )}
      </p>
    </article>
  );
}

function formatActivityTime(start: string | undefined): string {
  return start ? hktDateFormatter.format(new Date(start)) : ACTIVITY_CARD_TIME_UNAVAILABLE;
}
