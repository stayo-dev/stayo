/**
 * The greeting on the tenant's home screen.
 *
 * A hostel is where these people live, and the app's own promise is that it
 * "feels like home" — so the first line of the day says the time of day back
 * to them rather than repeating the product's name at them. Small, but it is
 * the difference between a dashboard and a front door.
 *
 * PURE — runs under vitest's node environment.
 */

export function greetingFor(date: Date = new Date()): string {
  const hour = date.getHours();
  // Boundaries chosen for Indian household rhythm rather than a generic 12/18
  // split: "evening" starting at 4pm reads as wrong when it is still bright.
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

/**
 * The greeting with a name — "Good morning, Sharan".
 *
 * A blank or missing name falls back to the greeting alone, never to
 * "Good morning, undefined" or to an email address.
 */
export function greetingWithName(name: string | null | undefined, date: Date = new Date()): string {
  const greeting = greetingFor(date);
  const first = String(name ?? '').trim().split(/\s+/)[0];
  return first ? `${greeting}, ${first}` : greeting;
}
