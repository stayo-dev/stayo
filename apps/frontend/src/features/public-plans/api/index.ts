import api from '@lib/api-client';

export type PublicPlan = {
  id: string;
  code: string;
  name: string;
  price_paise: number;
  currency: string;
  billing_cycle: string;
  capacity_min: number | null;
  capacity_max: number | null;
  included_beds: number | null;
  max_extra_beds: number | null;
  extra_bed_price_paise: number | null;
  is_public: boolean;
  description: string | null;
};

/**
 * Unauthenticated — powers the landing page's pricing section. Same tiers
 * the owner console's plan picker shows (see features/owner-subscription),
 * fetched from GET /public/subscription-plans rather than duplicated as
 * hardcoded copy, so the two surfaces can't drift.
 */
export const publicPlansApi = {
  getPlans: async () => {
    const response = await api.get('/public/subscription-plans');
    return response.data as { plans: PublicPlan[] };
  },
};
