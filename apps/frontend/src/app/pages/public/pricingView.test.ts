import { describe, expect, it } from 'vitest';
import { capacityLabel, extraBedLabel, featuredPlanCode, formatMonthlyPrice } from './pricingView';

describe('formatMonthlyPrice', () => {
  it('rounds paise to whole rupees with Indian grouping', () => {
    expect(formatMonthlyPrice(249900)).toBe('₹2,499');
    expect(formatMonthlyPrice(149900)).toBe('₹1,499');
  });
});

describe('capacityLabel', () => {
  it('renders a closed range', () => {
    expect(capacityLabel({ capacity_min: 51, capacity_max: 100 })).toBe('51–100 beds');
  });

  it('renders an open-ended top tier', () => {
    expect(capacityLabel({ capacity_min: 251, capacity_max: null })).toBe('251+ beds');
  });

  it('defaults the minimum to 1', () => {
    expect(capacityLabel({ capacity_min: null, capacity_max: 50 })).toBe('1–50 beds');
  });
});

describe('extraBedLabel', () => {
  it('returns null when extra beds are not offered', () => {
    expect(extraBedLabel({ max_extra_beds: 0, extra_bed_price_paise: null })).toBeNull();
    expect(extraBedLabel({ max_extra_beds: null, extra_bed_price_paise: 1000 })).toBeNull();
  });

  it('formats the per-extra-bed price', () => {
    expect(extraBedLabel({ max_extra_beds: 20, extra_bed_price_paise: 1000 })).toBe('+₹10 per extra bed beyond that');
  });
});

describe('featuredPlanCode', () => {
  it('picks the middle tier by price', () => {
    const plans = [
      { code: 'STARTER', price_paise: 149900 },
      { code: 'GROWTH', price_paise: 249900 },
      { code: 'PROFESSIONAL', price_paise: 449900 },
      { code: 'PORTFOLIO', price_paise: 799900 },
    ];
    expect(featuredPlanCode(plans)).toBe('GROWTH');
  });

  it('returns null for fewer than two plans', () => {
    expect(featuredPlanCode([])).toBeNull();
    expect(featuredPlanCode([{ code: 'STARTER', price_paise: 149900 }])).toBeNull();
  });
});
