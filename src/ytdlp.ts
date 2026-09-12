import { spawn } from "bun";
import { existsSync } from "fs";
import { join } from "path";
import { logger } from "./logger";

export interface YouTubeSearchResult {
  id: string;
  title: string;
  duration: string;
  durationSeconds: number;
  channel: string;
  thumbnailUrl: string;
  viewCount?: number;
  views: string;
  uploadDate: string;
}

export function ensureHostDependencies(): void {
  const ytdlpPath = Bun.which("yt-dlp");
  const ffmpegPath = Bun.which("ffmpeg");

  if (!ytdlpPath || !ffmpegPath) {
    const lines = [
      "",
      "==========================================================================",
      " [FATAL ERROR] Required system dependencies are missing on the host!",
      "==========================================================================",
      "",
      `  • yt-dlp : ${ytdlpPath ? `FOUND (${ytdlpPath})` : "MISSING (not found in PATH)"}`,
      `  • ffmpeg : ${ffmpegPath ? `FOUND (${ffmpegPath})` : "MISSING (not found in PATH)"}`,
      "",
      " This application requires both 'yt-dlp' and 'ffmpeg' installed on the host.",
      "",
      " To install them, run the appropriate command for your OS:",
      "   • Arch Linux:      sudo pacman -S yt-dlp ffmpeg",
      "   • Ubuntu / Debian: sudo apt update && sudo apt install yt-dlp ffmpeg",
      "   • Fedora:          sudo dnf install yt-dlp ffmpeg",
      "   • macOS:           brew install yt-dlp ffmpeg",
      "   • Windows:         winget install yt-dlp Gyan.FFmpeg",
      "",
      "==========================================================================",
      "",
    ];
    console.error(lines.join("\n"));
    process.exit(1);
  }
}

