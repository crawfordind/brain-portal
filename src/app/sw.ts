/// <reference lib="webworker" />

import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const OFFLINE_CACHE = "offline-fallbacks-v1";
const APP_SHELL_CACHE = "app-shell-v1";
const API_CACHE = "api-cache-v1";
const STATIC_CACHE = "static-assets-v1";

// Pre-cache the offline page on install
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE).then((cache) =>
      cache.addAll(["/offline"])
    )
  );
});

// Clean up old caches on activate
self.addEventListener("activate", (event) => {
  const currentCaches = [OFFLINE_CACHE, APP_SHELL_CACHE, API_CACHE, STATIC_CACHE];
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name.startsWith("offline-fallbacks-") && !currentCaches.includes(name))
          .map((name) => caches.delete(name))
      )
    )
  );
});

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // Health endpoint: Always network (for connectivity detection)
    {
      matcher: ({ url }) => url.pathname === "/api/health",
      handler: async ({ request }) => {
        try {
          return await fetch(request);
        } catch {
          return new Response(null, { status: 503 });
        }
      },
    },
    // API GET routes: Network-first with cache fallback
    {
      matcher: ({ request, url }) =>
        url.pathname.startsWith("/api/") &&
        url.pathname !== "/api/health" &&
        !url.pathname.includes("/api/auth/") &&
        !url.pathname.includes("/api/embeddings") &&
        !url.pathname.includes("/api/insights") &&
        !url.pathname.includes("/api/search") &&
        !url.pathname.includes("/api/weekly/generate") &&
        !url.pathname.includes("/api/process") &&
        request.method === "GET",
      handler: async ({ request }) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        try {
          const response = await fetch(request.clone(), { signal: controller.signal });
          clearTimeout(timeoutId);

          if (response.ok) {
            const cache = await caches.open(API_CACHE);
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          clearTimeout(timeoutId);

          // Fallback to cache
          const cached = await caches.match(request);
          if (cached) {
            // Add header to indicate this is a cached response
            const headers = new Headers(cached.headers);
            headers.set("X-SW-Cache", "true");
            return new Response(cached.body, {
              status: cached.status,
              statusText: cached.statusText,
              headers,
            });
          }

          return new Response(
            JSON.stringify({ error: "Offline", offline: true }),
            {
              status: 503,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      },
    },
    // API mutation routes (POST/PUT/DELETE): Let them fail naturally
    // The client-side offline mutation handler queues these
    {
      matcher: ({ request, url }) =>
        url.pathname.startsWith("/api/") &&
        request.method !== "GET" &&
        request.method !== "HEAD",
      handler: async ({ request }) => {
        try {
          return await fetch(request);
        } catch {
          return new Response(
            JSON.stringify({ error: "Offline", offline: true }),
            {
              status: 503,
              headers: { "Content-Type": "application/json" },
            }
          );
        }
      },
    },
    // Next.js page data: Network-first with cache fallback
    {
      matcher: ({ request, url }) =>
        request.destination === "document" ||
        url.pathname.startsWith("/_next/data/"),
      handler: async ({ request }) => {
        try {
          const response = await fetch(request.clone());
          if (response.ok) {
            const cache = await caches.open(APP_SHELL_CACHE);
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          // Try cache first
          const cached = await caches.match(request);
          if (cached) return cached;

          // For navigation requests, serve the offline page
          if (request.destination === "document" || request.mode === "navigate") {
            const offlinePage = await caches.match("/offline");
            if (offlinePage) return offlinePage;
          }

          return new Response("Offline", { status: 503 });
        }
      },
    },
    // JS/CSS chunks: Cache-first (they're hashed, so immutable)
    {
      matcher: ({ url }) =>
        url.pathname.startsWith("/_next/static/"),
      handler: async ({ request }) => {
        const cached = await caches.match(request);
        if (cached) return cached;

        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          return new Response("", { status: 404 });
        }
      },
    },
    // Static assets (images, fonts, styles): Cache-first
    {
      matcher: ({ request }) =>
        request.destination === "image" ||
        request.destination === "font" ||
        request.destination === "style",
      handler: async ({ request }) => {
        const cached = await caches.match(request);
        if (cached) return cached;

        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          return new Response("", { status: 404 });
        }
      },
    },
    ...defaultCache,
  ],
});

// Handle background sync
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-pending-changes") {
    event.waitUntil(notifyClientsToSync());
  }
});

// Notify all clients to trigger sync
async function notifyClientsToSync(): Promise<void> {
  const clients = await self.clients.matchAll({ type: "window" });
  clients.forEach((client) => {
    client.postMessage({ type: "SYNC_REQUESTED" });
  });
}

// Listen for messages from clients
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  // Client requesting cache of specific URLs for offline use
  if (event.data?.type === "CACHE_URLS") {
    const urls: string[] = event.data.urls || [];
    event.waitUntil(
      caches.open(APP_SHELL_CACHE).then((cache) =>
        Promise.all(
          urls.map((url) =>
            fetch(url)
              .then((response) => {
                if (response.ok) cache.put(url, response);
              })
              .catch(() => {
                // Ignore cache failures for individual URLs
              })
          )
        )
      )
    );
  }
});

serwist.addEventListeners();
