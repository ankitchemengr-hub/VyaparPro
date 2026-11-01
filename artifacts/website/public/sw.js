// www.shradhaerp.com used to serve the ERP app, which installed a PWA service
// worker at /sw.js. Browsers that still have it keep showing the cached ERP
// instead of this website. Serving this file in its place makes those
// browsers replace the old worker with this one, which clears its caches,
// unregisters itself and reloads open tabs onto the live website.
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: "window" });
      windows.forEach((client) => client.navigate(client.url));
    })(),
  );
});
