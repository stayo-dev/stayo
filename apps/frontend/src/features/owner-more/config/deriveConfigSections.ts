import { type ConfigRow } from './configRows';
import { describeDeposit } from '../billing-policy/depositPolicy';

/**
 * Turns the live hostel policy into the rows the Hostel and Finance screens
 * render. Pure on purpose: every "is this configured?" decision is a judgement
 * that can be wrong, and this is the only layer where those decisions live.
 *
 * Field names come from the nested domain policy that
 * `hostel-policy-service.ts` returns (`billing`, `receipts`, `branding`,
 * `tenant_rules`) — not the flat legacy `HostelPreferences` shape.
 *
 * Rows whose subsystem does not exist are **omitted**. They used to render as
 * permanently `unavailable`, which was honest but still left the owner reading
 * past settings that were never going to work — and they existed largely to
 * pad a completeness meter the configuration redesign removes.
 */
export interface ConfigSource {
  hostel?: {
    id?: string | null;
    name?: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    gst_number?: string | null;
  } | null;
  policy?: {
    billing?: {
      auto_rent_day?: number;
      due_day?: number;
      grace_days?: number;
      late_fee?: { enabled?: boolean; rules?: Array<{ type?: string; amount?: number }> };
      /**
       * One deposit concept, despite the mockup showing "Security deposit" and
       * "Advance payments" as separate rows: the flat legacy `advance_*`
       * preference fields are this object.
       */
      deposit?: {
        enabled?: boolean;
        /** FLAT uses `default_amount`; MONTHS_OF_RENT multiplies rent by `deposit_months`. */
        calculation_mode?: string;
        deposit_months?: number;
        refundable?: boolean;
        default_amount?: number;
      };
      partial_payments?: { enabled?: boolean; minimum_amount?: number; minimum_percentage?: number };
      invite_defaults?: { agreement_duration_months?: number };
    } | null;
    receipts?: { prefix?: string; format?: string; auto_email?: boolean; footer?: string } | null;
    branding?: { logo_url?: string | null; primary_color?: string | null; accent_color?: string | null } | null;
    tenant_rules?: { invite_expiry_hours?: number; required_profile_fields?: string[] } | null;
  } | null;
  counts: { properties: number; floors: number; rooms: number; beds: number };
}

export interface ConfigSection {
  label: string;
  rows: ConfigRow[];
}

const HOSTEL_IDENTITY_ROUTE = '/owner/more/hostel';
const FINANCE = '/owner/more/configuration/finance';
/**
 * Each row opens the screen that owns *its* fields, rather than all of them
 * deep-linking to one combined form. `buildBillingPatch` keeps that safe: a
 * focused screen writes only its own section, so they cannot overwrite each
 * other (the hazard ADR-043 consolidated the screens to fix).
 */
const RENT_SCHEDULE_ROUTE = `${FINANCE}/rent-schedule`;
const PART_PAYMENTS_ROUTE = `${FINANCE}/part-payments`;
const DEPOSIT_ROUTE = `${FINANCE}/deposit`;
const LATE_FEES_ROUTE = `${FINANCE}/late-fees`;
const AGREEMENT_DURATION_ROUTE = '/owner/more/configuration/hostel/agreement-duration';

