/* Minimal service worker: makes the site installable as an app.
 * It does not cache anything, so visitors always get the latest schedule. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => { /* pass through to the network */ });
