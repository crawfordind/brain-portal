import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
import withBundleAnalyzer from "@next/bundle-analyzer";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // Disable in development since Serwist doesn't support Turbopack yet
  disable: process.env.NODE_ENV !== "production",
});

const withAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

/**
 * Content-Security-Policy.
 *
 * `'unsafe-inline'` and `'unsafe-eval'` on script-src are what Next's App
 * Router needs without a nonce-threading setup; the policy still meaningfully
 * narrows things by pinning `default-src` to self, forbidding framing, and
 * blocking `object-src` entirely. Tightening script-src to a nonce is tracked
 * as follow-up work, not pretended to be done here.
 *
 * `connect-src` and `img-src` allow https: because the app fetches OpenRouter,
 * renders scraped og:images, and serves attachments from a configurable R2
 * host that is not known at build time.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  // Empty turbopack config to silence the warning for non-webpack builds
  turbopack: {},

  /**
   * Packages that must stay in CommonJS `require` land on the server rather
   * than being pulled through the bundler.
   *
   * `isomorphic-dompurify` reaches for `jsdom` when it runs server-side, and
   * jsdom's dependency tree now mixes ESM-only packages into CommonJS entry
   * points. Bundled, that surfaces at runtime as
   *
   *   Failed to load external module jsdom-<hash>: ERR_REQUIRE_ESM:
   *   require() of ES Module .../@exodus/bytes/encoding-lite.js from
   *   .../html-encoding-sniffer/lib/html-encoding-sniffer.js not supported
   *
   * which takes down server rendering of every page that sanitizes HTML —
   * markdown-renderer, chat-message and the search page. Left external, Node
   * resolves the package itself and honours its own import conditions.
   *
   * `sharp`, `pdf-parse` and `xlsx` are here for the same reason: they are
   * native or CJS-only and the attachment media jobs that use them cannot run
   * in a serverless function until they resolve at runtime instead of at build.
   */
  serverExternalPackages: [
    "isomorphic-dompurify",
    "jsdom",
    "sharp",
    "pdf-parse",
    "xlsx",
  ],

  // Source maps in dev only. Shipping them from production served the full
  // unminified source — harmless for an open-source app, but it also inflates
  // the deploy and hands an attacker a map of the bundle for free.
  productionBrowserSourceMaps: false,
  compiler: {
    removeConsole: false,
  },

  // Add React strict mode to catch more hydration issues
  reactStrictMode: true,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: CSP }],
      },
    ];
  },
};

// Chain the wrappers: analyzer -> serwist -> config
export default withAnalyzer(withSerwist(nextConfig));
