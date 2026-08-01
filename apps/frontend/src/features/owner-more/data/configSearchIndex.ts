export interface ConfigSearchEntry {
  title: string;
  module: string;
  target: string;
  keywords: string;
  glyph: string;
  tint: string;
  iconColor: string;
}

/**
 * Static search index for the Configuration hub's search overlay — only
 * real, live Phase 1 screens. Do not add entries for deferred modules
 * (Agreements/Automation/Notifications/Account) until they actually exist.
 */
export const CONFIG_SEARCH_INDEX: ConfigSearchEntry[] = [
  { title: 'Rent rules', module: 'Finance', target: '/owner/more/configuration/finance', keywords: 'rent generation due date billing cycle', glyph: '₹', tint: '#FBF1DE', iconColor: '#B8792B' },
  { title: 'Security deposit', module: 'Finance', target: '/owner/more/configuration/finance', keywords: 'deposit refund security', glyph: '₹', tint: '#FBF1DE', iconColor: '#B8792B' },
  { title: 'Late fees', module: 'Finance', target: '/owner/more/configuration/finance/late-fees', keywords: 'late fee penalty overdue charge grace period', glyph: '₹', tint: '#FBF1DE', iconColor: '#B8792B' },
  { title: 'Payment gateway', module: 'Finance', target: '/owner/more/configuration/finance/payment-gateway', keywords: 'gateway payment online upi', glyph: '₹', tint: '#FBF1DE', iconColor: '#B8792B' },
  { title: 'Receipt footer', module: 'Finance', target: '/owner/more/configuration/finance/receipt-footer', keywords: 'receipt footer text prefix gst', glyph: '₹', tint: '#FBF1DE', iconColor: '#B8792B' },
  { title: 'Hostel identity', module: 'Hostel', target: '/owner/more/hostel', keywords: 'name address phone logo gst identity', glyph: 'H', tint: '#F5E9E3', iconColor: '#B46A55' },
  { title: 'Refund policy', module: 'Hostel', target: '/owner/more/configuration/hostel', keywords: 'refund deposit refundable policy', glyph: 'H', tint: '#F5E9E3', iconColor: '#B46A55' },
  { title: 'Tenant defaults', module: 'Hostel', target: '/owner/more/configuration/hostel/tenant-defaults', keywords: 'deposit months agreement duration default tenant invite', glyph: 'H', tint: '#F5E9E3', iconColor: '#B46A55' },
];
