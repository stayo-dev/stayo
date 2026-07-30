import type { MealSlotKey, PollType } from '@shared/mocks/food';

export type FoodView = 'menu' | 'polls';

export type PollTab = 'active' | 'scheduled' | 'closed';

export interface CreatePollOption {
  id: string;
  name: string;
}

export interface CreatePollDraft {
  title: string;
  type: PollType;
  options: CreatePollOption[];
  mealCat: MealSlotKey;
  date: string;
  closeTime: string;
  anon: boolean;
  multi: boolean;
  notify: boolean;
}

export const EMPTY_CREATE_POLL_DRAFT: CreatePollDraft = {
  title: '',
  type: 'single',
  options: [
    { id: 'n1', name: 'Paneer Butter Masala' },
    { id: 'n2', name: 'Veg Biryani' },
  ],
  mealCat: 'lunch',
  date: 'Sat, 26 Jul',
  closeTime: '2:00 PM',
  anon: true,
  multi: false,
  notify: true,
};

export const TITLE_SUGGESTIONS = ['Saturday Lunch Menu', 'Sunday Dinner', 'New Breakfast Items', "Are you satisfied with today's lunch?"];
