/* Siracusa service worker: ONLY Web Push for the order status (src/core/push.ts). No cache, no offline pages: the site
   itself stays as it is. Registered by src/client/push.ts when the guest switches the notifications on in tracking. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  const title = d.title || "Siracusa";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "", tag: d.tag || "sc-order", renotify: true, lang: "bg", icon: "/favicon.svg", badge: "/favicon.svg",
    data: { url: d.url || "/" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.split("#")[0] === url && "focus" in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
