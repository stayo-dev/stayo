/**
 * What this browser can actually do.
 *
 * **iOS is the case that matters.** Safari implements the Push API only for a
 * site added to the Home Screen; in an ordinary browser tab `PushManager` is
 * absent and there is no workaround. `isPushSupported()` reports false there,
 * and every caller must treat that as an ordinary state rather than an error.
 *
 * Every access is guarded, so importing this where `window` does not exist —
 * the node test environment included — is safe.
 */
export type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

export function isPushSupported(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      typeof Notification !== 'undefined'
    );
  } catch {
    return false;
  }
}

export function permissionState(): PermissionState {
  if (!isPushSupported()) return 'unsupported';
  try {
    return Notification.permission as PermissionState;
  } catch {
    return 'unsupported';
  }
}
