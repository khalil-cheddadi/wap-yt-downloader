import { describe, expect, it } from "bun:test";
import { formatViewCount, formatUploadDate, YouTubeSearchResult } from "./ytdlp";
import { renderSearchResults } from "./views";

describe("formatViewCount", () => {
  it("handles undefined, null, and NaN", () => {
    expect(formatViewCount(undefined)).toBe("Unknown");
    expect(formatViewCount(null)).toBe("Unknown");
    expect(formatViewCount(NaN)).toBe("Unknown");
    expect(formatViewCount(-5)).toBe("Unknown");
  });

  it("handles zero and small numbers", () => {
    expect(formatViewCount(0)).toBe("0");
    expect(formatViewCount(42)).toBe("42");
    expect(formatViewCount(999)).toBe("999");
  });

  it("formats thousands (K)", () => {
    expect(formatViewCount(1000)).toBe("1K");
    expect(formatViewCount(1200)).toBe("1.2K");
    expect(formatViewCount(209655)).toBe("209.7K");
  });

  it("formats millions (M)", () => {
    expect(formatViewCount(1000000)).toBe("1M");
    expect(formatViewCount(3437955)).toBe("3.4M");
  });

  it("formats billions (B)", () => {
    expect(formatViewCount(1814834579)).toBe("1.8B");
  });
});

describe("formatUploadDate", () => {
  it("formats YYYYMMDD string correctly", () => {
    expect(formatUploadDate("20100913")).toBe("2010-09-13");
    expect(formatUploadDate("20240101")).toBe("2024-01-01");
  });

  it("falls back to timestamp in seconds", () => {
    // 1284336000 is 2010-09-13T00:00:00Z
    expect(formatUploadDate(undefined, 1284336000)).toBe("2010-09-13");
  });

  it("returns Unknown for invalid or missing values", () => {
    expect(formatUploadDate(undefined, undefined)).toBe("Unknown");
    expect(formatUploadDate(null, null)).toBe("Unknown");
    expect(formatUploadDate("not-a-date", undefined)).toBe("Unknown");
    expect(formatUploadDate("", -1)).toBe("Unknown");
  });
});

describe("renderSearchResults", () => {
  it("renders search results including view count, upload date, and title tooltip", () => {
    const mockResults: YouTubeSearchResult[] = [
      {
        id: "abc12345",
        title: "Test Video",
        duration: "3:45",
        durationSeconds: 225,
        channel: "Test Channel",
        thumbnailUrl: "https://example.com/thumb.jpg",
        viewCount: 1500000,
        views: "1.5M",
        uploadDate: "2021-06-15",
      },
    ];

    const html = renderSearchResults("test query", {
      results: mockResults,
      page: 1,
      pageSize: 5,
      hasNextPage: false,
    });

    expect(html).toContain("Views: <span title=\"1,500,000 views\">1.5M</span>");
    expect(html).toContain("Channel: Test Channel");
    expect(html).toContain("Duration: 3:45");
    expect(html).toContain("Uploaded: 2021-06-15");
    expect(html).toContain("format=3gp_360p");
    expect(html).toContain("3GP 360p");
    expect(html).toContain("format=3gp_480p");
    expect(html).toContain("3GP 480p");
  });

  it("renders Unknown views and upload date when not provided", () => {
    const mockResults: YouTubeSearchResult[] = [
      {
        id: "abc12345",
        title: "Test Video",
        duration: "Unknown",
        durationSeconds: 0,
        channel: "Test Channel",
        thumbnailUrl: "https://example.com/thumb.jpg",
        views: "Unknown",
        uploadDate: "Unknown",
      },
    ];

    const html = renderSearchResults("test query", {
      results: mockResults,
      page: 1,
      pageSize: 5,
      hasNextPage: false,
    });

    expect(html).toContain("Views: <span>Unknown</span>");
    expect(html).toContain("Uploaded: Unknown");
  });

  it("handles singular 1 view in title attribute", () => {
    const mockResults: YouTubeSearchResult[] = [
      {
        id: "abc12345",
        title: "Test Video",
        duration: "1:00",
        durationSeconds: 60,
        channel: "Test Channel",
        thumbnailUrl: "https://example.com/thumb.jpg",
        viewCount: 1,
        views: "1",
        uploadDate: "2023-11-20",
      },
    ];

    const html = renderSearchResults("test query", {
      results: mockResults,
      page: 1,
      pageSize: 5,
      hasNextPage: false,
    });

    expect(html).toContain("Views: <span title=\"1 view\">1</span>");
    expect(html).toContain("Uploaded: 2023-11-20");
  });
});
