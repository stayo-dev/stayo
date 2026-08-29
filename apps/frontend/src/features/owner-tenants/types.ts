/**
 * Feature-local types for the Tenants module — UI/flow state, not the
 * tenant data model itself (that's `MockTenant` and friends in
 * shared/mocks/tenants.ts, reused across features).
 */

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
   * The last month whose rent the tenant has already paid, `YYYY-MM`, or empty
   * for "none yet". Only meaningful on the already-living-here path. See
   * `invite/priorHistory.ts` and ADR-141.
   */
  rentPaidThrough: string;
  depositAlreadyPaid: boolean;
  maintenanceAlreadyPaid: boolean;
}

/**
 * Which kind of person the owner is adding.
 *
 * `null` until they say, which is the wizard's opening question — an owner
 * putting a hostel onto Stayo is mostly entering people who moved in months
 * ago and have already paid, and that is a different job from admitting
 * someone new. Naming it first lets the rest of the wizard adapt instead of
 * making every owner read fields that do not apply to them.
 */
export type InviteMode = 'NEW' | 'EXISTING';

export const EMPTY_INVITE_WIZARD_DATA: InviteWizardData = {
  tenantName: '',
  tenantPhone: '',
  tenantEmail: '',
  hostelId: '',
  roomId: '',
  roomLabel: '',
  joiningDate: '',
  agreementMonths: '11',
  monthlyRent: '8000',
  deposit: '16000',
  billing: 'Monthly',
  maintenance: '',
  rentPaidThrough: '',
  depositAlreadyPaid: false,
  maintenanceAlreadyPaid: false,
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
