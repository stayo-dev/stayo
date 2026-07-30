/**
 * Centralized tenant mock data — shared/mocks/, not per-feature, so
 * Money/Food/Reports can read the same tenant set later instead of each
 * inventing their own (e.g. Money's collections view is just this same
 * array grouped differently). `hostelId`s match shared/mocks/dashboard.ts's
 * `mockProperties`. Content matches the shape and tone of the example data
 * in Stayo App.dc.html's Tenants list and Tenant Detail modal — renamed off
 * the design file's own leftover "Sri Adithya" placeholder branding to the
 * StayO mock hostels used elsewhere in this app.
 */

export type TenantStatus = 'active' | 'overdue' | 'invited' | 'pending-docs';

export interface TenantObligation {
  id: string;
  type: string;
  month: string;
  amount: number;
  dueLabel: string;
  status: 'PENDING' | 'UPCOMING' | 'PAID' | 'OVERDUE';
}

export interface TenantActivityItem {
  id: string;
  title: string;
  sub: string;
  amount?: number;
  date: string;
  tone: 'positive' | 'neutral' | 'negative';
}

export interface TenantDocument {
  id: string;
  title: string;
  sub: string;
  status: 'PENDING' | 'SIGNED' | 'VERIFIED' | 'MISSING';
}

export interface TenantStayDetails {
  hostelName: string;
  roomBed: string;
  moveInDate: string;
  agreementPeriod: string;
  monthlyRent: number;
  deposit: number;
  billingFrequency: string;
}

export interface MockGuardian {
  name: string;
  relation: string;
  phone: string;
}

export interface MockTenant {
  id: string;
  name: string;
  initials: string;
  phone: string;
  hostelId: string;
  hostelName: string;
  room: string;
  rent: number;
  status: TenantStatus;
  statusLabel: string;
  outstanding: number;
  overdueMonths: number;
  joinedDate: string;
  guardian?: MockGuardian;
  riskScore: number;
  riskLabel: string;
  riskInsight: string;
  paymentRatePercent: number;
  agreementStatus: string;
  kycStatus: string;
  obligations: TenantObligation[];
  activity: TenantActivityItem[];
  documents: TenantDocument[];
  stay: TenantStayDetails;
}

const RENT_MONTHS = ['Aug 2026', 'Sept 2026', 'Oct 2026', 'Nov 2026', 'Dec 2026'];

function rentSchedule(tenantId: string, rent: number, paidThrough: number): TenantObligation[] {
  return RENT_MONTHS.map((month, i) => ({
    id: `${tenantId}-ob-${i}`,
    type: 'RENT',
    month,
    amount: rent,
    dueLabel: `Due: 05 ${month.split(' ')[0]}`,
    status: i < paidThrough ? 'PAID' : i === paidThrough ? 'PENDING' : 'UPCOMING',
  }));
}

