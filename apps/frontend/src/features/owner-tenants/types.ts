/**
 * Feature-local types for the Tenants module — UI/flow state, not the
 * tenant data model itself (that's `MockTenant` and friends in
 * shared/mocks/tenants.ts, reused across features).
 */

import type { PaymentMode } from '@shared/mocks/payments';

export type TenantFilterChip = 'all' | 'overdue' | 'invited';

export type TenantDetailTab = 'charges' | 'activity' | 'documents' | 'stay';

export interface InviteWizardData {
  tenantName: string;
  tenantPhone: string;
  /**
   * Optional. Phone stays the mandatory channel, but the backend only falls
   * back to email when it has one — without this the fallback could never fire
   * and a failed WhatsApp send had no second chance.
   */
  tenantEmail: string;
  hostelId: string;
  roomId: string;
  roomLabel: string;
  joiningDate: string;
  agreementMonths: string;
  monthlyRent: string;
  deposit: string;
  billing: string;
  maintenance: string;
  /**
   * "Has the tenant already paid anything?" — off by default. Covers a
   * deposit paid face-to-face at the door, and onboarding a hostel whose
   * tenants are already months into their stay and have paid for them.
   */
  hasPaidAlready: boolean;
  paidAmount: string;
  /** Does the amount above include the security deposit? Defaults to yes. */
  paidIncludesDeposit: boolean;
  /** Empty string = not chosen yet; required once `paidAmount` > 0. */
  paymentMethod: PaymentMode | '';
  paymentReference: string;
  /**
   * The room/floor the tenant named as a preference on their enquiry, carried
   * through so the Stay step can preselect it (when still available) and
   * explain itself (when not) — never carries any weight beyond that. The
   * actual assignment is always whatever `roomId` ends up holding.
   */
  preferredFloorId?: string;
  preferredRoomId?: string;
  preferredRoomNo?: string;
  preferredRoomAvailable?: boolean;
}

export const EMPTY_INVITE_WIZARD_DATA: InviteWizardData = {
  tenantName: '',
  tenantPhone: '',
  tenantEmail: '',
  hostelId: '',
  roomId: '',
  roomLabel: '',
  joiningDate: '',
  // Blank, deliberately. These carried hardcoded '11' / '8000' / '16000',
  // which meant every owner in the country began every invite by correcting
  // somebody's test numbers — and any figure they failed to notice became a
  // wrong rent on a real tenancy. The hostel's own defaults are applied by
  // `inviteDefaults` once a hostel and room are chosen; a blank field beats a
  // wrong one until then.
  agreementMonths: '',
  monthlyRent: '',
  deposit: '',
  billing: 'Monthly',
  maintenance: '',
  hasPaidAlready: false,
  paidAmount: '',
  paidIncludesDeposit: true,
  paymentMethod: '',
  paymentReference: '',
};

export type QuickCollectStep = 'select' | 'amount' | 'preview' | 'password' | 'success';

/**
 * Minimal real tenant summary `QuickCollectModal` needs for its "amount" step
 * header, regardless of entry point — `TenantDetailPage` already has all of
 * this from `useTenantDetail` (plus real `obligations`, saving a re-fetch);
 * `MoneyPage`'s tenant rows have everything except `obligations` (fetched
 * lazily by the modal itself in "Customize" mode).
 */
export interface QuickCollectTenant {
  id: string;
  name: string;
  initials: string;
  phone: string;
  hostelId: string;
  hostelName: string;
  room: string;
  outstanding: number;
  deposit: number;
  obligations?: import('@shared/mocks/tenants').TenantObligation[];
}
