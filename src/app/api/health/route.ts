import { NextResponse } from "next/server";

/**
 * Health check endpoint for connectivity probing
 * Returns a minimal response for network status detection
 */
export async function GET() {
  return NextResponse.json({ ok: true });
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}
