import { describe, it, expect } from "vitest";
import { isPublicUrl, isPrivateHost, isValidUrl } from "@/lib/utils/url";

describe("isValidUrl", () => {
  it("accepts http and https", () => {
    expect(isValidUrl("http://example.com")).toBe(true);
    expect(isValidUrl("https://example.com")).toBe(true);
  });

  it("rejects other schemes and non-URLs", () => {
    for (const bad of ["ftp://example.com", "file:///etc/passwd", "not a url", ""]) {
      expect(isValidUrl(bad)).toBe(false);
    }
  });
});

describe("isPrivateHost", () => {
  it("blocks loopback and link-local names", () => {
    for (const host of ["localhost", "foo.localhost", "box.local", "svc.internal"]) {
      expect(isPrivateHost(host)).toBe(true);
    }
  });

  it("blocks the cloud metadata address and its aliases", () => {
    // 169.254.169.254 is the whole reason this function exists.
    expect(isPrivateHost("169.254.169.254")).toBe(true);
    expect(isPrivateHost("metadata.google.internal")).toBe(true);
  });

  it("blocks every RFC1918 range", () => {
    for (const ip of ["10.0.0.1", "172.16.0.1", "172.31.255.254", "192.168.1.1"]) {
      expect(isPrivateHost(ip)).toBe(true);
    }
  });

  it("does not mistake 172.32 or 172.15 for the private /12", () => {
    expect(isPrivateHost("172.15.0.1")).toBe(false);
    expect(isPrivateHost("172.32.0.1")).toBe(false);
  });

  it("blocks CGNAT, benchmarking and reserved ranges", () => {
    expect(isPrivateHost("100.64.0.1")).toBe(true);
    expect(isPrivateHost("198.18.0.1")).toBe(true);
    expect(isPrivateHost("0.0.0.0")).toBe(true);
    expect(isPrivateHost("224.0.0.1")).toBe(true);
  });

  it("blocks integer and hex spellings of a loopback address", () => {
    // http://2130706433/ is http://127.0.0.1/ to most resolvers.
    expect(isPrivateHost("2130706433")).toBe(true);
    expect(isPrivateHost("0x7f000001")).toBe(true);
  });

  it("blocks IPv6 loopback, link-local and unique-local", () => {
    for (const ip of ["::1", "[::1]", "fe80::1", "fc00::1", "fd12::1"]) {
      expect(isPrivateHost(ip)).toBe(true);
    }
  });

  it("blocks a private IPv4 smuggled inside an IPv6 literal", () => {
    expect(isPrivateHost("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateHost("[::ffff:169.254.169.254]")).toBe(true);
  });

  it("allows ordinary public hosts", () => {
    for (const host of ["example.com", "1.1.1.1", "8.8.8.8", "sub.example.co.uk"]) {
      expect(isPrivateHost(host)).toBe(false);
    }
  });
});

describe("isPublicUrl", () => {
  it("accepts a normal public URL", () => {
    expect(isPublicUrl("https://example.com/article")).toBe(true);
  });

  it("rejects private targets", () => {
    for (const url of [
      "http://localhost:3000/",
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/admin",
      "http://[::1]:8080/",
    ]) {
      expect(isPublicUrl(url)).toBe(false);
    }
  });

  it("rejects non-http schemes", () => {
    expect(isPublicUrl("file:///etc/passwd")).toBe(false);
    expect(isPublicUrl("gopher://example.com/")).toBe(false);
  });

  it("rejects credentials in the URL", () => {
    // user@host is a classic way to make a URL read as one host and resolve
    // as another in a sloppy parser downstream.
    expect(isPublicUrl("https://user:pass@example.com/")).toBe(false);
  });
});
