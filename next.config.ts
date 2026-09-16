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
