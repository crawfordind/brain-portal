#!/usr/bin/env tsx
/**
 * Test R2 Configuration
 *
 * Run: npx tsx scripts/test-r2-config.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListBucketsCommand } from '@aws-sdk/client-s3';

async function testR2Config() {
  console.log('=== Testing R2 Configuration ===\n');

  // Check environment variables
  console.log('1. Checking environment variables...');
  const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL'];
  let allSet = true;

  for (const key of required) {
    const value = process.env[key];
    if (!value) {
      console.log(`   ❌ ${key}: NOT SET`);
      allSet = false;
    } else {
      const display = key.includes('SECRET') || key.includes('KEY')
        ? `${value.substring(0, 8)}...`
        : value;
      console.log(`   ✅ ${key}: ${display}`);
    }
  }

  if (!allSet) {
    console.log('\n❌ Missing required environment variables. Check your .env.local file.');
    process.exit(1);
  }

  // Create R2 client
  console.log('\n2. Creating R2 client...');
  const endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  console.log(`   Endpoint: ${endpoint}`);

  const client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  // Test connection by listing buckets
  console.log('\n3. Testing connection (listing buckets)...');
  try {
    const response = await client.send(new ListBucketsCommand({}));
    console.log(`   ✅ Connected successfully!`);
    console.log(`   Found ${response.Buckets?.length || 0} bucket(s):`);
    response.Buckets?.forEach(bucket => {
      const match = bucket.Name === process.env.R2_BUCKET_NAME;
      console.log(`      ${match ? '✅' : '  '} ${bucket.Name}`);
    });

    if (!response.Buckets?.some(b => b.Name === process.env.R2_BUCKET_NAME)) {
      console.log(`\n   ⚠️  Warning: Bucket "${process.env.R2_BUCKET_NAME}" not found!`);
      console.log(`   Create it in Cloudflare dashboard or update R2_BUCKET_NAME`);
    }
  } catch (error: any) {
    console.log(`   ❌ Failed to connect: ${error.message}`);
    console.log('\n   Possible issues:');
    console.log('   - R2_ACCOUNT_ID is incorrect');
    console.log('   - R2_ACCESS_KEY_ID or R2_SECRET_ACCESS_KEY is incorrect');
    console.log('   - API token doesn\'t have R2 permissions');
    process.exit(1);
  }

  // Test upload
  console.log('\n4. Testing file upload...');
  const testKey = `test-uploads/test-${Date.now()}.txt`;
  const testContent = Buffer.from('Hello from Brain Portal R2 test!');

  try {
    await client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: testKey,
      Body: testContent,
      ContentType: 'text/plain',
    }));
    console.log(`   ✅ Upload successful!`);
    console.log(`   Key: ${testKey}`);

    // Construct public URL
    const publicUrl = `${process.env.R2_PUBLIC_URL}/${testKey}`;
    console.log(`   Public URL: ${publicUrl}`);
  } catch (error: any) {
    console.log(`   ❌ Upload failed: ${error.message}`);
    process.exit(1);
  }

  // Test download
  console.log('\n5. Testing file download...');
  try {
    const response = await client.send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: testKey,
    }));

    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as any) {
      chunks.push(chunk);
    }
    const downloaded = Buffer.concat(chunks);

    if (downloaded.toString() === testContent.toString()) {
      console.log(`   ✅ Download successful!`);
      console.log(`   Content matches: "${downloaded.toString()}"`);
    } else {
      console.log(`   ❌ Content mismatch!`);
    }
  } catch (error: any) {
    console.log(`   ❌ Download failed: ${error.message}`);
  }

  // Clean up test file
  console.log('\n6. Cleaning up test file...');
  try {
    await client.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: testKey,
    }));
    console.log(`   ✅ Test file deleted`);
  } catch (error: any) {
    console.log(`   ⚠️  Failed to delete: ${error.message}`);
  }

  // Check public URL format
  console.log('\n7. Validating R2_PUBLIC_URL format...');
  const publicUrl = process.env.R2_PUBLIC_URL!;

  if (publicUrl.includes('.r2.cloudflarestorage.com')) {
    console.log(`   ⚠️  WARNING: Your R2_PUBLIC_URL looks like an API endpoint!`);
    console.log(`   Current: ${publicUrl}`);
    console.log('\n   This won\'t work for public file access. You need to either:');
    console.log('   A) Enable R2.dev subdomain (recommended):');
    console.log('      1. Go to Cloudflare dashboard → R2 → your bucket');
    console.log('      2. Settings → Public access → Allow Access');
    console.log('      3. Copy the pub-xxxxx.r2.dev URL');
    console.log('      4. Update R2_PUBLIC_URL=https://pub-xxxxx.r2.dev');
    console.log('\n   B) Set up a custom domain:');
    console.log('      1. Go to bucket settings → Connect Domain');
    console.log('      2. Add files.yourdomain.com');
    console.log('      3. Update R2_PUBLIC_URL=https://files.yourdomain.com');
  } else if (publicUrl.includes('.r2.dev')) {
    console.log(`   ✅ Using R2.dev subdomain`);
    console.log(`   URL: ${publicUrl}`);
    console.log('\n   Test public access by visiting:');
    console.log(`   ${publicUrl}/test.txt (if you have a test file)`);
  } else {
    console.log(`   ✅ Using custom domain`);
    console.log(`   URL: ${publicUrl}`);
    console.log('\n   Make sure DNS is configured correctly!');
  }

  console.log('\n=== Test Complete ===\n');
}

testR2Config().catch(console.error);
