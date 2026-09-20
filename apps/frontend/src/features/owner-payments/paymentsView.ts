/**
 * Pure view logic for the owner-facing generic Payment History (NOT
 * subscription payments — those stay in `owner-subscription/subscriptionView.ts`).
 * Node-env test convention: decision logic lives here, the page is a thin
 * renderer over it.
 */
import type { OwnerPaymentStatus } from './api';

export function ownerPaymentMethodLabel(method: string | null | undefined): string {
  switch (String(method || '').toUpperCase()) {
    case 'CASH':
      return 'Cash';
    case 'UPI':
      return 'UPI';
    case 'BANK_TRANSFER':
      return 'Bank transfer';
    default:
      return String(method || '—');
  }
}

export function ownerPaymentStatusLabel(status: OwnerPaymentStatus | string): string {
  return String(status).toUpperCase() === 'VOIDED' ? 'Voided' : 'Paid';
}
