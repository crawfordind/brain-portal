import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { fetchMetadata } from "@/lib/services/link-metadata";
import { isPublicUrl } from "@/lib/utils/url";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { url } = body;

    // Validate URL
    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "URL is required" },
        { status: 400 }
      );
    }

    if (!isPublicUrl(url)) {
      return NextResponse.json(
        { error: "Invalid URL: must be a public http or https URL" },
        { status: 400 }
      );
    }

    // Fetch metadata (server-side, no CORS issues)
    const metadata = await fetchMetadata(url);

    // Return error status codes if metadata fetch failed
    if (metadata.error) {
      // Network/fetch errors
      if (metadata.statusCode === 0) {
        return NextResponse.json(
          { error: metadata.error, metadata },
          { status: 503 } // Service unavailable
        );
      }
      // HTTP errors (4xx, 5xx)
      return NextResponse.json(
        { error: metadata.error, metadata },
        { status: metadata.statusCode >= 500 ? 502 : 400 } // Bad gateway or bad request
      );
    }

    return NextResponse.json(metadata);
  } catch (error) {
    console.error("Error fetching link metadata:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to fetch metadata: ${errorMessage}` },
      { status: 500 }
    );
  }
}
