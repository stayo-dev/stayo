/*
 * Stayo push-only service worker.
 *
 * ── The most important thing about this file is what is NOT in it ──────────
 *
 * There is deliberately **no `fetch` handler**. A service worker without one
 * cannot intercept requests, cannot cache, and cannot serve a stale asset —
 * so adding push costs nothing in cache-invalidation or deploy-rollout risk,
 * and the SPA's update behaviour is exactly what it was before.
 *
 * Adding a `fetch` listener turns this into an offline/caching project. That
 * is a deliberate decision to take separately, not something to drift into.
 *
 * Lives in `public/` as plain JS so Vite does not hash its filename — a
 * service worker needs a stable path and root scope.
 */

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // A malformed payload should still surface something rather than nothing.
  }

  const title = payload.title || "Stayo";
  const options = {
    body: payload.body || "",
    icon: "/android-chrome-192x192.png",
    badge: "/favicon-32x32.png",
    // Same type replaces rather than stacks — three rent reminders should be
    // one line in the tray, not three.
    tag: payload.tag || payload.url || "stayo",
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus a tab that is already open rather than opening a second one.
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
