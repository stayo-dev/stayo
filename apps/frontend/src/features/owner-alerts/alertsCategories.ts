import type { DynamicAlertCategory } from './hooks/useAlerts';

/**
 * Single source of truth for the four Alerts categories — their display
 * label, the one-line card description, and the route slug each navigates
 * to. `admin` is the internal key (shared with `DynamicAdminMessage`/
 * `alerts.adminMessages`) but reads "Announcements" everywhere a person sees
 * it; only the label changed, not the wire/storage naming.
 */
export const ALERT_CATEGORIES: DynamicAlertCategory[] = ['leads', 'admin', 'renewals', 'requests'];

export const ALERT_CATEGORY_LABEL: Record<DynamicAlertCategory, string> = {
  leads: 'Leads',
  admin: 'Announcements',
  renewals: 'Renewals',
  requests: 'Requests',
};

export const ALERT_CATEGORY_DESCRIPTION: Record<DynamicAlertCategory, string> = {
  leads: 'New enquiries and follow-ups',
  admin: 'Updates and notices from Stayo',
  renewals: 'Agreements coming up for renewal',
  requests: 'Room changes and other tenant requests',
};

/** Route slug under `/owner/alerts/*`, relative-navigated to from a category card. */
export const ALERT_CATEGORY_PATH: Record<DynamicAlertCategory, string> = {
  leads: 'leads',
  admin: 'announcements',
  renewals: 'renewals',
  requests: 'requests',
};
