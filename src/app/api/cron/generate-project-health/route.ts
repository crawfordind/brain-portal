import { NextRequest, NextResponse } from 'next/server';
import { queryAll } from '@/lib/db/client';
import { generateHealthInsightsForUser } from '@/lib/projects/health-generator';
import { verifyCronSecret } from '@/lib/api/validation';

export async function GET(request: NextRequest) {
  const authError = verifyCronSecret(request);
  if (authError) return authError;

  const startTime = Date.now();
  const results = {
    users_processed: 0,
    total_generated: 0,
    total_skipped: 0,
    errors: [] as string[],
  };

  try {
    // Get all distinct user IDs with active/planning projects
    const users = await queryAll<{ user_id: string }>(
      `SELECT DISTINCT user_id FROM projects WHERE status IN ('active', 'planning')`
    );

    console.log(`[HealthCron] Processing ${users.length} users`);

    for (const { user_id } of users) {
      try {
        const result = await generateHealthInsightsForUser(user_id);
        results.users_processed++;
        results.total_generated += result.generated.length;
        results.total_skipped += result.skipped.length;
      } catch (error) {
        const msg = `User ${user_id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        results.errors.push(msg);
        console.error(`[HealthCron] ${msg}`);
      }
    }

    const duration = Date.now() - startTime;
    const response = {
      success: true,
      ...results,
      duration_ms: duration,
      timestamp: new Date().toISOString(),
    };

    console.log(`[HealthCron] Completed in ${duration}ms:`, response);
    return NextResponse.json(response);
  } catch (error) {
    console.error('[HealthCron] Fatal error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
