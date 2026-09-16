import { describe, it, expect } from "vitest";
import { parseDataUrl, extensionForMime } from "@/lib/storage/data-url";

describe("parseDataUrl", () => {
  it("parses a valid base64 PNG data URL", () => {
    // 1x1 transparent PNG
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
    const result = parseDataUrl(png);
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe("image/png");
    expect(result!.buffer.length).toBeGreaterThan(0);
    // PNG magic bytes
    expect(result!.buffer[0]).toBe(0x89);
    expect(result!.buffer[1]).toBe(0x50);
  });

  it("lowercases the mime type", () => {
    const result = parseDataUrl("data:IMAGE/PNG;base64,aGVsbG8=");
    expect(result!.mimeType).toBe("image/png");
  });

  it("returns null for a remote URL", () => {
    expect(parseDataUrl("https://example.com/x.png")).toBeNull();
  });

  it("returns null for a non-base64 data URL", () => {
    expect(parseDataUrl("data:text/plain,hello")).toBeNull();
  });

  it("returns null for an empty payload", () => {
    expect(parseDataUrl("data:image/png;base64,")).toBeNull();
  });

  it("returns null for non-string input", () => {
    // @ts-expect-error testing runtime guard
    expect(parseDataUrl(null)).toBeNull();
  });
});

describe("extensionForMime", () => {
  it("maps known image types", () => {
    expect(extensionForMime("image/png")).toBe("png");
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("image/webp")).toBe("webp");
  });

  it("falls back to bin for unknown types", () => {
    expect(extensionForMime("application/octet-stream")).toBe("bin");
  });
});
