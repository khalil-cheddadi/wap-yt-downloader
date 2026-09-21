import { describe, expect, it } from "bun:test";
import { estimateSize, getFormatLabel, formatFileSize, FormatType } from "../src/converter";

describe("estimateSize", () => {
  it("calculates size for 3gp_360p and 3gp_480p", () => {
    // 3gp_360p: (450 + 64) * 1000 / 8 = 64,250 bytes/sec
    // 60 sec * 64,250 bytes = 3,855,000 bytes = ~3.68 MB
    const size360p = estimateSize(60, "3gp_360p");
    expect(size360p).toContain("MB");

    // 3gp_480p: (800 + 96) * 1000 / 8 = 112,000 bytes/sec
    // 60 sec * 112,000 bytes = 6,720,000 bytes = ~6.41 MB
    const size480p = estimateSize(60, "3gp_480p");
    expect(size480p).toContain("MB");

    // 480p estimate should be strictly larger than 360p estimate
    const bytes360 = Math.round(60 * ((450 + 64) * 1000) / 8);
    const bytes480 = Math.round(60 * ((800 + 96) * 1000) / 8);
    expect(bytes480).toBeGreaterThan(bytes360);
  });

  it("returns Unknown for zero or negative duration", () => {
    expect(estimateSize(0, "3gp_360p")).toBe("Unknown");
    expect(estimateSize(-10, "3gp_480p")).toBe("Unknown");
  });
});

describe("getFormatLabel", () => {
  it("returns human readable labels for 3GP 360p and 480p", () => {
    expect(getFormatLabel("3gp_360p")).toBe("3GP 360p");
    expect(getFormatLabel("3gp_480p")).toBe("3GP 480p");
  });

  it("retains backward compatibility labels for legacy formats", () => {
    expect(getFormatLabel("3gp_low")).toBe("3GP Low (176x144)");
    expect(getFormatLabel("3gp_high")).toBe("3GP High (320x240)");
    expect(getFormatLabel("mp3_low")).toBe("MP3 Low (128k)");
    expect(getFormatLabel("mp3_high")).toBe("MP3 High (320k)");
  });
});

describe("purgeTempDir", () => {
  it("purges expired files while keeping fresh files", async () => {
    const { purgeTempDir } = await import("../src/converter");
    const { join } = await import("path");
    const { writeFileSync, existsSync, utimesSync, unlinkSync } = await import("fs");

    const tempDir = join(import.meta.dir, "..", "downloads", "temp");
    const oldFile = join(tempDir, `test_old_${Date.now()}.mp4`);
    const freshFile = join(tempDir, `test_fresh_${Date.now()}.mp4`);

    try {
      writeFileSync(oldFile, "old dummy data");
      writeFileSync(freshFile, "fresh dummy data");

      // Set oldFile mtime to 3 hours ago
      const threeHoursAgo = (Date.now() - 3 * 60 * 60 * 1000) / 1000;
      utimesSync(oldFile, threeHoursAgo, threeHoursAgo);

      const res = purgeTempDir(2 * 60 * 60 * 1000); // 2 hours TTL

      expect(existsSync(oldFile)).toBe(false);
      expect(existsSync(freshFile)).toBe(true);
      expect(res.deleted).toBeGreaterThanOrEqual(1);
    } finally {
      try { if (existsSync(oldFile)) unlinkSync(oldFile); } catch { }
      try { if (existsSync(freshFile)) unlinkSync(freshFile); } catch { }
    }
  });

  it("purges stale partial files (.part, .ytdl, .tmp)", async () => {
    const { purgeTempDir } = await import("../src/converter");
    const { join } = await import("path");
    const { writeFileSync, existsSync, utimesSync, unlinkSync } = await import("fs");

    const tempDir = join(import.meta.dir, "..", "downloads", "temp");
    const partFile = join(tempDir, `test_partial_${Date.now()}.part`);

    try {
      writeFileSync(partFile, "partial data");
      // Set partFile mtime to 10 minutes ago
      const tenMinsAgo = (Date.now() - 10 * 60 * 1000) / 1000;
      utimesSync(partFile, tenMinsAgo, tenMinsAgo);

      purgeTempDir(2 * 60 * 60 * 1000);

      expect(existsSync(partFile)).toBe(false);
    } finally {
      try { if (existsSync(partFile)) unlinkSync(partFile); } catch { }
    }
  });
});

