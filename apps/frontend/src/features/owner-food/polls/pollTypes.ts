import type { MealSlotKey } from '@shared/mocks/food';

/**
 * Food Polls (real feature, added 2026-08-08) — deliberately independent of
 * the dormant food_voting_periods/food_votes system used elsewhere in this
 * directory. See docs/obsidian/Food.md and ADR-057.
 */
export type PollType = 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'RATING' | 'YES_NO';
export type PollStatus = 'OPEN' | 'CLOSED';

export const POLL_TYPE_META: Record<PollType, { label: string }> = {
  SINGLE_CHOICE: { label: 'Single Choice' },
  MULTIPLE_CHOICE: { label: 'Multiple Choice' },
  RATING: { label: 'Rating (1-5)' },
  YES_NO: { label: 'Yes / No' },
};

/** Poll types whose options are owner-authored food items, rather than a fixed set. */
export function needsOwnerOptions(type: PollType): boolean {
  return type === 'SINGLE_CHOICE' || type === 'MULTIPLE_CHOICE';
}

/** RATING/YES_NO polls still go through the same options+votes model — these are the fixed labels sent as `options` at creation. */
export const RATING_OPTIONS = ['5 stars', '4 stars', '3 stars', '2 stars', '1 star'];
export const YES_NO_OPTIONS = ['Yes', 'No'];

export const SLOT_TO_MEAL_TYPE: Record<MealSlotKey, string> = {
  breakfast: 'BREAKFAST',
  lunch: 'LUNCH',
  snacks: 'SNACKS',
  dinner: 'DINNER',
};

export const TITLE_SUGGESTIONS = ['Saturday Lunch Menu', 'Sunday Dinner', 'New Breakfast Items', "Are you satisfied with today's lunch?"];

export interface PollOptionRow {
  id: string;
  label: string;
  position: number;
  votes: number;
}

/** Leading option by vote count (ties keep the first by position) — null when nobody has voted yet. */
export function getPollWinner(options: PollOptionRow[]): PollOptionRow | null {
  if (options.length === 0) return null;
  const totalVotes = options.reduce((sum, o) => sum + o.votes, 0);
  if (totalVotes === 0) return null;
  return options.reduce((a, b) => (b.votes > a.votes ? b : a), options[0]);
}

/** Vote share for one option as a whole-number percent of total votes cast (not of `voterCount`/`eligibleCount`) — 0 when nobody has voted. */
export function optionPercent(option: PollOptionRow, options: PollOptionRow[]): number {
  const totalVotes = options.reduce((sum, o) => sum + o.votes, 0);
  return totalVotes ? Math.round((option.votes / totalVotes) * 100) : 0;
}

export interface PollRow {
  id: string;
  title: string;
  poll_type: PollType;
  meal_type: string;
  poll_date: string;
  closes_at: string;
  is_anonymous: boolean;
  allow_multiple: boolean;
  status: PollStatus;
  closed_at: string | null;
  created_at: string;
  options: PollOptionRow[];
  totalVotes: number;
  voterCount: number;
  eligibleCount: number;
}
