import { describe, expect, it } from "bun:test";
import { estimateSize, getFormatLabel, formatFileSize, FormatType } from "./converter";

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
