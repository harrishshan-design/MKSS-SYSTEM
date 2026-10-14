const CACHE = "mkss-shell-v2";

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(["/", "/icon.svg", "/manifest.webmanifest"])));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("mkss-shell-") && key !== CACHE).map(key => caches.delete(key)))),
  ]));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).pathname.startsWith("/api/")) return;
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});

self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { /* Show a generic alert for malformed payloads. */ }
  event.waitUntil(self.registration.showNotification(payload.title || "MKSS approval needed", {
    body: payload.body || "A new driver registration needs review.",
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: payload.requestId ? `driver-approval-${payload.requestId}` : "mkss-admin-alert",
    data: { url: payload.url || "/?section=registrations" },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const requested = event.notification.data?.url || "/?section=registrations";
  const target = new URL(requested, self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find(client => new URL(client.url).origin === target.origin);
    if (open) {
      await open.navigate(target.href);
      await open.focus();
    } else {
      await self.clients.openWindow(target.href);
    }
  })());
});
