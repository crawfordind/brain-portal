/**
 * PM2 Ecosystem Configuration
 *
 * Start queue processor with PM2:
 * pm2 start ecosystem.config.js
 *
 * Monitor:
 * pm2 status
 * pm2 logs queue-processor
 *
 * Stop:
 * pm2 stop queue-processor
 * pm2 delete queue-processor
 */

module.exports = {
  apps: [
    {
      name: 'queue-processor',
      script: 'scripts/auto-process-queue.ts',
      interpreter: 'npx',
      interpreter_args: 'tsx',
      args: '--interval 5',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/queue-processor-error.log',
      out_file: 'logs/queue-processor-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
