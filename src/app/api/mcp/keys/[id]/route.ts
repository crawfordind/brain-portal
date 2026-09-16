/**
 * DELETE /api/mcp/keys/[id]  — revoke a key owned by the current user.
 *
 * Revocation sets `is_active = FALSE`, which causes `validateApiKey` in
 * `src/mcp/auth.ts` to reject future requests using the key.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { revokeKeyForUser } from "@/lib/mcp/keys";
import { ensureMcpKeysTable } from "@/lib/mcp/schema";

export const runtime = "nodejs";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing key id" }, { status: 400 });
  }

  try {
    await ensureMcpKeysTable();
    const revoked = await revokeKeyForUser(user.id, id);
    if (!revoked) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[mcp/keys] revoke failed:", err);
    return NextResponse.json(
      { error: "server_error", message: `Revoke MCP key failed: ${message}` },
      { status: 500 }
    );
  }
}
