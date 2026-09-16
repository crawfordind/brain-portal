import { NextRequest, NextResponse } from "next/server";
import { logout } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    await logout();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json({ error: "Failed to logout" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    await logout();
    return NextResponse.redirect(new URL("/auth/login", request.url));
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }
}
