/**
 * Test script for rate limiting on shared notes endpoint
 *
 * This script makes 105 requests to test that:
 * - First 100 requests succeed
 * - Requests 101-105 are rate limited
 *
 * Usage:
 *   tsx scripts/test-rate-limit.ts <share-token>
 */

const SHARE_TOKEN = process.argv[2];
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

if (!SHARE_TOKEN) {
  console.error("Usage: tsx scripts/test-rate-limit.ts <share-token>");
  process.exit(1);
}

async function testRateLimit() {
  console.log(`Testing rate limit with ${BASE_URL}/shared/${SHARE_TOKEN}\n`);

  let successCount = 0;
  let rateLimitCount = 0;

  for (let i = 1; i <= 105; i++) {
    try {
      const response = await fetch(`${BASE_URL}/shared/${SHARE_TOKEN}`);
      const text = await response.text();

      if (text.includes("Too Many Requests")) {
        rateLimitCount++;
        console.log(`Request ${i}: RATE LIMITED`);
      } else if (response.ok) {
        successCount++;
        if (i % 10 === 0) {
          console.log(`Request ${i}: SUCCESS (${successCount} total)`);
        }
      } else {
        console.log(`Request ${i}: ERROR (${response.status})`);
      }
    } catch (error) {
      console.error(`Request ${i}: FAILED -`, error);
    }

    // Small delay to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  console.log("\n=== RESULTS ===");
  console.log(`Successful requests: ${successCount}`);
  console.log(`Rate limited requests: ${rateLimitCount}`);
  console.log(`Total requests: ${successCount + rateLimitCount}`);

  if (successCount === 100 && rateLimitCount === 5) {
    console.log("\n✓ Rate limiting working correctly!");
  } else {
    console.log("\n✗ Rate limiting not working as expected");
    console.log("  Expected: 100 success, 5 rate limited");
  }
}

testRateLimit();
