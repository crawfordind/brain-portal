import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { generateHealthInsightsForUser } from '@/lib/projects/health-generator';

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await generateHealthInsightsForUser(user.id);
    return NextResponse.json({
      success: true,
      generated: result.generated.length,
      skipped: result.skipped.length,
      projects_generated: result.generated,
      projects_skipped: result.skipped,
    });
  } catch (error) {
    console.error('[HealthInsights] Generation failed:', error);
    return NextResponse.json(
      { error: 'Failed to generate health insights' },
      { status: 500 }
    );
  }
}
