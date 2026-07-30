/**
 * Centralized food/meal-planner mock data — shared/mocks/, not per-feature.
 * Ports Stayo App.dc.html's Food tab state verbatim: `foodSlots`,
 * `foodBaseLib`, `mealCatMeta`, `pollTypeMeta`, `pollSeed`, and the 4 Smart
 * Insight rows. `getPollWinner` derives the leading option from a poll's own
 * `options` array (never hardcoded separately), same principle as
 * `getExpenseInsights` in `shared/mocks/expenses.ts`.
 */

export type MealSlotKey = 'breakfast' | 'lunch' | 'snacks' | 'dinner';

export interface FoodSlotMeta {
  key: MealSlotKey;
  label: string;
  emoji: string;
  color: string;
  tint: string;
}

export const FOOD_SLOTS: FoodSlotMeta[] = [
  { key: 'breakfast', label: 'Breakfast', emoji: '🍳', color: '#B46A55', tint: '#F6ECE6' },
  { key: 'lunch', label: 'Lunch', emoji: '🍛', color: '#1F7A52', tint: '#E9F3EE' },
  { key: 'snacks', label: 'Snacks', emoji: '☕', color: '#B07E28', tint: '#F6EFE0' },
  { key: 'dinner', label: 'Dinner', emoji: '🍽️', color: '#5B6E8C', tint: '#EBEEF4' },
];

export type FoodLibrary = Record<MealSlotKey, string[]>;

export const FOOD_LIBRARY_SEED: FoodLibrary = {
  breakfast: ['Dosa', 'Idli', 'Poori', 'Upma', 'Pongal'],
  lunch: ['Dal Rice', 'Veg Biryani', 'Sambar Rice', 'Curd Rice', 'Lemon Rice'],
  snacks: ['Samosa', 'Tea', 'Bajji', 'Mixture', 'Vada'],
  dinner: ['Chapati', 'Fried Rice', 'Parotta', 'Noodles', 'Khichdi'],
};

export const MEAL_CATEGORY_META: Record<MealSlotKey, { label: string; emoji: string }> = {
  breakfast: { label: 'Breakfast', emoji: '🍳' },
  lunch: { label: 'Lunch', emoji: '🍛' },
  snacks: { label: 'Snacks', emoji: '🍟' },
  dinner: { label: 'Dinner', emoji: '🍲' },
};

export type PollType = 'single' | 'multi' | 'rating' | 'yesno';

export const POLL_TYPE_META: Record<PollType, { label: string }> = {
  single: { label: 'Single Choice' },
  multi: { label: 'Multiple Choice' },
  rating: { label: 'Rating (1–5)' },
  yesno: { label: 'Yes / No' },
};

export type PollStatus = 'active' | 'scheduled' | 'closed';

export interface MockFoodPollOption {
  id: string;
  name: string;
  pct: number;
}

export interface MockFoodPoll {
  id: string;
  title: string;
  type: PollType;
  mealCat: MealSlotKey;
  date: string;
  status: PollStatus;
  votes: number;
  totalTenants: number;
  closeIn: string;
  createdAgo: string;
  anon: boolean;
  options: MockFoodPollOption[];
}

export const mockFoodPolls: MockFoodPoll[] = [
  {
    id: 'p1',
    title: 'Saturday Lunch Menu',
    type: 'single',
    mealCat: 'lunch',
    date: 'Sat, 26 Jul',
    status: 'active',
    votes: 128,
    totalTenants: 180,
    closeIn: 'Closes in 6h',
    createdAgo: '2h ago',
    anon: true,
    options: [
      { id: 'o1', name: 'Paneer Butter Masala', pct: 68 },
      { id: 'o2', name: 'Veg Biryani', pct: 42 },
      { id: 'o3', name: 'Fried Rice', pct: 30 },
      { id: 'o4', name: 'Dal Fry', pct: 18 },
    ],
  },
  {
    id: 'p2',
    title: "How was today's dinner?",
    type: 'rating',
    mealCat: 'dinner',
    date: 'Fri, 25 Jul',
    status: 'active',
    votes: 96,
    totalTenants: 180,
    closeIn: 'Closes in 2h',
    createdAgo: '5h ago',
    anon: true,
    options: [
      { id: 'r5', name: '5 stars', pct: 52 },
      { id: 'r4', name: '4 stars', pct: 28 },
      { id: 'r3', name: '3 stars', pct: 12 },
      { id: 'r2', name: '2 stars', pct: 5 },
      { id: 'r1', name: '1 star', pct: 3 },
    ],
  },
  {
    id: 'p3',
    title: 'New Breakfast Items',
    type: 'multi',
    mealCat: 'breakfast',
    date: 'Sun, 27 Jul',
    status: 'scheduled',
    votes: 0,
    totalTenants: 180,
    closeIn: 'Opens tomorrow 8:00 AM',
    createdAgo: '1h ago',
    anon: true,
    options: [
      { id: 'b1', name: 'Masala Dosa', pct: 0 },
      { id: 'b2', name: 'Poha', pct: 0 },
      { id: 'b3', name: 'Idli Sambar', pct: 0 },
    ],
  },
  {
    id: 'p4',
    title: 'Sunday Dinner',
    type: 'single',
    mealCat: 'dinner',
    date: 'Sun, 20 Jul',
    status: 'closed',
    votes: 164,
    totalTenants: 180,
    closeIn: 'Closed',
    createdAgo: '5 days ago',
    anon: true,
    options: [
      { id: 'c1', name: 'Veg Biryani', pct: 71 },
      { id: 'c2', name: 'Chapati & Paneer', pct: 22 },
      { id: 'c3', name: 'Curd Rice', pct: 7 },
    ],
  },
];

export const SMART_INSIGHTS = [
  { icon: '🌶️', text: '82% of tenants prefer North Indian meals.' },
  { icon: '🧀', text: 'Paneer dishes receive the highest ratings.' },
  { icon: '📈', text: 'Dinner satisfaction is up 15% this month.' },
  { icon: '🌅', text: 'Breakfast participation is low — try a poll.' },
];

/** Derives the leading option from a poll's own `options` array. */
export function getPollWinner(poll: MockFoodPoll): MockFoodPollOption {
  return poll.options.reduce((a, b) => (b.pct > a.pct ? b : a), poll.options[0]);
}
