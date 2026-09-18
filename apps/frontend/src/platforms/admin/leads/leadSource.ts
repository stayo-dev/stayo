/**
 * Who actually sent a lead.
 *
 * Until migration 087 every row on the Leads screen read as "an owner filled
 * in the form": the demand-evidence leads raised from Discover enquiries never
 * set `acquisition_source`, so they inherited the WEBSITE default. A lead
 * nobody submitted looked exactly like a lead an owner submitted, which is the
 * difference between a cold call and a callback — and it changes what you say
 * when you dial.
 */
export type LeadAcquisitionSource = 'WEBSITE' | 'DIRECT_ADMIN' | 'DISCOVER_DEMAND' | 'STUDENT_REFERRAL';

export interface LeadSourceBadge {
  /** Short label for the row. */
  label: string;
  /** Who to expect on the other end of the phone. */
  hint: string;
  /** True when the owner asked us to contact them. */
  ownerSubmitted: boolean;
}

const BADGES: Record<LeadAcquisitionSource, LeadSourceBadge> = {
  WEBSITE: {
    label: 'Owner signup',
    hint: 'The owner filled in the form themselves — they are expecting to hear from us.',
    ownerSubmitted: true,
  },
  DIRECT_ADMIN: {
    label: 'Added by admin',
    hint: 'Created by the team through Add Owner, not by the owner.',
    ownerSubmitted: false,
  },
  DISCOVER_DEMAND: {
    label: 'Tenant demand',
    hint: 'Raised because tenants enquired about this unclaimed listing. The owner has not been contacted.',
    ownerSubmitted: false,
  },
  STUDENT_REFERRAL: {
    label: 'Student referral',
    hint: 'A student named this hostel on the homepage. The owner has not been contacted, and any number here is unverified.',
    ownerSubmitted: false,
  },
};

const UNKNOWN: LeadSourceBadge = {
  label: 'Unknown source',
  hint: 'This lead carries no acquisition source. Treat it as unsolicited until you know otherwise.',
  ownerSubmitted: false,
};

/**
 * An unrecognised value reads as unknown rather than as an owner signup: the
 * safe default is "nobody asked for this call", because assuming consent that
 * was never given is the more expensive mistake.
 */
export function leadSourceBadge(source: string | null | undefined): LeadSourceBadge {
  if (!source) return UNKNOWN;
  return BADGES[source as LeadAcquisitionSource] ?? UNKNOWN;
}

/**
 * The sources the Leads pipeline shows. DIRECT_ADMIN is deliberately absent —
 * it is a manual onboarding action and the Owners page owns it.
 */
export const PIPELINE_SOURCES: LeadAcquisitionSource[] = ['WEBSITE', 'STUDENT_REFERRAL', 'DISCOVER_DEMAND'];

/** The `source` query the leads endpoint expects. */
export function pipelineSourceParam(): string {
  return PIPELINE_SOURCES.join(',');
}
