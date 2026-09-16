#!/usr/bin/env tsx
/**
 * Automatic Queue Processor
 *
 * Continuously processes background jobs for attachments and notes.
 * Can be run as:
 * 1. One-time: npx tsx scripts/auto-process-queue.ts --once
 * 2. Continuous: npx tsx scripts/auto-process-queue.ts --interval 60
 * 3. Forever: npx tsx scripts/auto-process-queue.ts (runs every 5 minutes)
 *
 * For production, use PM2 or systemd to keep it running:
 * pm2 start scripts/auto-process-queue.ts --name queue-processor --interpreter tsx
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

interface ProcessOptions {
  interval?: number; // minutes between runs
  once?: boolean;    // run once and exit
}

/**
 * Run the queue processor
 */
async function runQueueProcessor(): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    console.log(`[${new Date().toISOString()}] Starting queue processor...`);

    const process = spawn('npx', ['tsx', 'scripts/process-queue.ts'], {
      stdio: 'pipe',
      cwd: path.resolve(__dirname, '..'),
    });

    let output = '';
    let errorOutput = '';

    process.stdout?.on('data', (data) => {
      const text = data.toString();
      output += text;
      console.log(text.trim());
    });

    process.stderr?.on('data', (data) => {
      const text = data.toString();
      errorOutput += text;
      console.error(text.trim());
    });

    process.on('close', (code) => {
      const success = code === 0;
      console.log(`[${new Date().toISOString()}] Queue processor ${success ? 'completed' : 'failed'} (exit code: ${code})`);
      resolve({ success, output: output + errorOutput });
    });

    process.on('error', (err) => {
      console.error(`[${new Date().toISOString()}] Failed to start queue processor:`, err);
      resolve({ success: false, output: err.message });
    });
  });
}

/**
 * Write status to a file for monitoring
 */
async function writeStatus(status: {
  lastRun: string;
  success: boolean;
  nextRun?: string;
  totalRuns: number;
}) {
  const statusPath = path.resolve(__dirname, '..', '.queue-processor-status.json');
  await fs.writeFile(statusPath, JSON.stringify(status, null, 2));
}

/**
 * Main loop
 */
async function main() {
  const args = process.argv.slice(2);
  const options: ProcessOptions = {
    interval: 5, // default 5 minutes
    once: false,
  };

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--once') {
      options.once = true;
    } else if (args[i] === '--interval' && args[i + 1]) {
      options.interval = parseInt(args[i + 1], 10);
      i++;
    }
  }

  console.log('=== Automatic Queue Processor ===');
  console.log(`Mode: ${options.once ? 'One-time' : 'Continuous'}`);
  if (!options.once) {
    console.log(`Interval: ${options.interval} minutes`);
  }
  console.log('');

  let totalRuns = 0;
  let consecutiveFailures = 0;

  const runOnce = async () => {
    totalRuns++;
    const result = await runQueueProcessor();

    if (result.success) {
      consecutiveFailures = 0;
    } else {
      consecutiveFailures++;
      console.error(`Warning: ${consecutiveFailures} consecutive failures`);
    }

    // Write status
    const nextRun = options.once
      ? undefined
      : new Date(Date.now() + options.interval! * 60 * 1000).toISOString();

    await writeStatus({
      lastRun: new Date().toISOString(),
      success: result.success,
      nextRun,
      totalRuns,
    });

    // If too many consecutive failures, increase interval
    if (consecutiveFailures >= 5) {
      console.log('Too many failures, backing off...');
      await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000)); // 5 min backoff
      consecutiveFailures = 0;
    }
  };

  // Run once immediately
  await runOnce();

  // If continuous mode, schedule recurring runs
  if (!options.once) {
    const intervalMs = options.interval! * 60 * 1000;

    console.log(`\nScheduled to run every ${options.interval} minutes. Press Ctrl+C to stop.`);
    console.log('Status file: .queue-processor-status.json\n');

    setInterval(async () => {
      await runOnce();
    }, intervalMs);

    // Keep process alive
    process.on('SIGINT', async () => {
      console.log('\n\nShutting down gracefully...');
      await writeStatus({
        lastRun: new Date().toISOString(),
        success: true,
        totalRuns,
      });
      process.exit(0);
    });
  } else {
    console.log('\nOne-time run completed. Exiting.');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
