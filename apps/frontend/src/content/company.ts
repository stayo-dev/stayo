/**
 * Single source of truth for the company identity layer — Trishul Solutions
 * (the operating company) and the products it ships, with Stayo as the
 * flagship. The footer, Company page, About and Contact all read from here,
 * so the Trishul → Stayo relationship is asserted from ONE place and stays
 * consistent for Meta Business Verification / WhatsApp display-name review.
 *
 * Scalable by design: adding a future product = one entry in `products`.
 * Phone below is the real registered Trishul Solutions contact number.
 * The registered address and Grievance Officer ARE published — the Consumer
 * Protection (E-Commerce) Rules 2020 and IT Rules 2021 require it — while the
 * proprietor's personal phone and email stay unpublished.
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

export interface PostalAddress {
  line1: string;
  line2: string;
  locality: string;
  district: string;
  state: string;
  pin: string;
}

/** One postal line, in the order an Indian address is read. */
export function formatPostalAddress(a: PostalAddress): string {
  return `${a.line1}, ${a.line2}, ${a.locality}, ${a.district}, ${a.state} ${a.pin}`;
}

/**
 * The aggregator, in the only place it is named.
 *
 * `descriptor` is the ONLY form that may appear in a published document;
 * `name` exists for internal and operational reference. Stayo changed
 * aggregator once already and the previous name was left scattered through six
 * documents and a live pay sheet. Naming a gateway in published copy buys
 * nothing — it is not required for aggregator onboarding, and neither RentOk
 * nor Crib does it — while guaranteeing stale copy on the next change.
 * `scripts/check-legal.mjs` fails the build if `name` appears under src/content.
 */
export const PAYMENT_PARTNER = {
  name: 'Easebuzz',
  descriptor: 'an RBI-authorised payment aggregator',
} as const;

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
    grievance: 'grievance@yourstayo.com',
  },
  /** Real registered contact number (office address intentionally not public). */
  phone: '+91 76750 80090',

  /**
   * Published because the Consumer Protection (E-Commerce) Rules 2020 and the
   * IT Rules 2021 require an e-commerce entity to display its legal name,
   * registered address and a named Grievance Officer. The proprietor's
   * personal phone and email are deliberately NOT here — nothing obliges
   * publishing those, and legal pages get scraped.
   */
  legal: {
    proprietor: 'Chidiri Shiva Prakash',
    constitution: 'sole proprietorship',
    address: {
      line1: '12-75/1',
      line2: 'Balaji Nagar',
      locality: 'Block 2, Kodangal',
      district: 'Vikarabad District',
      state: 'Telangana',
      pin: '509338',
    } satisfies PostalAddress,
    grievanceOfficer: {
      name: 'Chidiri Shiva Prakash',
      email: 'grievance@yourstayo.com',
    },
  },

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
