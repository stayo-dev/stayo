import { UNAVAILABLE_LABEL, type ConfigRow } from './configRows';

/**
 * Turns the live hostel policy into the rows the Hostel and Finance screens
 * render. Pure on purpose: every "is this configured?" decision is a judgement
 * that can be wrong, and this is the only layer where those decisions live.
 *
 * Field names come from the nested domain policy that
 * `hostel-policy-service.ts` returns (`billing`, `receipts`, `branding`,
 * `tenant_rules`) — not the flat legacy `HostelPreferences` shape.
 *
 * Rows whose subsystem does not exist are `unavailable` rather than omitted,
 * so the screens keep the shape of the design while never claiming a feature
 * works. See configRows.ts for why those never affect a count.
 */
export interface ConfigSource {
  hostel?: {
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
      deposit?: { enabled?: boolean; deposit_months?: number; refundable?: boolean; default_amount?: number };
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
const BILLING_POLICY_ROUTE = '/owner/more/configuration/finance/billing-policy';

/** `1st`, `2nd`, `3rd`, `11th`, `21st` — the screen this replaces printed "2st". */
export function ordinalDay(day: number): string {
  const remainderOfHundred = day % 100;
  if (remainderOfHundred >= 11 && remainderOfHundred <= 13) return `${day}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] ?? 'th';
  return `${day}${suffix}`;
}

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

const unavailable = (key: string, title: string): ConfigRow => ({
  key,
  title,
  detail: UNAVAILABLE_LABEL,
  state: 'unavailable',
});

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
          route: '/owner/more/configuration/hostel/rooms',
        },
        unavailable('room-types', 'Room types'),
        unavailable('amenities', 'Amenities'),
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
          key: 'tenant-defaults',
          title: 'Tenant defaults',
          detail: depositMonths
            ? `${depositMonths}-mo deposit · ${agreementMonths}-mo agreement`
            : 'Not set',
          state: depositMonths ? 'configured' : 'attention',
          route: '/owner/more/configuration/hostel/tenant-defaults',
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
  const depositOn = Boolean(deposit?.enabled && deposit?.deposit_months);
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
          route: BILLING_POLICY_ROUTE,
        },
        {
          key: 'security-deposit',
          title: 'Security deposit',
          detail: depositOn
            ? `${plural(deposit!.deposit_months ?? 0, 'month')} · ${deposit!.refundable ? 'Refundable at move-out' : 'Non-refundable'}`
            : 'Not required',
          state: depositOn ? 'configured' : 'off',
          route: BILLING_POLICY_ROUTE,
        },
        unavailable('advance-payments', 'Advance payments'),
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
          route: '/owner/more/configuration/finance/late-fees',
        },
      ],
    },
    {
      label: 'Getting paid',
      rows: [
        unavailable('payment-methods', 'Payment methods'),
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
