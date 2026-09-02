/**
 * Centralized More/Settings/Billing mock data — shared/mocks/, not
 * per-feature. Ports the profile/config/agreements/properties/billing
 * figures from Stayo App.dc.html's More/Settings/Billing screens verbatim.
 * Help & Support and About content has no design source (Stayo App.dc.html
 * doesn't have either screen) — added per explicit request, kept in the
 * same shape as everything else here.
 */

export const mockOwnerProfile = {
  initials: 'SR',
  name: 'Srinivasa Rao Yanam',
  role: 'Owner',
  email: 'support@yourstayo.com',
};

export const mockHostelIdentity = { name: 'StayO', hostelCount: 3 };
export const mockTenantDefaults = 'Deposit 1 mo refundable · 3-month agreements';

export const mockBilling = {
  generationDay: '1st of month',
  dueDay: '5th',
  gracePeriodDays: 3,
  lateFeeEnabled: true,
  lateFeeAmount: '₹50 / day',
};

export const mockFaqs = [
  { id: 'faq-1', question: 'How do I add a new tenant?', answer: 'Use the Invite Tenant flow from the Tenants tab or the Quick Actions menu on Home.' },
  { id: 'faq-2', question: 'When are rent obligations generated?', answer: 'Automatically on your configured generation day, per your Rent and billing settings.' },
  { id: 'faq-3', question: 'How do I record a payment I collected in cash?', answer: 'Use Collect Payment from the Tenants tab, Money tab, or Home\'s Quick Actions.' },
];