/** `1st`, `2nd`, `3rd`, `11th`, `21st` — the screen this replaces printed "2st". */
export function ordinalDay(day: number): string {
  const remainderOfHundred = day % 100;
  if (remainderOfHundred >= 11 && remainderOfHundred <= 13) return `${day}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] ?? 'th';
  return `${day}${suffix}`;
}

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

export function deriveHostelSections(source: ConfigSource): ConfigSection[] {
  const { hostel, policy, counts } = source;
  const branding = policy?.branding;
  const receipts = policy?.receipts;
  const tenantRules = policy?.tenant_rules;

  const identityComplete = Boolean(hostel?.name && hostel?.phone && hostel?.address);
  const brandingSet = Boolean(branding?.logo_url || branding?.primary_color || branding?.accent_color);
  const footerSet = Boolean(receipts?.footer && receipts.footer.trim());
  const depositMonths = policy?.billing?.deposit?.deposit_months ?? 0;
  const agreementMonths = policy?.billing?.invite_defaults?.agreement_duration_months ?? 0;

  return [
    {
      label: 'Identity & brand',
      rows: [
        {
          key: 'hostel-identity',
          title: 'Hostel identity',
          detail: identityComplete
            ? `${hostel?.name} · ${plural(counts.properties, 'property', 'properties')}`
            : 'Add name, phone & address',
          state: identityComplete ? 'configured' : 'attention',
          route: HOSTEL_IDENTITY_ROUTE,
        },
        {
          key: 'branding',
          title: 'Branding',
          detail: brandingSet ? 'Logo & colours set' : 'Logo & colours not set',
          state: brandingSet ? 'configured' : 'attention',
          route: HOSTEL_IDENTITY_ROUTE,
        },
        {
          key: 'receipt-branding',
          title: 'Receipt branding',
          detail: footerSet ? 'Footer configured' : 'Footer not configured',
          state: footerSet ? 'configured' : 'attention',
          route: '/owner/more/configuration/finance/receipt-footer',
        },
      ],
    },
    {
      label: 'Property',
      rows: [
        {
          key: 'property-details',
          title: 'Property details',
          detail: [hostel?.city, counts.floors > 0 ? plural(counts.floors, 'floor') : null]
            .filter(Boolean)
            .join(' · ') || 'Not set',
          state: hostel?.city ? 'configured' : 'attention',
          route: HOSTEL_IDENTITY_ROUTE,
        },
        {
          key: 'room-configuration',
          title: 'Room configuration',
          detail: `${plural(counts.rooms, 'room')} · ${plural(counts.beds, 'bed')}`,
          state: counts.rooms > 0 ? 'configured' : 'attention',
          // The hostel drilldown's Rooms tab owns rooms. This used to point at
          // `/owner/more/configuration/hostel/rooms`, which was never a route,
          // so the row rendered as configured and then did nothing.
          route: hostel?.id ? `/owner/hostels/${hostel.id}/rooms` : undefined,
        },
      ],
    },
    {
      label: 'Rules & defaults',
      rows: [
        {
          key: 'tenant-rules',
          title: 'Tenant rules',
          detail: tenantRules?.invite_expiry_hours
            ? `Invites expire in ${tenantRules.invite_expiry_hours}h · ${plural(tenantRules.required_profile_fields?.length ?? 0, 'required field')}`
            : 'Not set',
          state: tenantRules?.invite_expiry_hours ? 'configured' : 'attention',
          route: '/owner/more/configuration/hostel/tenant-defaults',
        },
        {
          key: 'agreement-duration',
          title: 'Agreement duration',
          // Deposit deliberately lives under Finance, so exactly one screen
          // owns each stored field.
          detail: agreementMonths ? `${agreementMonths}-month default lease` : 'Not set',
          state: agreementMonths ? 'configured' : 'attention',
          route: AGREEMENT_DURATION_ROUTE,
        },
      ],
    },
  ];
}

const LATE_FEE_CADENCE: Record<string, string> = {
  PER_DAY: '/ day',
  FLAT: 'one-time',
  PERCENTAGE: '% of rent',
};

export function deriveFinanceSections(source: ConfigSource): ConfigSection[] {
  const { hostel, policy } = source;
  const billing = policy?.billing;
  const receipts = policy?.receipts;

  const lateFee = billing?.late_fee;
  const lateFeeRule = lateFee?.rules?.[0];
  const lateFeeOn = Boolean(lateFee?.enabled);
  const lateFeeHasAmount = Boolean(lateFeeRule?.amount);

  const rentRulesConfigured = Boolean(billing?.auto_rent_day && billing?.due_day !== undefined);
  const deposit = billing?.deposit;
  const partialOn = Boolean(billing?.partial_payments?.enabled);
  const depositMode = deposit?.calculation_mode === 'MONTHS_OF_RENT' ? 'MONTHS_OF_RENT' : 'FLAT';
  // "Configured" depends on the mode: a flat deposit needs an amount, a
  // months-of-rent deposit needs months. Checking `deposit_months` for both
  // reported a flat ₹0 deposit as configured.
  const depositOn = Boolean(
    deposit?.enabled && (depositMode === 'MONTHS_OF_RENT' ? deposit?.deposit_months : deposit?.default_amount),
  );
  const gstSet = Boolean(hostel?.gst_number);

  return [
    {
      label: 'Money in',
      rows: [
        {
          key: 'rent-rules',
          title: 'Rent rules',
          detail: rentRulesConfigured
            ? `Generated ${ordinalDay(billing!.auto_rent_day!)} · Due on ${ordinalDay(billing!.due_day!)} · ${billing!.grace_days ?? 0}-day grace`
            : 'Not set',
          state: rentRulesConfigured ? 'configured' : 'attention',
          route: RENT_SCHEDULE_ROUTE,
        },
        {
          key: 'security-deposit',
          title: 'Security deposit',
          detail: describeDeposit({
            enabled: depositOn,
            mode: depositMode,
            flatAmount: deposit?.default_amount ?? 0,
            months: deposit?.deposit_months ?? 0,
            refundable: deposit?.refundable !== false,
          }),
          // Switched on but with nothing to collect is a gap, not a stance.
          state: depositOn ? 'configured' : deposit?.enabled ? 'attention' : 'off',
          route: DEPOSIT_ROUTE,
        },
        {
          key: 'part-payments',
          title: 'Part payments',
          detail: partialOn
            ? 'A due can be cleared in instalments'
            : 'Each due must be cleared in full',
          // Full-payment-only is a deliberate stance, not a gap.
          state: partialOn ? 'configured' : 'off',
          route: PART_PAYMENTS_ROUTE,
        },
      ],
    },
    {
      label: 'Penalties',
      rows: [
        {
          key: 'late-fees',
          title: 'Late fees',
          detail: !lateFeeOn
            ? 'Off'
            : lateFeeHasAmount
              ? `₹${lateFeeRule!.amount} ${LATE_FEE_CADENCE[lateFeeRule!.type ?? ''] ?? ''} after grace`.replace(/\s+/g, ' ')
              : 'Enabled but no amount set',
          state: !lateFeeOn ? 'off' : lateFeeHasAmount ? 'configured' : 'attention',
          route: LATE_FEES_ROUTE,
        },
      ],
    },
    {
      label: 'Getting paid',
      rows: [
        {
          key: 'payment-gateway',
          title: 'Payment gateway',
          // Deliberately not "Not connected": there is no per-owner gateway
          // record to read, so a connection state would be invented. Online
          // payments are enabled centrally by Stayo.
          detail: 'Enabled by Stayo',
          state: 'off',
          route: '/owner/more/configuration/finance/payment-gateway',
        },
      ],
    },
    {
      label: 'Compliance & receipts',
      rows: [
        {
          key: 'receipts',
          title: 'Receipts',
          detail: receipts?.prefix
            ? `${receipts.prefix}-${new Date().getFullYear()}-#### · ${receipts.auto_email ? 'Auto-emailed' : 'Manual'}`
            : 'Not set',
          state: receipts?.prefix ? 'configured' : 'attention',
          route: '/owner/more/configuration/finance/receipt-footer',
        },
        {
          key: 'gst',
          title: 'GST',
          detail: gstSet ? `GSTIN ${hostel!.gst_number}` : 'GSTIN pending',
          state: gstSet ? 'configured' : 'attention',
          route: HOSTEL_IDENTITY_ROUTE,
        },
      ],
    },
  ];
}
