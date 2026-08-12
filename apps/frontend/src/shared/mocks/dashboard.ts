/**
 * Mock numbers for the owner Home-tab dashboard, matching the shape and
 * tone of the example data in Stayo App.dc.html (₹53,100 rent, 3 hostels,
 * etc.). Centralized under shared/mocks/ (not per-feature) so Money, Food,
 * and future modules can reference the same hostel set instead of each
 * inventing their own — see mockProperties' `id`s, reused as `hostelId` in
 * shared/mocks/tenants.ts. Trivially swappable for a real query hook once
 * this mounts at the real `/owner/home`.
 */
export const mockOwnerName = 'Srinivasa';

export const mockActionCenter = {
  collectRent: { amount: '₹53,100', caption: '4 tenants overdue' },
  reviewAgreements: { value: 45, caption: 'Due for renewal' },
  activateTenants: { value: 2, caption: 'Awaiting activation' },
  fillVacantBeds: { value: 25, caption: 'Vacant beds' },
  verifyKyc: { value: 1, caption: 'Tenant document pending' },
  sendReminders: { value: 37, caption: 'Overdue tenants not yet reminded' },
  todaysRevenue: { value: '₹18,500', caption: 'Collected this month' },
  showRenewalAgreements: true,
};

export const mockCollection = {
  month: 'July',
  percent: 21,
  collected: '₹1,31,300',
  target: '₹6,40,050',
};

export interface MockProperty {
  id: string;
  name: string;
  location: string;
  occupancyLabel: string;
  revenue: string;
  outstanding: string;
  vacant: number;
  /**
   * Raw numeric values behind the formatted strings above, plus the
   * owner's manual position. Sorting can't use the display strings —
   * '₹1,32,600' doesn't compare numerically. Optional so the mock fixtures
   * and any older caller still type-check. See ADR-042.
   */
  occupancyPercent?: number;
  revenueValue?: number;
  outstandingValue?: number;
  displayOrder?: number | null;
  status?: string;
  activeTenants?: number;
}

export const mockProperties: MockProperty[] = [
  {
    id: 'sunrise-boys-hostel',
    name: 'Sunrise Boys Hostel',
    location: 'Kukatpally, Hyderabad',
    occupancyLabel: '82%',
    revenue: '₹2,45,600',
    outstanding: '₹42,000',
    vacant: 12,
  },
  {
    id: 'nest-co-living',
    name: 'Nest Co-Living',
    location: 'Gachibowli, Hyderabad',
    occupancyLabel: '91%',
    revenue: '₹1,88,000',
    outstanding: '₹15,000',
    vacant: 4,
  },
  {
    id: 'urban-roost-girls-pg',
    name: 'Urban Roost Girls PG',
    location: 'Miyapur, Hyderabad',
    occupancyLabel: '76%',
    revenue: '₹1,06,500',
    outstanding: '₹0',
    vacant: 9,
  },
];

export const mockAlertCount = 53;
