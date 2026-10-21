#!/usr/bin/env tsx
/**
 * Allow browsers to upload straight to the R2 bucket.
 *
 * Files over 4 MB are sent from the browser to R2 with a presigned URL, because
 * Vercel refuses larger requests to the app itself. The bucket must allow that
 * cross-origin PUT, once per bucket:
 *
 *   npm run r2:cors                                  # uses APP_URL / NEXT_PUBLIC_APP_URL
 *   npm run r2:cors -- https://<your-domain> http://localhost:3000
 *
 * Replaces the bucket's CORS configuration with one rule. Prints the current
 * rules first, so nothing is lost without being shown.
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { GetBucketCorsCommand, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import { getBucketName, getR2Client, missingR2Config } from "../src/lib/storage/r2";
import { buildUploadCorsRule } from "../src/lib/storage/cors";

async function main() {
  const missing = missingR2Config();
  if (missing.length > 0) {
    console.error(`R2 is not configured. Set: ${missing.join(", ")}`);
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const origins = args.length > 0
    ? args
    : [process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL].filter((v): v is string => Boolean(v));

  const rule = buildUploadCorsRule(origins);
  const client = getR2Client();
  const bucket = getBucketName();

  try {
    const current = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    console.log("Current CORS rules:", JSON.stringify(current.CORSRules ?? [], null, 2));
  } catch {
    console.log("Current CORS rules: none");
  }

  try {
    await client.send(
      new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: [rule] } })
    );
  } catch (error) {
    // An "Object Read & Write" token may not change bucket settings. The same
    // rule can be pasted in the dashboard: R2 -> bucket -> Settings -> CORS policy.
    console.error("Could not set the rule with this API token:", error instanceof Error ? error.message : error);
    console.error("\nPaste this in Cloudflare: R2 -> your bucket -> Settings -> CORS policy:\n");
    console.error(JSON.stringify([{
      AllowedOrigins: rule.AllowedOrigins,
      AllowedMethods: rule.AllowedMethods,
      AllowedHeaders: rule.AllowedHeaders,
      ExposeHeaders: rule.ExposeHeaders,
      MaxAgeSeconds: rule.MaxAgeSeconds,
    }], null, 2));
    process.exit(1);
  }
  console.log(`\nBucket "${bucket}" now accepts uploads from: ${rule.AllowedOrigins.join(", ")}`);
}

main().catch((error) => {
  console.error("Failed to set the bucket's CORS rule:", error instanceof Error ? error.message : error);
  process.exit(1);
});
