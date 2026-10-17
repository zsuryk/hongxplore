/**
 * Pure physics calculations and gesture discrimination for Deck mode (issue #140).
 */
import type { components } from './api/schema';

type MatchedActivity = components['schemas']['MatchedActivity'];

export const SWIPE_THRESHOLD_PX = 70;
export const EXIT_DURATION_MS = 220; // Aligns with --motion-slow (220ms)
export const SETTLE_DURATION_MS = 220; // Aligns with --motion-slow (220ms)

export type SwipeOutcome =
  { type: 'discard' } | { type: 'dock'; slotId: string } | { type: 'quick-dock' } | { type: 'cancel' };

/**
 * Resolves final outcome of a pointer drag / swipe release based on displacement and drop target.
 */
export function resolveSwipeOutcome(
  deltaX: number,
  dropTarget: string | null,
  threshold: number = SWIPE_THRESHOLD_PX,
): SwipeOutcome {
  if (dropTarget === 'discard' || deltaX < -threshold) {
    return { type: 'discard' };
  }
  if (dropTarget && dropTarget !== 'discard') {
    return { type: 'dock', slotId: dropTarget };
  }
  if (deltaX > threshold) {
    return { type: 'quick-dock' };
  }
  return { type: 'cancel' };
}

/**
 * Distinguishes an intentional horizontal swipe gesture from a vertical content scroll.
 */
export function isHorizontalSwipeGesture(deltaX: number, deltaY: number, minDistance = 8): boolean {
  return Math.abs(deltaX) > minDistance && Math.abs(deltaX) > Math.abs(deltaY);
}

/**
 * Identifies the index of the restored card in the unassigned card stack.
 */
export function findRestoredCardIndex(
  unassignedCards: readonly { activity: { id: string } }[] | readonly MatchedActivity[],
  restoredId: string,
): number {
  const index = unassignedCards.findIndex((c) => c.activity.id === restoredId);
  return index >= 0 ? index : 0;
}

/**
 * Dynamically scales down the active card as it approaches the sidebars.
 * Returns a scale between 1.0 (at rest in center) and ~0.55 (at sidebar margins).
 * Hovering drop targets never alters or jumps the card scale.
 */
export function computeDynamicDragScale(deltaX: number): number {
  const absX = Math.abs(deltaX);
  const dragRatio = Math.min(absX / 260, 1);
  const scale = 1 - dragRatio * 0.45;
  return Number(scale.toFixed(3));
}
