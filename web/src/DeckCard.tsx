import { useState, type CSSProperties, type PointerEvent } from 'react';
import type { components } from './api/schema';
import {
  ACTIVITY_CARD_DISTRICT_LABEL,
  ACTIVITY_CARD_TIME_UNAVAILABLE,
  DECK_BOOKING_GUIDE_BADGE,
  DECK_LOCATION_LABEL,
  DECK_MATCH_RATIONALE_LABEL,
  DECK_PRICE_LABEL,
  DECK_SCHEDULE_LABEL,
  DECK_STAMP_DISCARD,
  DECK_STAMP_SCHEDULE,
  DECK_STAMP_SKIP,
  FIND_SIMILAR_LABEL,
  TAGS_LABEL,
  activityCardAccessibleLabel,
  activityCardCtaLabel,
  activityCardPriceLabel,
  activityCardSerial,
  deckExternalLinkLabel,
  getActivityLanguageBadge,
  hktActivityDateTimeFormatter,
} from './copy';

type MatchedActivity = components['schemas']['MatchedActivity'];

export type DeckCardStamp = {
  type: 'discard' | 'dock' | 'skip';
  opacity: number;
};

export type DeckCardProps = {
  index?: number;
  match: MatchedActivity;
  onFindSimilar?: (match: MatchedActivity) => void;
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  style?: CSSProperties;
  swipeDirection?: 'left' | 'right' | null;
  stamp?: DeckCardStamp | null;
  isGhost?: boolean;
};

function isBookingGuide(tags: readonly string[]): boolean {
  return tags.some((t) => t === 'guide' || t === 'facility-booking' || t === 'booking');
}

export function DeckCard({
  index,
  match,
  onFindSimilar,
  onPointerDown,
  style,
  swipeDirection,
  stamp,
  isGhost = false,
}: DeckCardProps) {
  const { activity, match_rationale: matchRationale } = match;
  const language = getActivityLanguageBadge(activity, matchRationale);
  const title = activity.title_en ?? activity.title;
  const hasTranslatedTitle = activity.title_en && activity.title_en !== activity.title;
  const serial = index === undefined ? null : activityCardSerial(index);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const showCover = Boolean(activity.image) && failedImageUrl !== activity.image;
  const hasGuideBadge = isBookingGuide(activity.tags);
  const priceText = activityCardPriceLabel(activity.price);
  const locationText = [activity.location.venue, activity.location.district].filter(Boolean).join(', ');
  const accessibleLabel = activityCardAccessibleLabel(title, language);

  const swipeClass = swipeDirection ? ` deck-card--swiping-${swipeDirection}` : '';
  const ghostClass = isGhost ? ' deck-card--ghost' : '';

  return (
    <article
      aria-label={accessibleLabel}
      className={`deck-card${swipeClass}${ghostClass}`}
      data-activity-id={activity.id}
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      onPointerDown={onPointerDown}
      style={style}
    >
      {/* Dynamic visual stamp feedback */}
      {stamp && stamp.opacity > 0 ? (
        <div
          aria-hidden="true"
          className={`deck-card__stamp deck-card__stamp--${stamp.type}`}
          style={{ opacity: stamp.opacity }}
        >
          {stamp.type === 'discard'
            ? DECK_STAMP_DISCARD
            : stamp.type === 'dock'
              ? DECK_STAMP_SCHEDULE
              : DECK_STAMP_SKIP}
        </div>
      ) : null}

      {/* Top Header Plate */}
      <header className="deck-card__header">
        <div className="deck-card__meta">
          {serial ? <span className="deck-card__serial">{serial}</span> : null}
          <span className="deck-card__badge deck-card__badge--lang">{language}</span>
          {hasGuideBadge ? (
            <span className="deck-card__badge deck-card__badge--guide">{DECK_BOOKING_GUIDE_BADGE}</span>
          ) : null}
        </div>
        <span className="deck-card__district" title={ACTIVITY_CARD_DISTRICT_LABEL}>
          {activity.location.district}
        </span>
      </header>

      {/* Cover Image (optional) */}
      {showCover && activity.image ? (
        <div className="deck-card__cover-wrap">
          <img
            alt=""
            className="deck-card__cover"
            draggable={false}
            onError={() => setFailedImageUrl(activity.image ?? null)}
            src={activity.image}
          />
        </div>
      ) : null}

      {/* Card Content Body */}
      <div className="deck-card__body">
        <div className="deck-card__titles">
          <h2 className="deck-card__title">{title}</h2>
          {hasTranslatedTitle ? <p className="deck-card__original-title">{activity.title}</p> : null}
        </div>

        {/* Match Rationale */}
        <aside aria-label={DECK_MATCH_RATIONALE_LABEL} className="deck-card__rationale">
          <span className="deck-card__rationale-label">{DECK_MATCH_RATIONALE_LABEL}</span>
          <p className="deck-card__rationale-text">{matchRationale}</p>
        </aside>

        {/* Description */}
        {activity.description_en || activity.description ? (
          <p className="deck-card__description">{activity.description_en ?? activity.description}</p>
        ) : null}

        {/* Detailed Info Grid */}
        <dl className="deck-card__details">
          <div className="deck-card__detail-row">
            <dt className="deck-card__detail-label">{DECK_SCHEDULE_LABEL}</dt>
            <dd className="deck-card__detail-value">
              {activity.parts.length > 0
                ? activity.parts
                    .map((p) => {
                      try {
                        return hktActivityDateTimeFormatter.format(new Date(p.start));
                      } catch {
                        return p.start;
                      }
                    })
                    .join(' · ')
                : ACTIVITY_CARD_TIME_UNAVAILABLE}
            </dd>
          </div>

          <div className="deck-card__detail-row">
            <dt className="deck-card__detail-label">{DECK_LOCATION_LABEL}</dt>
            <dd className="deck-card__detail-value">{locationText}</dd>
          </div>

          <div className="deck-card__detail-row">
            <dt className="deck-card__detail-label">{DECK_PRICE_LABEL}</dt>
            <dd className="deck-card__detail-value">{priceText}</dd>
          </div>
        </dl>

        {/* Tags */}
        {activity.tags.length > 0 ? (
          <ul aria-label={TAGS_LABEL} className="deck-card__tags">
            {activity.tags.map((tag) => (
              <li className="deck-card__tag" key={tag}>
                #{tag}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Card Actions Footer */}
      <footer className="deck-card__footer">
        <a
          aria-label={activityCardCtaLabel(activity.source.name)}
          className="btn btn--sm deck-card__cta"
          href={activity.url}
          onPointerDown={(e) => e.stopPropagation()}
          rel="noreferrer"
          target="_blank"
        >
          {deckExternalLinkLabel(activity.source.name)}
        </a>

        {onFindSimilar ? (
          <button
            className="btn btn--sm btn--subtle deck-card__find-similar"
            onClick={(e) => {
              e.stopPropagation();
              onFindSimilar(match);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            type="button"
          >
            {FIND_SIMILAR_LABEL}
          </button>
        ) : null}
      </footer>
    </article>
  );
}
