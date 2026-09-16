import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { scrapeFullContent } from "@/lib/services/link-scraper";
import { isPublicUrl } from "@/lib/utils/url";
import { queryOne } from "@/lib/db/client";
import type { Capture } from "@/lib/db/schema";

/**
 * POST /api/captures/link/scrape
 * Full content scraping (requires auth)
 * Returns: scraped content, wordCount, metadata
 */
export async function POST(request: NextRequest) {
  try {
    // Require authentication
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { captureId } = body;

    // Validate captureId is provided
    if (!captureId) {
      return NextResponse.json(
        { error: "captureId is required" },
        { status: 400 }
      );
    }

    // Get capture and validate ownership
    const capture = await queryOne<Capture>(
      "SELECT id, user_id, metadata FROM captures WHERE id = ?",
      [captureId]
    );

    if (!capture) {
      return NextResponse.json(
        { error: "Capture not found" },
        { status: 404 }
      );
    }

    if (capture.user_id !== user.id) {
      return NextResponse.json(
        { error: "Forbidden: capture belongs to another user" },
        { status: 403 }
      );
    }

    // Parse URL from capture metadata
    let url: string;
    try {
      const metadata = JSON.parse(capture.metadata);
      url = metadata.url;
      if (!url) {
        return NextResponse.json(
          { error: "Capture has no URL in metadata" },
          { status: 400 }
        );
      }
    } catch (parseError) {
      return NextResponse.json(
        { error: "Invalid capture metadata" },
        { status: 400 }
      );
    }

    // Validate URL — block private/internal addresses (SSRF)
    if (!isPublicUrl(url)) {
      return NextResponse.json(
        { error: "Invalid URL: must be a public http or https URL" },
        { status: 400 }
      );
    }

    // Scrape full content
    const scraped = await scrapeFullContent(url);

    // Return error status codes if scraping failed
    if (scraped.error) {
      // Network/fetch errors
      if (scraped.statusCode === 0) {
        return NextResponse.json(
          { error: scraped.error, scraped },
          { status: 503 } // Service unavailable
        );
      }
      // HTTP errors (4xx, 5xx)
      const statusCode = scraped.statusCode >= 500 ? 502 : 400;
      return NextResponse.json(
        { error: scraped.error, scraped },
        { status: statusCode }
      );
    }

    return NextResponse.json(scraped);
  } catch (error) {
    console.error("Error scraping link content:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to scrape content: ${errorMessage}` },
      { status: 500 }
    );
  }
}