export const mockTenants: MockTenant[] = [
  {
    id: 'chinthala-pavan-sai-raj',
    name: 'Chinthala Pavan Sai Raj',
    initials: 'CP',
    phone: '+91 79819 17038',
    hostelId: 'sunrise-boys-hostel',
    hostelName: 'Sunrise Boys Hostel',
    room: '102',
    rent: 8200,
    status: 'active',
    statusLabel: 'Active',
    outstanding: 90200,
    overdueMonths: 0,
    joinedDate: '1 Aug 2026',
    guardian: { name: 'Chinthala Ravinder', relation: 'Father', phone: '+91 98669 12032' },
    riskScore: 95,
    riskLabel: 'Excellent',
    riskInsight: 'Excellent payment reliability. Standard auto-reminders are sufficient.',
    paymentRatePercent: 100,
    agreementStatus: 'Signed',
    kycStatus: 'Pending',
    obligations: rentSchedule('cp', 8200, 0),
    activity: [
      { id: 'cp-a1', title: 'Invitation accepted', sub: 'KYC started', date: '1 Aug', tone: 'positive' },
      { id: 'cp-a2', title: 'Rental agreement signed', sub: 'e-signature via link', date: '1 Aug', tone: 'positive' },
      { id: 'cp-a3', title: 'Reminder sent', sub: 'Aug 2026 rent due', date: '3 Aug', tone: 'neutral' },
    ],
    documents: [
      { id: 'cp-d1', title: 'Aadhaar (KYC)', sub: 'ID · uploaded 01 Aug 2026', status: 'PENDING' },
      { id: 'cp-d2', title: 'Rental Agreement', sub: 'Signed · valid to 31 Jul 2027', status: 'SIGNED' },
      { id: 'cp-d3', title: 'Photo ID', sub: 'Uploaded 01 Aug 2026', status: 'VERIFIED' },
      { id: 'cp-d4', title: 'Police Verification', sub: 'Required for tenancy', status: 'MISSING' },
    ],
    stay: {
      hostelName: 'Sunrise Boys Hostel',
      roomBed: '102 · Bed B',
      moveInDate: '1 Aug 2026',
      agreementPeriod: '1 Aug 2026 – 31 Jul 2027 (11 mo)',
      monthlyRent: 8200,
      deposit: 8100,
      billingFrequency: 'Monthly',
    },
  },
  {
    id: 'm-durga-prasad',
    name: 'M. Durga Prasad',
    initials: 'DP',
    phone: '+91 90000 11122',
    hostelId: 'sunrise-boys-hostel',
    hostelName: 'Sunrise Boys Hostel',
    room: '401',
    rent: 8100,
    status: 'active',
    statusLabel: 'Paid',
    outstanding: 0,
    overdueMonths: 0,
    joinedDate: '15 Jun 2026',
    riskScore: 98,
    riskLabel: 'Excellent',
    riskInsight: 'Never missed a payment. No action needed.',
    paymentRatePercent: 100,
    agreementStatus: 'Signed',
    kycStatus: 'Verified',
    obligations: rentSchedule('dp', 8100, 5),
    activity: [{ id: 'dp-a1', title: 'Payment received', sub: 'UPI · Aug 2026 rent', amount: 8100, date: '4 Aug', tone: 'positive' }],
    documents: [
      { id: 'dp-d1', title: 'Aadhaar (KYC)', sub: 'ID · uploaded 15 Jun 2026', status: 'VERIFIED' },
      { id: 'dp-d2', title: 'Rental Agreement', sub: 'Signed · valid to 31 May 2027', status: 'SIGNED' },
    ],
    stay: {
      hostelName: 'Sunrise Boys Hostel',
      roomBed: '401 · Bed A',
      moveInDate: '15 Jun 2026',
      agreementPeriod: '15 Jun 2026 – 31 May 2027 (11 mo)',
      monthlyRent: 8100,
      deposit: 8100,
      billingFrequency: 'Monthly',
    },
  },
  {
    id: 'rohan-reddy',
    name: 'Rohan Reddy',
    initials: 'RR',
    phone: '+91 90000 22233',
    hostelId: 'sunrise-boys-hostel',
    hostelName: 'Sunrise Boys Hostel',
    room: '205',
    rent: 8000,
    status: 'overdue',
    statusLabel: 'Overdue 3 mo',
    outstanding: 24000,
    overdueMonths: 3,
    joinedDate: '1 May 2026',
    riskScore: 48,
    riskLabel: 'Needs attention',
    riskInsight: '3 months overdue and KYC documents incomplete — recommend a direct call.',
    paymentRatePercent: 62,
    agreementStatus: 'Signed',
    kycStatus: 'Pending',
    obligations: [
      { id: 'rr-ob-0', type: 'RENT', month: 'May 2026', amount: 8000, dueLabel: 'Due: 05 May', status: 'OVERDUE' },
      { id: 'rr-ob-1', type: 'RENT', month: 'Jun 2026', amount: 8000, dueLabel: 'Due: 05 Jun', status: 'OVERDUE' },
      { id: 'rr-ob-2', type: 'RENT', month: 'Jul 2026', amount: 8000, dueLabel: 'Due: 05 Jul', status: 'OVERDUE' },
      { id: 'rr-ob-3', type: 'RENT', month: 'Aug 2026', amount: 8000, dueLabel: 'Due: 05 Aug', status: 'PENDING' },
    ],
    activity: [
      { id: 'rr-a1', title: 'Reminder sent', sub: 'WhatsApp · 3 months overdue', date: '2 Aug', tone: 'negative' },
      { id: 'rr-a2', title: 'Documents pending', sub: 'Aadhaar not yet uploaded', date: '1 May', tone: 'negative' },
    ],
    documents: [
      { id: 'rr-d1', title: 'Aadhaar (KYC)', sub: 'Not uploaded', status: 'MISSING' },
      { id: 'rr-d2', title: 'Rental Agreement', sub: 'Signed · valid to 30 Apr 2027', status: 'SIGNED' },
    ],
    stay: {
      hostelName: 'Sunrise Boys Hostel',
      roomBed: '205 · Bed C',
      moveInDate: '1 May 2026',
      agreementPeriod: '1 May 2026 – 30 Apr 2027 (11 mo)',
      monthlyRent: 8000,
      deposit: 8000,
      billingFrequency: 'Monthly',
    },
  },
  {
    id: 'rishi-singh-raj-purohit',
    name: 'Rishi Singh Raj Purohit',
    initials: 'RP',
    phone: '+91 90000 33344',
    hostelId: 'sunrise-boys-hostel',
    hostelName: 'Sunrise Boys Hostel',
    room: '205',
    rent: 8000,
    status: 'overdue',
    statusLabel: 'Overdue 5 mo',
    outstanding: 40000,
    overdueMonths: 5,
    joinedDate: '1 Mar 2026',
    riskScore: 30,
    riskLabel: 'High risk',
    riskInsight: '5 months overdue — recommend escalating to a formal notice.',
    paymentRatePercent: 41,
    agreementStatus: 'Signed',
    kycStatus: 'Verified',
    obligations: [
      { id: 'rp-ob-0', type: 'RENT', month: 'Mar 2026', amount: 8000, dueLabel: 'Due: 05 Mar', status: 'OVERDUE' },
      { id: 'rp-ob-1', type: 'RENT', month: 'Apr 2026', amount: 8000, dueLabel: 'Due: 05 Apr', status: 'OVERDUE' },
      { id: 'rp-ob-2', type: 'RENT', month: 'May 2026', amount: 8000, dueLabel: 'Due: 05 May', status: 'OVERDUE' },
      { id: 'rp-ob-3', type: 'RENT', month: 'Jun 2026', amount: 8000, dueLabel: 'Due: 05 Jun', status: 'OVERDUE' },
      { id: 'rp-ob-4', type: 'RENT', month: 'Jul 2026', amount: 8000, dueLabel: 'Due: 05 Jul', status: 'OVERDUE' },
    ],
    activity: [{ id: 'rp-a1', title: 'Reminder sent', sub: 'Call · no response', date: '30 Jul', tone: 'negative' }],
    documents: [
      { id: 'rp-d1', title: 'Aadhaar (KYC)', sub: 'ID · uploaded 01 Mar 2026', status: 'VERIFIED' },
      { id: 'rp-d2', title: 'Rental Agreement', sub: 'Signed · valid to 28 Feb 2027', status: 'SIGNED' },
    ],
    stay: {
      hostelName: 'Sunrise Boys Hostel',
      roomBed: '205 · Bed D',
      moveInDate: '1 Mar 2026',
      agreementPeriod: '1 Mar 2026 – 28 Feb 2027 (12 mo)',
      monthlyRent: 8000,
      deposit: 8000,
      billingFrequency: 'Monthly',
    },
  },
  {
    id: 'brahmarouthu-ganesh',
    name: 'Brahmarouthu Ganesh',
    initials: 'BG',
    phone: '+91 90000 44455',
    hostelId: 'nest-co-living',
    hostelName: 'Nest Co-Living',
    room: '—',
    rent: 7000,
    status: 'invited',
    statusLabel: 'Invited',
    outstanding: 21000,
    overdueMonths: 0,
    joinedDate: '—',
    riskScore: 0,
    riskLabel: 'Not yet scored',
    riskInsight: 'Invitation sent — awaiting KYC and deposit before move-in.',
    paymentRatePercent: 0,
    agreementStatus: 'Not signed',
    kycStatus: 'Not started',
    obligations: [{ id: 'bg-ob-0', type: 'DEPOSIT', month: 'Move-in', amount: 21000, dueLabel: 'Due at move-in', status: 'PENDING' }],
    activity: [{ id: 'bg-a1', title: 'Invitation sent', sub: 'SMS · awaiting response', date: '10 Aug', tone: 'neutral' }],
    documents: [{ id: 'bg-d1', title: 'Aadhaar (KYC)', sub: 'Not uploaded', status: 'MISSING' }],
    stay: {
      hostelName: 'Nest Co-Living',
      roomBed: 'Not yet assigned',
      moveInDate: 'Pending',
      agreementPeriod: 'Pending',
      monthlyRent: 7000,
      deposit: 14000,
      billingFrequency: 'Monthly',
    },
  },
  {
    id: 'ananya-krishnan',
    name: 'Ananya Krishnan',
    initials: 'AK',
    phone: '+91 90000 55566',
    hostelId: 'urban-roost-girls-pg',
    hostelName: 'Urban Roost Girls PG',
    room: '304',
    rent: 11000,
    status: 'pending-docs',
    statusLabel: 'KYC pending',
    outstanding: 11000,
    overdueMonths: 0,
    joinedDate: '20 Jul 2026',
    riskScore: 70,
    riskLabel: 'Good',
    riskInsight: 'Payments on time so far; police verification still missing.',
    paymentRatePercent: 100,
    agreementStatus: 'Signed',
    kycStatus: 'Pending',
    obligations: rentSchedule('ak', 11000, 0),
    activity: [{ id: 'ak-a1', title: 'Moved in', sub: 'Room 304 assigned', date: '20 Jul', tone: 'positive' }],
    documents: [
      { id: 'ak-d1', title: 'Aadhaar (KYC)', sub: 'ID · uploaded 20 Jul 2026', status: 'VERIFIED' },
      { id: 'ak-d2', title: 'Police Verification', sub: 'Required for tenancy', status: 'MISSING' },
    ],
    stay: {
      hostelName: 'Urban Roost Girls PG',
      roomBed: '304 · Bed A',
      moveInDate: '20 Jul 2026',
      agreementPeriod: '20 Jul 2026 – 19 Jul 2027 (12 mo)',
      monthlyRent: 11000,
      deposit: 11000,
      billingFrequency: 'Monthly',
    },
  },
];

export function getMockTenant(id: string): MockTenant | undefined {
  return mockTenants.find((t) => t.id === id);
}
