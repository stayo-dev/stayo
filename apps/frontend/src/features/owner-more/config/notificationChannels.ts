/**
 * How a reminder reaches a tenant.
 *
 * Stayo stores **one delivery setting per hostel**, not one per event, so
 * these carry every reminder the Reminders screen sends. That is a real
 * constraint of the data and not a simplification: there is no per-event
 * channel anywhere to expose.
 *
 * This file is what survives `deriveNotificationSections`. That module also
 * derived a list of notification "events" — Rent due, Late fee applied — each
 * rendering a read-only summary of the schedule beneath it. The schedule is
 * now editable on the screen itself, which is the thing those rows described
 * and could not change, so the rows and their derivation are gone.
 */

export type NotificationChannelKey = 'whatsapp' | 'email' | 'in_app' | 'push';

/**
 * Only channels that can actually deliver.
 *
 * WhatsApp goes through the Meta Cloud API, email through Resend, in-app
 * through the `notifications` table, and push through the subscriptions added
 * alongside the service worker. SMS is deliberately absent: the flag is
 * stored, but nothing in the codebase sends one — a toggle that persists a
 * preference which changes nothing observable is worse than no toggle.
 */
export const NOTIFICATION_CHANNELS: Array<{ key: NotificationChannelKey; label: string }> = [
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'Email' },
  { key: 'in_app', label: 'In-app' },
  { key: 'push', label: 'Push' },
];

/**
 * The patch for flipping one channel.
 *
 * Deliberately writes a single key: the backend deep-merges, so sending the
 * whole channel object would let a stale render overwrite a channel the owner
 * changed on another device.
 */
export function buildChannelPatch(channel: NotificationChannelKey, next: boolean) {
  return { reminders: { channels: { [channel]: next } } };
}
