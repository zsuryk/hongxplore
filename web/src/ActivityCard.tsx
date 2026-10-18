import { useState, type CSSProperties } from 'react';
import type { CardVariant } from './boardLayout';
import {
  ACTIVITY_CARD_DISTRICT_LABEL,
  ACTIVITY_CARD_LANGUAGE_LABEL,
  ACTIVITY_CARD_MATCH_RATIONALE_LABEL,
  ACTIVITY_CARD_ORIGINAL_TITLE_LABEL,
  ACTIVITY_CARD_ROW_LISTED_LABEL,
  ACTIVITY_CARD_ROW_PRICE_LABEL,
  ACTIVITY_CARD_ROW_VENUE_LABEL,
  ACTIVITY_CARD_TIME_UNAVAILABLE,
  FIND_SIMILAR_LABEL,
  activityCardAccessibleLabel,
  activityCardCtaLabel,
  activityCardListedLabel,
  activityCardLocation,
  activityCardPriceLabel,
  activityCardSerial,
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
  /**
   * Zero-based position in the board's card order, rendered as the serial plate (`01`, `02`).
   *
   * This is the card's *row number*, not its grid cell: it is taken from the full card list
   * rather than from the cards currently on the canvas, so docking or discarding a card does
   * not renumber the ones that remain. A board row number that changes under you is worse than
   * no number. Omitting the prop drops the plate entirely — the docked view does, because it has
   * no header plate to put one in. **The drag proxy does not**: it passes the index, because
   * dropping the plate changed the card's content-driven height by 45 world units mid-drag, at
   * the moment the user is looking at the card to aim it. See `dragProxy.test.tsx`.
   */
  index?: number;
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
  index,
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
  // A Traditional-Chinese title is set a step larger than a Latin one (see DESIGN.md "Bilingual
  // type"): the CJK glyphs are denser at the same nominal size and would otherwise read as
  // smaller than the Latin text they sit beside.
  const isCjkTitle = !activity.title_en && /[\u4e00-\u9fa5]/.test(activity.title ?? '');

  const stateClass = state ? ` activity-card--${state}` : '';
  const variantClass = size === 'canvas' ? ` activity-card--${variant}` : '';
  const recentClass = isRecent ? ' activity-card--recent' : '';
  const district = activity.location.district;
  const serial = index === undefined ? null : activityCardSerial(index);

  /**
   * Cover image, ported from #118 (kORNkin).
   *
   * Collapses silently on load failure: a broken-image glyph and a collapsed-but-still-reserved
   * box are both worse than no image. `key` resets the element when `src` changes so a card recycled
   * for a different activity re-attempts rather than staying stuck in its failed state. Docked cards
   * return early above, so they never reach this — the cover cannot blow out the timeline slot.
   */
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const showCoverImage = size !== 'docked' && Boolean(activity.image) && failedImageUrl !== activity.image;

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
        <p className="activity-card__location">{activityCardLocation(activity.location.venue, district)}</p>
      </article>
    );
  }

  return (
    <article
      aria-label={activityCardAccessibleLabel(title, language)}
      className={`activity-card activity-card--${size}${variantClass}${stateClass}${recentClass}`}
      style={style}
    >
      {/* Cover image, ported from #118 (kORNkin) and re-placed. It becomes the card's top surface
          and the header plate keeps its own band directly beneath it, rather than overlaying the
          image — see `.activity-card__cover-wrap` in card.css for why an overlay was rejected.

          `alt=""` + `aria-hidden`: the image is atmosphere, not information. The activity's title
          is already the card's accessible name, so #118's `activityCardImageAlt(title)` would have
          announced the title twice — once as the article label and once as the image. */}
      {showCoverImage ? (
        <div aria-hidden="true" className="activity-card__cover-wrap">
          <img
            alt=""
            className="activity-card__cover"
            decoding="async"
            draggable={false}
            key={activity.image ?? undefined}
            loading="lazy"
            onError={() => setFailedImageUrl(activity.image ?? '')}
            referrerPolicy="no-referrer"
            src={activity.image ?? undefined}
          />
        </div>
      ) : null}

      {/* Header row: the board's own coordinates — row number, where, when. The 1px --rule
          under it is the same rule that draws the card's bezel; nothing else separates them. */}
      <header className="activity-card__head">
        {serial ? (
          <span aria-hidden="true" className="activity-card__plate">
            {serial}
          </span>
        ) : null}
        <span className="activity-card__district" title={`${ACTIVITY_CARD_DISTRICT_LABEL}: ${district}`}>
          {district}
        </span>
        <span className="activity-card__head-sub">
          <span
            aria-label={`${ACTIVITY_CARD_LANGUAGE_LABEL}: ${language}`}
            className="activity-card__language"
            tabIndex={0}
            title={`${ACTIVITY_CARD_LANGUAGE_LABEL}: ${language}`}
          >
            {language}
          </span>
          {start ? (
            <span
              className={`activity-card__time-badge${variant === 'compact' ? ' activity-card__compact-badge' : ''}`}
              title={formatActivityTime(start)}
            >
              <time dateTime={start}>{formatActivityTime(start)}</time>
            </span>
          ) : (
            <span className="activity-card__time-badge">{ACTIVITY_CARD_TIME_UNAVAILABLE}</span>
          )}
        </span>
      </header>

      <div className="activity-card__body">
        <h2 className={isCjkTitle ? 'activity-card__title activity-card__title--cjk' : 'activity-card__title'}>
          {title}
        </h2>
        {hasTranslatedTitle && variant !== 'compact' ? (
          <p className="activity-card__original-title">
            <span className="sr-only">{ACTIVITY_CARD_ORIGINAL_TITLE_LABEL}: </span>
            {activity.title}
          </p>
        ) : null}

        {/* The metadata that used to be loose text, now as a ruled data row: a label column and
            a value column, so district / price / freshness scan down the same edge on every card. */}
        <dl className="activity-card__data">
          {activity.location.venue ? (
            <div className="activity-card__data-row">
              <dt>{ACTIVITY_CARD_ROW_VENUE_LABEL}</dt>
              <dd>{activity.location.venue}</dd>
            </div>
          ) : null}
          <div className="activity-card__data-row">
            <dt>{ACTIVITY_CARD_ROW_PRICE_LABEL}</dt>
            <dd>{activityCardPriceLabel(activity.price)}</dd>
          </div>
          <div className="activity-card__data-row activity-card__data-row--listed">
            <dt>{ACTIVITY_CARD_ROW_LISTED_LABEL}</dt>
            <dd>{activityCardListedLabel(activity.listed_at)}</dd>
          </div>
        </dl>

        <p className="activity-card__rationale" tabIndex={0}>
          <span className="activity-card__rationale-label">{ACTIVITY_CARD_MATCH_RATIONALE_LABEL}</span>
          <span className="activity-card__rationale-text">{matchRationale}</span>
        </p>
      </div>

      <footer className="activity-card__foot">
        {variant !== 'compact' ? (
          /* Ported from #112. `stopPropagation` matters more than it looks: the whole card is a
             drag handle, so without it, pressing the CTA would start a drag instead of opening the
             link — the one interaction on the card a user is guaranteed to try. */
          <a
            aria-label={activityCardCtaLabel(activity.source.name)}
            className="btn btn--sm activity-card__cta"
            href={activity.url}
            onPointerDown={(event) => event.stopPropagation()}
            rel="noreferrer"
            target="_blank"
            title={activityCardCtaLabel(activity.source.name)}
          >
            <span className="activity-card__cta-text">{activityCardCtaLabel(activity.source.name)}</span>
          </a>
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
      </footer>
    </article>
  );
}

function formatActivityTime(start: string): string {
  return hktDateFormatter.format(new Date(start));
}
