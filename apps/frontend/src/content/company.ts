/**
 * Single source of truth for the company identity layer — Trishul Solutions
 * (the operating company) and the products it ships, with Stayo as the
 * flagship. The footer, Company page, About and Contact all read from here,
 * so the Trishul → Stayo relationship is asserted from ONE place and stays
 * consistent for Meta Business Verification / WhatsApp display-name review.
 *
 * Scalable by design: adding a future product = one entry in `products`.
 * Phone below is the real registered Trishul Solutions contact number.
 * Office address and registration IDs are deliberately NOT surfaced publicly.
 */

export type ProductStatus = 'flagship' | 'coming-soon';

export interface CompanyProduct {
  name: string;
  tagline: string;
  status: ProductStatus;
  statusLabel: string;
  description: string;
  href?: string;
}

export interface CompanyPrinciple {
  title: string;
  body: string;
}

export interface CompanySocial {
  label: string;
  href: string;
}

export const COMPANY = {
  name: 'Trishul Solutions',
  descriptor: 'AI Software Company',
  /** The mark's meaning, per the brand guide: three strokes from one point. */
  tagline: 'Solve · Simplify · Scale',
  /** The one-line attribution used in the footer and across the site. */
  attribution: 'Stayo is developed and operated by Trishul Solutions.',
  website: 'https://yourstayo.com',
  emails: {
    contact: 'contact@yourstayo.com',
    support: 'support@yourstayo.com',
    privacy: 'privacy@yourstayo.com',
    legal: 'legal@yourstayo.com',
  },
  /** Real registered contact number (office address intentionally not public). */
  phone: '+91 76750 80090',

  mission:
    'To build software that removes operational friction for the businesses and the people who keep everyday life running — starting with where the pain is real, and solving it end to end.',
  vision:
    'A future where running any operation — a hostel today, more tomorrow — is effortless, transparent, and intelligent, so operators can focus on people instead of paperwork.',

  principles: [
    {
      title: 'Solve',
      body: 'We start from a real, painful problem and solve it end to end — an outcome, not a feature.',
    },
    {
      title: 'Simplify',
      body: 'Powerful should never mean complicated. We hide the machinery and hand over clarity.',
    },
    {
      title: 'Scale',
      body: 'What we build is designed to grow — with one hostel or a thousand, one product or many.',
    },
  ] satisfies CompanyPrinciple[],

  products: [
    {
      name: 'Stayo',
      tagline: 'Hostel Management Platform',
      status: 'flagship',
      statusLabel: 'Flagship Product',
      description:
        'A verified hostel & PG marketplace for students and a complete rent, tenant and operations platform for owners — the entire stay lifecycle on one rail.',
      href: '/',
    },
    {
      name: 'More on the way',
      tagline: 'Future AI Products',
      status: 'coming-soon',
      statusLabel: 'Coming Soon',
      description:
        'Trishul Solutions is building more AI-powered products for operations-heavy businesses. Details will be announced here.',
    },
  ] satisfies CompanyProduct[],

  /** Populated once official profiles exist; also drives JSON-LD `sameAs`. */
  social: [] satisfies CompanySocial[],
} as const;
