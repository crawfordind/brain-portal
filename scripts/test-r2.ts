/**
 * Test R2 storage connection
 * Run with: npx tsx scripts/test-r2.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

async function testR2Connection() {
  console.log('========================================');
  console.log('R2 STORAGE CONNECTION TEST');
  console.log('========================================\n');

  // Check environment variables
  console.log('1. Checking environment variables...');
  const requiredEnvVars = [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
    'R2_PUBLIC_URL',
  ];

  const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    console.error('❌ Missing environment variables:', missingVars.join(', '));
    console.error('\nPlease add these to your .env.local file\n');
    process.exit(1);
  }

  console.log('✓ All required environment variables are set\n');

  // Display configuration (with masked secrets)
  console.log('Configuration:');
  console.log(`  Account ID: ${process.env.R2_ACCOUNT_ID}`);
  console.log(`  Access Key: ${process.env.R2_ACCESS_KEY_ID?.substring(0, 8)}...`);
  console.log(`  Secret Key: ${process.env.R2_SECRET_ACCESS_KEY?.substring(0, 8)}...`);
  console.log(`  Bucket: ${process.env.R2_BUCKET_NAME}`);
  console.log(`  Public URL: ${process.env.R2_PUBLIC_URL}\n`);

  // Initialize R2 client
  console.log('2. Initializing R2 client...');
  const r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  console.log('✓ R2 client initialized\n');

  const bucketName = process.env.R2_BUCKET_NAME!;
  const testKey = 'test/connection-test.txt';
  const testContent = `R2 Connection Test
Created at: ${new Date().toISOString()}
This file can be safely deleted.`;

  try {
    // Test 1: List objects in bucket
    console.log('3. Testing bucket access (listing objects)...');
    try {
      const listResponse = await r2Client.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          MaxKeys: 5,
        })
      );
      console.log(`✓ Successfully accessed bucket`);
      console.log(`  Found ${listResponse.KeyCount || 0} objects (showing max 5)`);
      if (listResponse.Contents && listResponse.Contents.length > 0) {
        console.log('  Sample objects:');
        listResponse.Contents.forEach((obj) => {
          console.log(`    - ${obj.Key} (${obj.Size} bytes)`);
        });
      }
      console.log();
    } catch (error: any) {
      console.error('❌ Failed to list bucket contents');
      console.error('  Error:', error.message);
      throw error;
    }

    // Test 2: Upload a test file
    console.log('4. Testing file upload...');
    try {
      await r2Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: testKey,
          Body: Buffer.from(testContent),
          ContentType: 'text/plain',
        })
      );
      console.log(`✓ Successfully uploaded test file: ${testKey}`);
      console.log(`  Public URL: ${process.env.R2_PUBLIC_URL}/${testKey}\n`);
    } catch (error: any) {
      console.error('❌ Failed to upload test file');
      console.error('  Error:', error.message);
      throw error;
    }

    // Test 3: Check if file exists
    console.log('5. Testing file retrieval (HEAD request)...');
    try {
      const headResponse = await r2Client.send(
        new HeadObjectCommand({
          Bucket: bucketName,
          Key: testKey,
        })
      );
      console.log('✓ Successfully retrieved file metadata');
      console.log(`  Content-Type: ${headResponse.ContentType}`);
      console.log(`  Content-Length: ${headResponse.ContentLength} bytes`);
      console.log(`  Last-Modified: ${headResponse.LastModified}\n`);
    } catch (error: any) {
      console.error('❌ Failed to retrieve file metadata');
      console.error('  Error:', error.message);
      throw error;
    }

    // Test 4: Delete the test file
    console.log('6. Testing file deletion...');
    try {
      await r2Client.send(
        new DeleteObjectCommand({
          Bucket: bucketName,
          Key: testKey,
        })
      );
      console.log(`✓ Successfully deleted test file: ${testKey}\n`);
    } catch (error: any) {
      console.error('❌ Failed to delete test file');
      console.error('  Error:', error.message);
      throw error;
    }

    // Verify deletion
    console.log('7. Verifying deletion...');
    try {
      await r2Client.send(
        new HeadObjectCommand({
          Bucket: bucketName,
          Key: testKey,
        })
      );
      console.error('❌ File still exists after deletion (unexpected)\n');
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        console.log('✓ File successfully deleted (verified)\n');
      } else {
        throw error;
      }
    }

    // Success summary
    console.log('========================================');
    console.log('✅ ALL TESTS PASSED');
    console.log('========================================\n');
    console.log('Your R2 storage is configured correctly and ready to use!\n');
    console.log('Next steps:');
    console.log('  1. Start your dev server: npm run dev');
    console.log('  2. Navigate to a note or project');
    console.log('  3. Try uploading an attachment\n');
  } catch (error: any) {
    console.error('\n========================================');
    console.error('❌ R2 CONNECTION TEST FAILED');
    console.error('========================================\n');
    console.error('Error details:', error.message);

    if (error.$metadata) {
      console.error('HTTP Status:', error.$metadata.httpStatusCode);
    }

    console.error('\nTroubleshooting:');
    console.error('  1. Verify your R2 credentials are correct');
    console.error('  2. Check that the bucket exists in Cloudflare dashboard');
    console.error('  3. Ensure API token has read/write permissions');
    console.error('  4. Verify the bucket name matches exactly\n');

    process.exit(1);
  }
}

testR2Connection().catch(console.error);