export function formatDuration(seconds: number | undefined): string {
  if (!seconds || isNaN(seconds)) return "Unknown";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

export function formatViewCount(views: number | undefined | null): string {
  if (views === undefined || views === null || isNaN(views) || views < 0) return "Unknown";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(views);
}

export function formatUploadDate(uploadDate?: string | null, timestamp?: number | null): string {
  if (uploadDate && /^\d{8}$/.test(uploadDate)) {
    const year = uploadDate.slice(0, 4);
    const month = uploadDate.slice(4, 6);
    const day = uploadDate.slice(6, 8);
    return `${year}-${month}-${day}`;
  }
  if (timestamp && !isNaN(timestamp) && timestamp > 0) {
    const d = new Date(timestamp * 1000);
    if (!isNaN(d.getTime())) {
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
  }
  return "Unknown";
}

export interface PaginatedSearchResults {
  results: YouTubeSearchResult[];
  page: number;
  pageSize: number;
  hasNextPage: boolean;
}

export async function searchYouTube(query: string, page = 1, pageSize = 5, reqId?: string): Promise<PaginatedSearchResults> {
  const startTime = Date.now();
  logger.info("SEARCH", `Executing YouTube search | Query: "${query}" | Page: ${page}`, reqId);
  const fetchLimit = page * pageSize + 1;
  const searchSpec = `ytsearch${fetchLimit}:${query}`;
  
  const proc = spawn([
    "yt-dlp",
    searchSpec,
    "-j",
    "--flat-playlist",
    "--no-warnings",
    "--extractor-args",
    "youtubetab:approximate_date",
  ], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [output, errOutput] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  if (exitCode !== 0 && errOutput.trim()) {
    logger.warn("SEARCH", `Search warning/error (code ${exitCode}): ${errOutput.trim()}`, reqId);
  }

  const allResults: YouTubeSearchResult[] = [];
  const lines = output.trim().split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const data = JSON.parse(line);
      if (data && data.id) {
        const thumbUrl = `https://i.ytimg.com/vi/${data.id}/default.jpg`;
        const viewCount = typeof data.view_count === "number"
          ? data.view_count
          : (typeof data.view_count === "string" && !isNaN(Number(data.view_count)) ? Number(data.view_count) : undefined);
        const uploadDate = formatUploadDate(data.upload_date, data.timestamp);

        allResults.push({
          id: data.id,
          title: data.title || "Untitled Video",
          durationSeconds: data.duration || 0,
          duration: formatDuration(data.duration),
          channel: data.uploader || data.channel || "Unknown Channel",
          thumbnailUrl: thumbUrl,
          viewCount,
          views: formatViewCount(viewCount),
          uploadDate,
        });
      }
    } catch {
      // Ignore JSON parse errors for non-JSON lines
    }
  }

  const startIndex = (page - 1) * pageSize;
  const pageResults = allResults.slice(startIndex, startIndex + pageSize);
  const hasNextPage = allResults.length > startIndex + pageSize;
  const durationMs = Date.now() - startTime;

  logger.info("SEARCH", `Search finished | Found: ${pageResults.length} items`, reqId, { Duration: `${durationMs}ms` });

  return {
    results: pageResults,
    page,
    pageSize,
    hasNextPage,
  };
}

export interface ProgressData {
  percent: number;
  speed?: string;
  eta?: string;
}

export interface DownloadResult {
  success: boolean;
  actualFile?: string;
  error?: string;
  stderr?: string;
}

export async function downloadSourceVideo(
  videoId: string,
  targetFile: string,
  onProgress?: (progress: ProgressData) => void,
  jobId?: string
): Promise<DownloadResult> {
  const startTime = Date.now();
  logger.info("JOB", `Starting source video download for videoId "${videoId}"`, jobId);
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  
  // Download video stream capped at 360p max height to optimize bandwidth and speed.
  // Merging audio and video automatically uses host ffmpeg from PATH.
  const proc = spawn([
    "yt-dlp",
    "--newline",
    "-f", "b[height<=360]/b[ext=mp4][height<=360]/worstvideo[height<=360]+bestaudio/w",
    "--merge-output-format", "mp4",
    "-o", targetFile,
    "--no-playlist",
    videoUrl
  ], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const decoder = new TextDecoder();
  let stderrText = "";
  let stdoutText = "";

  // Read stdout in background to parse progress and capture output
  const readStdout = async () => {
    try {
      let buffer = "";
      for await (const chunk of proc.stdout) {
        const text = decoder.decode(chunk, { stream: true });
        stdoutText += text;
        buffer += text;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const match = line.match(/\[download\]\s+([\d\.]+)%/i);
          if (match && onProgress) {
            const percent = Math.min(100, Math.max(0, parseFloat(match[1])));
            const speedMatch = line.match(/at\s+([^\s]+)/i);
            const etaMatch = line.match(/ETA\s+([^\s]+)/i);
            onProgress({
              percent,
              speed: speedMatch ? speedMatch[1] : undefined,
              eta: etaMatch ? etaMatch[1] : undefined,
            });
          }
        }
      }
    } catch {
      // Ignore stream reading errors if process ends early
    }
  };

  const readStderr = async () => {
    try {
      for await (const chunk of proc.stderr) {
        stderrText += decoder.decode(chunk, { stream: true });
      }
    } catch {
      // Ignore stream reading errors
    }
  };

  const stdoutPromise = readStdout();
  const stderrPromise = readStderr();
  const exitCode = await proc.exited;
  await Promise.all([stdoutPromise, stderrPromise]);

  const elapsedSecs = ((Date.now() - startTime) / 1000).toFixed(2);
  
  // Check exact targetFile or possible extensions written by yt-dlp
  let actualFile = targetFile;
  if (!existsSync(actualFile)) {
    const candidates = [
      `${targetFile}.webm`,
      `${targetFile}.mkv`,
      `${targetFile}.mp4`,
      targetFile.replace(/\.mp4$/, ".webm"),
      targetFile.replace(/\.mp4$/, ".mkv"),
    ];
    for (const cand of candidates) {
      if (existsSync(cand)) {
        actualFile = cand;
        break;
      }
    }
  }

  const success = exitCode === 0 && existsSync(actualFile);

  if (success) {
    if (onProgress) {
      onProgress({ percent: 100 });
    }
    logger.info("JOB", `Source video download completed in ${elapsedSecs}s`, jobId);
    return { success: true, actualFile };
  } else {
    const rawError = stderrText.trim() || stdoutText.trim() || `Process exited with code ${exitCode} and output file was not created.`;
    logger.error("JOB", `Source video download failed after ${elapsedSecs}s (exitCode: ${exitCode}) | Error: ${rawError}`, jobId);
    
    console.error(`\n================== [${jobId || "JOB"}] YT-DLP ERROR DETAILS ==================`);
    console.error(`Exit Code: ${exitCode}`);
    console.error(`Expected File: ${targetFile}`);
    console.error(`Found File: ${existsSync(actualFile) ? actualFile : "None"}`);
    if (stderrText.trim()) {
      console.error(`\n--- [${jobId || "JOB"}] STDERR ---\n${stderrText.trim()}`);
    }
    if (stdoutText.trim()) {
      console.error(`\n--- [${jobId || "JOB"}] STDOUT ---\n${stdoutText.trim()}`);
    }
    console.error(`=====================================================================\n`);

    return {
      success: false,
      error: `Download error (code ${exitCode}): ${rawError.slice(-500)}`,
      stderr: stderrText,
    };
  }
}
